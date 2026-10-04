package notifications

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jasonreid/probatus/internal/email"
	"github.com/jasonreid/probatus/internal/middleware"
	"github.com/jasonreid/probatus/internal/testutil"
)

func req(method, body, role string) *http.Request {
	r := httptest.NewRequest(method, "/notifications", strings.NewReader(body))
	ctx := middleware.WithTenantID(r.Context(), "t1")
	ctx = middleware.WithRole(ctx, role)
	return r.WithContext(ctx)
}

var fixedNow = time.Date(2026, 10, 3, 15, 0, 0, 0, time.UTC)

func newH(db *testutil.FakeDB, send func(email.EmailPayload) error) *Handler {
	if send == nil {
		send = func(email.EmailPayload) error { return nil }
	}
	return &Handler{pool: db, send: send, now: func() time.Time { return fixedNow }}
}

func settingsRow(enabled bool, lead []int, overdue bool, recipients []string, customers bool) []any {
	return []any{enabled, lead, overdue, recipients, customers}
}

func TestKindFor(t *testing.T) {
	s := Settings{LeadDays: []int{30, 7}, NotifyOverdue: true}
	cases := map[int]string{45: "", 30: "due_30", 12: "due_30", 7: "due_7", 0: "due_7", -1: "overdue"}
	for days, want := range cases {
		if got := kindFor(days, s); got != want {
			t.Errorf("kindFor(%d) = %q, want %q", days, got, want)
		}
	}
	if kindFor(-3, Settings{LeadDays: []int{7}}) != "" {
		t.Error("overdue alerts disabled should give no kind")
	}
}

func TestRequiresManager(t *testing.T) {
	h := newH(testutil.New(), nil)
	for name, fn := range map[string]http.HandlerFunc{"get": h.GetSettings, "put": h.PutSettings, "history": h.History, "run": h.RunNow} {
		w := httptest.NewRecorder()
		fn(w, req("GET", "{}", "technician"))
		if w.Code != 403 {
			t.Errorf("%s: got %d", name, w.Code)
		}
	}
}

func TestGetSettingsDefaults(t *testing.T) {
	w := httptest.NewRecorder()
	newH(testutil.New(), nil).GetSettings(w, req("GET", "", "admin"))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"lead_days":[30,7]`) || !strings.Contains(w.Body.String(), `"enabled":false`) {
		t.Errorf("defaults: %d %s", w.Code, w.Body)
	}
}

func TestGetSettingsSaved(t *testing.T) {
	db := testutil.New(testutil.Rule{Match: "FROM notification_settings", Rows: [][]any{settingsRow(true, []int{14}, false, []string{"a@b.c"}, true)}})
	w := httptest.NewRecorder()
	newH(db, nil).GetSettings(w, req("GET", "", "admin"))
	if !strings.Contains(w.Body.String(), `"lead_days":[14]`) || !strings.Contains(w.Body.String(), `"notify_customers":true`) {
		t.Errorf("saved: %s", w.Body)
	}
}

func TestPutSettingsValidation(t *testing.T) {
	cases := map[string]string{
		`{bad`:              "invalid",
		`{"lead_days":[0]}`: "between 1 and 365",
		`{"internal_recipients":["not-an-email"]}`:                                "valid email",
		`{"enabled":true,"lead_days":[7]}`:                                        "recipient",
		`{"enabled":true,"internal_recipients":["a@b.c"],"notify_overdue":false}`: "lead time",
	}
	for body, want := range cases {
		w := httptest.NewRecorder()
		newH(testutil.New(), nil).PutSettings(w, req("PUT", body, "admin"))
		if w.Code != 400 || !strings.Contains(w.Body.String(), want) {
			t.Errorf("%s: %d %s (want %q)", body, w.Code, w.Body, want)
		}
	}
}

func TestPutSettingsNormalises(t *testing.T) {
	db := testutil.New()
	w := httptest.NewRecorder()
	newH(db, nil).PutSettings(w, req("PUT", `{"enabled":true,"lead_days":[7,30,7],"internal_recipients":[" QA@Acme.example ",""]}`, "admin"))
	if w.Code != 200 {
		t.Fatalf("put: %d %s", w.Code, w.Body)
	}
	if !strings.Contains(w.Body.String(), `"lead_days":[30,7]`) || !strings.Contains(w.Body.String(), `"qa@acme.example"`) {
		t.Errorf("not normalised: %s", w.Body)
	}
	if db.Ran("INSERT INTO notification_settings") != 1 {
		t.Error("settings not saved")
	}
}

func TestPutSettingsDBError(t *testing.T) {
	db := testutil.New(testutil.Rule{Match: "INSERT INTO notification_settings", Err: errors.New("boom")})
	w := httptest.NewRecorder()
	newH(db, nil).PutSettings(w, req("PUT", `{}`, "admin"))
	if w.Code != 500 {
		t.Errorf("got %d", w.Code)
	}
}

func TestHistory(t *testing.T) {
	db := testutil.New(testutil.Rule{Match: "FROM notifications_sent", Rows: [][]any{
		{int64(1), "a1", "PT-1", "2026-10-10", "due_7", "qa@acme.example", "sent", nil, fixedNow, fixedNow},
	}})
	w := httptest.NewRecorder()
	newH(db, nil).History(w, req("GET", "", "admin"))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "PT-1") {
		t.Errorf("history: %d %s", w.Code, w.Body)
	}
}

func dueAssetRows() [][]any {
	return [][]any{
		{"a1", "PT-1", "Ashcroft 1009 (pressure)", "Bay 3", fixedNow.AddDate(0, 0, 5), "City Water", "ops@city.example"},
		{"a2", "TT-2", "(temperature)", "", fixedNow.AddDate(0, 0, -2), "", ""},
		{"a3", "FT-3", "(flow)", "", fixedNow.AddDate(0, 0, 20), "", ""},
	}
}

func runDB(extra ...testutil.Rule) *testutil.FakeDB {
	rules := []testutil.Rule{
		{Match: "FROM notification_settings WHERE tenant_id", Rows: [][]any{settingsRow(true, []int{7}, true, []string{"qa@acme.example"}, true)}},
		{Match: "FROM assets a LEFT JOIN customers", Rows: dueAssetRows()},
		{Match: "SELECT name FROM tenants", Rows: [][]any{{"Acme Cal"}}},
	}
	rules = append(rules, extra...)
	rules = append(rules, testutil.Rule{Match: "INSERT INTO notifications_sent", Rows: [][]any{{int64(1)}}})
	return testutil.New(rules...)
}

func TestRunTenantSendsDigests(t *testing.T) {
	var sent []email.EmailPayload
	db := runDB()
	h := newH(db, func(p email.EmailPayload) error { sent = append(sent, p); return nil })
	res, err := h.RunTenant(context.Background(), "t1")
	if err != nil {
		t.Fatal(err)
	}
	// a3 is 20 days out with a 7-day lead: no alert. Staff digest has a1+a2, customer digest has a1.
	if res.Assets != 2 || res.Sent != 2 || len(sent) != 2 {
		t.Fatalf("result %+v, sent %d", res, len(sent))
	}
	byTo := map[string]email.EmailPayload{}
	for _, p := range sent {
		byTo[p.To[0]] = p
	}
	staff, cust := byTo["qa@acme.example"], byTo["ops@city.example"]
	if !strings.Contains(staff.Html, "PT-1") || !strings.Contains(staff.Html, "TT-2") || !strings.Contains(staff.Html, "OVERDUE") {
		t.Errorf("staff digest incomplete")
	}
	if strings.Contains(cust.Html, "TT-2") || !strings.Contains(cust.Html, "PT-1") {
		t.Errorf("customer digest must only list their assets")
	}
	if !strings.Contains(staff.Subject, "1 overdue, 1 coming due") {
		t.Errorf("subject: %s", staff.Subject)
	}
	if db.Ran("UPDATE notifications_sent") != 2 {
		t.Errorf("claims not finalised")
	}
}

func TestRunTenantSkipsAlreadySent(t *testing.T) {
	var sent int
	db := runDB(testutil.Rule{Match: "INSERT INTO notifications_sent"}) // conflict: no row returned
	h := newH(db, func(email.EmailPayload) error { sent++; return nil })
	res, err := h.RunTenant(context.Background(), "t1")
	if err != nil {
		t.Fatal(err)
	}
	if sent != 0 || res.Skipped != 3 {
		t.Errorf("should skip all: %+v sent=%d", res, sent)
	}
}

func TestRunTenantRecordsFailures(t *testing.T) {
	db := runDB()
	h := newH(db, func(email.EmailPayload) error { return errors.New("resend down") })
	res, _ := h.RunTenant(context.Background(), "t1")
	if res.Failed != 2 || res.Sent != 0 {
		t.Errorf("failures not counted: %+v", res)
	}
	for _, c := range db.Calls {
		if strings.Contains(c.SQL, "UPDATE notifications_sent") && c.Args[1] != "failed" {
			t.Errorf("claim marked %v, want failed", c.Args[1])
		}
	}
}

func TestRunTenantDisabled(t *testing.T) {
	db := testutil.New(testutil.Rule{Match: "FROM notification_settings", Rows: [][]any{settingsRow(false, []int{7}, true, nil, false)}})
	res, err := newH(db, nil).RunTenant(context.Background(), "t1")
	if err != nil || res.Assets != 0 || db.Ran("FROM assets") != 0 {
		t.Errorf("disabled tenant should do nothing: %+v %v", res, err)
	}
}

func TestRunNowAndRunAll(t *testing.T) {
	w := httptest.NewRecorder()
	newH(runDB(), nil).RunNow(w, req("POST", "", "admin"))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"sent":2`) {
		t.Errorf("run now: %d %s", w.Code, w.Body)
	}
	db := runDB(testutil.Rule{Match: "WHERE enabled", Rows: [][]any{{"t1"}}})
	var sent int
	newH(db, func(email.EmailPayload) error { sent++; return nil }).RunAll(context.Background())
	if sent != 2 {
		t.Errorf("RunAll sent %d", sent)
	}
	w = httptest.NewRecorder()
	newH(testutil.New(testutil.Rule{Match: "FROM notification_settings", Err: errors.New("boom")}), nil).RunNow(w, req("POST", "", "admin"))
	if w.Code != 500 {
		t.Errorf("run error: %d", w.Code)
	}
}

func TestRunTenantWithRestoresSender(t *testing.T) {
	h := newH(runDB(), nil)
	orig := h.send
	n := 0
	RunTenantWith(h, context.Background(), "t1", func(email.EmailPayload) error { n++; return nil })
	if n != 2 {
		t.Errorf("substitute sender used %d times", n)
	}
	if h.send == nil || orig == nil {
		t.Error("sender not restored")
	}
}

func TestStartStopsWithContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	newH(testutil.New(), nil).Start(ctx, time.Hour)
	cancel() // must not panic or leak; goroutine exits on ctx.Done
}

func TestDigestSubjectVariants(t *testing.T) {
	overdue := []dueAsset{{DaysUntil: -1}, {DaysUntil: -5}}
	if s := digestSubject(overdue, ""); !strings.Contains(s, "Probatus: 2 instrument(s) overdue") {
		t.Errorf("all overdue: %s", s)
	}
	if s := digestSubject([]dueAsset{{DaysUntil: 3}}, "Acme"); !strings.Contains(s, "1 instrument(s) coming due") {
		t.Errorf("coming due: %s", s)
	}
}

func TestDigestHTMLEscapesAndToday(t *testing.T) {
	out := DigestHTML([]dueAsset{{TagID: "<x>", DaysUntil: 0, DueDate: fixedNow}}, "A&B", fixedNow)
	if strings.Contains(out, "<x>") || !strings.Contains(out, "&lt;x&gt;") || !strings.Contains(out, "today") || !strings.Contains(out, "A&amp;B") {
		t.Errorf("digest html: %s", out)
	}
}

func TestFromAddress(t *testing.T) {
	t.Setenv("RESEND_FROM_EMAIL", "alerts@acme.example")
	if fromAddress() != "alerts@acme.example" {
		t.Error("env from")
	}
	t.Setenv("RESEND_FROM_EMAIL", "")
	if !strings.Contains(fromAddress(), "@") {
		t.Error("default from")
	}
}
