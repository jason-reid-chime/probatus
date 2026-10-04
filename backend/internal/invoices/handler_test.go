package invoices

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/jasonreid/probatus/internal/email"
	"github.com/jasonreid/probatus/internal/middleware"
	"github.com/jasonreid/probatus/internal/testutil"
)

func req(method, body, role, id string) *http.Request {
	r := httptest.NewRequest(method, "/invoices", strings.NewReader(body))
	ctx := middleware.WithTenantID(r.Context(), "t1")
	ctx = middleware.WithUserID(ctx, "u1")
	ctx = middleware.WithRole(ctx, role)
	if id != "" {
		rc := chi.NewRouteContext()
		rc.URLParams.Add("id", id)
		ctx = context.WithValue(ctx, chi.RouteCtxKey, rc)
	}
	return r.WithContext(ctx)
}

// invoiceRow matches the listCols scan order.
func invoiceRow(status string, email any) []any {
	return []any{"inv-1", 7, "c1", "City Water", email, nil, status, "2026-10-01", "2026-10-31",
		"CAD", 13.0, "Thanks", nil, nil, time.Now(), 200.0}
}

func lineRows() [][]any {
	return [][]any{
		{"l1", "Calibration — PT-1", 1.0, 120.0, "a1", "r1", "PT-1"},
		{"l2", "Travel", 2.0, 40.0, nil, nil, nil},
	}
}

func newH(db *testutil.FakeDB) *Handler {
	h := &Handler{pool: db, send: func(email.EmailPayload) error { return nil }}
	return h
}

func TestRequiresManager(t *testing.T) {
	h := newH(testutil.New())
	for name, fn := range map[string]http.HandlerFunc{
		"list": h.List, "get": h.Get, "create": h.Create, "update": h.Update,
		"delete": h.Delete, "status": h.UpdateStatus, "fromwo": h.FromWorkOrder,
	} {
		w := httptest.NewRecorder()
		fn(w, req("GET", "{}", "technician", "x"))
		if w.Code != http.StatusForbidden {
			t.Errorf("%s: technician got %d, want 403", name, w.Code)
		}
	}
}

func TestValidate(t *testing.T) {
	cases := []struct {
		in   input
		want string
	}{
		{input{Currency: "CA"}, "currency"},
		{input{TaxRate: 101}, "tax_rate"},
		{input{Lines: []Line{{Description: " "}}}, "description"},
		{input{Lines: []Line{{Description: "x", Quantity: -1}}}, "negative"},
	}
	for _, c := range cases {
		if got := c.in.validate(); !strings.Contains(got, c.want) {
			t.Errorf("validate(%+v) = %q, want %q", c.in, got, c.want)
		}
	}
	ok := input{Lines: []Line{{Description: "x", Quantity: 1}}}
	if msg := ok.validate(); msg != "" || ok.Currency != "CAD" {
		t.Errorf("valid input rejected: %q currency=%q", msg, ok.Currency)
	}
}

func TestComputeTotals(t *testing.T) {
	inv := &Invoice{TaxRate: 13, Lines: []Line{{Quantity: 3, UnitPrice: 33.333}, {Quantity: 1, UnitPrice: 0.005}}}
	inv.computeTotals()
	if inv.Lines[0].Amount != 100 || inv.Subtotal != 100.01 || inv.Tax != 13 || inv.Total != 113.01 {
		t.Errorf("totals wrong: %+v", inv)
	}
}

func TestList(t *testing.T) {
	db := testutil.New(testutil.Rule{Match: "FROM invoices i", Rows: [][]any{invoiceRow("draft", "a@b.c")}})
	w := httptest.NewRecorder()
	r := req("GET", "", "admin", "")
	r.URL.RawQuery = "status=draft&customer_id=c1"
	newH(db).List(w, r)
	var out []Invoice
	json.Unmarshal(w.Body.Bytes(), &out)
	if w.Code != 200 || len(out) != 1 || out[0].Total != 226 || out[0].Tax != 26 {
		t.Fatalf("list: %d %s", w.Code, w.Body)
	}
	if !strings.Contains(db.Calls[0].SQL, "i.status = $2") || !strings.Contains(db.Calls[0].SQL, "i.customer_id = $3") {
		t.Errorf("filters not applied: %s", db.Calls[0].SQL)
	}
}

func TestListError(t *testing.T) {
	w := httptest.NewRecorder()
	newH(testutil.New(testutil.Rule{Match: "FROM invoices", Err: errors.New("boom")})).List(w, req("GET", "", "admin", ""))
	if w.Code != 500 {
		t.Errorf("got %d", w.Code)
	}
}

func TestGet(t *testing.T) {
	db := testutil.New(
		testutil.Rule{Match: "WHERE i.tenant_id = $1 AND i.id", Rows: [][]any{invoiceRow("sent", nil)}},
		testutil.Rule{Match: "FROM invoice_lines", Rows: lineRows()},
	)
	w := httptest.NewRecorder()
	newH(db).Get(w, req("GET", "", "supervisor", "inv-1"))
	var inv Invoice
	json.Unmarshal(w.Body.Bytes(), &inv)
	if w.Code != 200 || len(inv.Lines) != 2 || inv.Subtotal != 200 || inv.Total != 226 {
		t.Fatalf("get: %d %+v", w.Code, inv)
	}
}

func TestGetNotFound(t *testing.T) {
	w := httptest.NewRecorder()
	newH(testutil.New()).Get(w, req("GET", "", "admin", "nope"))
	if w.Code != 404 {
		t.Errorf("got %d", w.Code)
	}
}

func TestCreate(t *testing.T) {
	db := testutil.New(testutil.Rule{Match: "INSERT INTO invoices", Rows: [][]any{{"inv-9"}}})
	w := httptest.NewRecorder()
	newH(db).Create(w, req("POST", `{"customer_id":"c1","tax_rate":13,"lines":[{"description":"A","quantity":1,"unit_price":5},{"description":"B","quantity":2,"unit_price":1}]}`, "admin", ""))
	if w.Code != 201 || !strings.Contains(w.Body.String(), "inv-9") {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	if db.Ran("pg_advisory_xact_lock") != 1 || db.Ran("INSERT INTO invoice_lines") != 2 || db.Committed != 1 {
		t.Errorf("numbering lock / lines / commit: %d %d %d", db.Ran("pg_advisory_xact_lock"), db.Ran("INSERT INTO invoice_lines"), db.Committed)
	}
}

func TestCreateBadInput(t *testing.T) {
	h := newH(testutil.New())
	for _, body := range []string{`{bad`, `{"lines":[{"description":""}]}`} {
		w := httptest.NewRecorder()
		h.Create(w, req("POST", body, "admin", ""))
		if w.Code != 400 {
			t.Errorf("%s: got %d", body, w.Code)
		}
	}
}

func TestCreateDBError(t *testing.T) {
	db := testutil.New(testutil.Rule{Match: "INSERT INTO invoices", Err: errors.New("boom")})
	w := httptest.NewRecorder()
	newH(db).Create(w, req("POST", `{}`, "admin", ""))
	if w.Code != 500 {
		t.Errorf("got %d", w.Code)
	}
}

func TestUpdate(t *testing.T) {
	db := testutil.New()
	w := httptest.NewRecorder()
	newH(db).Update(w, req("PUT", `{"lines":[{"description":"A","quantity":1}]}`, "admin", "inv-1"))
	if w.Code != 200 || db.Ran("DELETE FROM invoice_lines") != 1 || db.Committed != 1 {
		t.Fatalf("update: %d %s", w.Code, w.Body)
	}
}

func TestUpdateNotDraft(t *testing.T) {
	db := testutil.New(testutil.Rule{Match: "UPDATE invoices", Tag: "UPDATE 0"})
	w := httptest.NewRecorder()
	newH(db).Update(w, req("PUT", `{}`, "admin", "inv-1"))
	if w.Code != 409 {
		t.Errorf("got %d", w.Code)
	}
}

func TestUpdateBadJSON(t *testing.T) {
	w := httptest.NewRecorder()
	newH(testutil.New()).Update(w, req("PUT", `{`, "admin", "inv-1"))
	if w.Code != 400 {
		t.Errorf("got %d", w.Code)
	}
}

func TestDelete(t *testing.T) {
	w := httptest.NewRecorder()
	newH(testutil.New(testutil.Rule{Match: "DELETE FROM invoices", Tag: "DELETE 1"})).Delete(w, req("DELETE", "", "admin", "inv-1"))
	if w.Code != 204 {
		t.Errorf("draft delete: %d", w.Code)
	}
	w = httptest.NewRecorder()
	newH(testutil.New(testutil.Rule{Match: "DELETE FROM invoices", Tag: "DELETE 0"})).Delete(w, req("DELETE", "", "admin", "inv-1"))
	if w.Code != 409 {
		t.Errorf("non-draft delete: %d", w.Code)
	}
}

func statusDB(status string, email any, lines [][]any) *testutil.FakeDB {
	return testutil.New(
		testutil.Rule{Match: "WHERE i.tenant_id = $1 AND i.id", Rows: [][]any{invoiceRow(status, email)}},
		testutil.Rule{Match: "FROM invoice_lines", Rows: lines},
		testutil.Rule{Match: "SELECT name FROM tenants", Rows: [][]any{{"Acme Cal"}}},
	)
}

func TestUpdateStatusTransitions(t *testing.T) {
	cases := []struct {
		from, to string
		want     int
	}{
		{"draft", "sent", 200}, {"draft", "paid", 409}, {"sent", "paid", 200},
		{"paid", "sent", 200}, {"void", "sent", 409}, {"draft", "void", 200},
	}
	for _, c := range cases {
		w := httptest.NewRecorder()
		newH(statusDB(c.from, nil, lineRows())).UpdateStatus(w, req("PATCH", `{"status":"`+c.to+`"}`, "admin", "inv-1"))
		if w.Code != c.want {
			t.Errorf("%s -> %s: got %d, want %d (%s)", c.from, c.to, w.Code, c.want, w.Body)
		}
	}
}

func TestUpdateStatusSendRequiresLines(t *testing.T) {
	w := httptest.NewRecorder()
	newH(statusDB("draft", nil, nil)).UpdateStatus(w, req("PATCH", `{"status":"sent"}`, "admin", "inv-1"))
	if w.Code != 422 {
		t.Errorf("got %d", w.Code)
	}
}

func TestUpdateStatusEmail(t *testing.T) {
	var sent []email.EmailPayload
	h := newH(statusDB("draft", "ops@city.example", lineRows()))
	h.send = func(p email.EmailPayload) error { sent = append(sent, p); return nil }
	w := httptest.NewRecorder()
	h.UpdateStatus(w, req("PATCH", `{"status":"sent","email":true}`, "admin", "inv-1"))
	if w.Code != 200 || len(sent) != 1 || sent[0].To[0] != "ops@city.example" || !strings.Contains(sent[0].Subject, "#7") {
		t.Fatalf("email send: %d %+v", w.Code, sent)
	}

	// no customer email
	w = httptest.NewRecorder()
	newH(statusDB("draft", nil, lineRows())).UpdateStatus(w, req("PATCH", `{"status":"sent","email":true}`, "admin", "inv-1"))
	if w.Code != 422 {
		t.Errorf("missing email: %d", w.Code)
	}

	// provider failure leaves the invoice unsent
	db := statusDB("draft", "ops@city.example", lineRows())
	h = newH(db)
	h.send = func(email.EmailPayload) error { return errors.New("resend down") }
	w = httptest.NewRecorder()
	h.UpdateStatus(w, req("PATCH", `{"status":"sent","email":true}`, "admin", "inv-1"))
	if w.Code != 502 || db.Ran("UPDATE invoices SET status") != 0 {
		t.Errorf("failed email should not mark sent: %d", w.Code)
	}
}

func TestUpdateStatusNotFoundAndBadJSON(t *testing.T) {
	w := httptest.NewRecorder()
	newH(testutil.New()).UpdateStatus(w, req("PATCH", `{"status":"sent"}`, "admin", "x"))
	if w.Code != 404 {
		t.Errorf("not found: %d", w.Code)
	}
	w = httptest.NewRecorder()
	newH(testutil.New()).UpdateStatus(w, req("PATCH", `{`, "admin", "x"))
	if w.Code != 400 {
		t.Errorf("bad json: %d", w.Code)
	}
}

func TestFromWorkOrder(t *testing.T) {
	db := testutil.New(
		testutil.Rule{Match: "FROM work_orders", Rows: [][]any{{"Spring PM", "c1"}}},
		testutil.Rule{Match: "work_order_id = $2::uuid AND status <> 'void'"}, // no existing invoice
		testutil.Rule{Match: "FROM work_order_assets", Rows: [][]any{
			{"a1", "PT-1", "pressure", "Ashcroft", "1009", "r1"},
			{"a2", "TT-2", "temperature", nil, nil, nil},
		}},
		testutil.Rule{Match: "INSERT INTO invoices", Rows: [][]any{{"inv-new"}}},
	)
	w := httptest.NewRecorder()
	newH(db).FromWorkOrder(w, req("POST", `{"unit_price":85,"tax_rate":13,"due_days":30}`, "admin", "wo-1"))
	if w.Code != 201 || !strings.Contains(w.Body.String(), "inv-new") {
		t.Fatalf("from WO: %d %s", w.Code, w.Body)
	}
	var descs []string
	for _, c := range db.Calls {
		if strings.Contains(c.SQL, "INSERT INTO invoice_lines") {
			descs = append(descs, c.Args[2].(string))
			if c.Args[4].(float64) != 85 {
				t.Errorf("unit price not applied: %v", c.Args[4])
			}
		}
	}
	if len(descs) != 2 || descs[0] != "Calibration — PT-1 (pressure, Ashcroft 1009)" || descs[1] != "Calibration — TT-2 (temperature)" {
		t.Errorf("line descriptions: %q", descs)
	}
}

func TestFromWorkOrderErrors(t *testing.T) {
	w := httptest.NewRecorder()
	newH(testutil.New()).FromWorkOrder(w, req("POST", ``, "admin", "missing"))
	if w.Code != 404 {
		t.Errorf("missing WO: %d", w.Code)
	}
	db := testutil.New(
		testutil.Rule{Match: "FROM work_orders", Rows: [][]any{{"Spring PM", nil}}},
		testutil.Rule{Match: "status <> 'void'", Rows: [][]any{{"inv-old"}}},
	)
	w = httptest.NewRecorder()
	newH(db).FromWorkOrder(w, req("POST", ``, "admin", "wo-1"))
	if w.Code != 409 || !strings.Contains(w.Body.String(), "inv-old") {
		t.Errorf("existing invoice: %d %s", w.Code, w.Body)
	}
}

func TestInvoiceEmailHTMLEscapes(t *testing.T) {
	notes := "<script>x</script>"
	cust := "A&B"
	due := "2026-11-01"
	inv := &Invoice{Number: 3, Currency: "CAD", TaxRate: 13, IssueDate: "2026-10-01", DueDate: &due,
		CustomerName: &cust, Notes: &notes, Lines: []Line{{Description: "<b>x</b>", Quantity: 1, UnitPrice: 10}}}
	inv.computeTotals()
	out := InvoiceEmailHTML(inv, "Acme")
	if strings.Contains(out, "<script>") || strings.Contains(out, "<b>x") || !strings.Contains(out, "A&amp;B") || !strings.Contains(out, "CAD 11.30") {
		t.Errorf("html not escaped or totals missing: %s", out)
	}
}

func TestFromAddress(t *testing.T) {
	t.Setenv("RESEND_FROM_EMAIL", "")
	if !strings.Contains(fromAddress(), "@") {
		t.Error("default from address")
	}
	t.Setenv("RESEND_FROM_EMAIL", "billing@acme.example")
	if fromAddress() != "billing@acme.example" {
		t.Error("env from address")
	}
}
