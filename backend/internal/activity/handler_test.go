package activity

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jasonreid/probatus/internal/middleware"
	"github.com/jasonreid/probatus/internal/testutil"
)

func req(query, role string) *http.Request {
	r := httptest.NewRequest("GET", "/activity?"+query, nil)
	ctx := middleware.WithTenantID(r.Context(), "t1")
	ctx = middleware.WithRole(ctx, role)
	return r.WithContext(ctx)
}

func entryRow(id int64, action string, old, new string) []any {
	var o, n []byte
	if old != "" {
		o = []byte(old)
	}
	if new != "" {
		n = []byte(new)
	}
	return []any{id, time.Now(), "u1", "Sue", "assets", "a1", nil, action, o, n}
}

func TestListPermissions(t *testing.T) {
	h := NewHandler(nil)
	cases := []struct {
		query, role string
		want        int
	}{
		{"", "technician", 403},
		{"record_id=a1", "customer", 403},
	}
	for _, c := range cases {
		w := httptest.NewRecorder()
		h.List(w, req(c.query, c.role))
		if w.Code != c.want {
			t.Errorf("%q as %s: %d, want %d", c.query, c.role, w.Code, c.want)
		}
	}
}

func TestListTechnicianCanSeeRecordHistory(t *testing.T) {
	db := testutil.New(testutil.Rule{Match: "FROM audit_log", Rows: [][]any{entryRow(1, "INSERT", "", `{"tag_id":"PT-1"}`)}})
	w := httptest.NewRecorder()
	(&Handler{pool: db}).List(w, req("record_id=a1", "technician"))
	if w.Code != 200 {
		t.Fatalf("got %d", w.Code)
	}
	if !strings.Contains(db.Calls[0].SQL, "a.parent_id = $2::uuid") {
		t.Errorf("record history should include children: %s", db.Calls[0].SQL)
	}
}

func TestListFiltersAndDiff(t *testing.T) {
	db := testutil.New(testutil.Rule{Match: "FROM audit_log", Rows: [][]any{
		entryRow(9, "UPDATE", `{"id":"a1","tag_id":"PT-1","location":"Bay 3","notes":null,"updated_at":"x"}`,
			`{"id":"a1","tag_id":"PT-1","location":"Bay 9","notes":"","updated_at":"y"}`),
	}})
	w := httptest.NewRecorder()
	(&Handler{pool: db}).List(w, req("table=assets&user_id=u1&action=update&from=2026-01-01&to=2026-12-31&before_id=100&limit=10", "admin"))
	var out []Entry
	json.Unmarshal(w.Body.Bytes(), &out)
	if w.Code != 200 || len(out) != 1 {
		t.Fatalf("list: %d %s", w.Code, w.Body)
	}
	e := out[0]
	if e.Label != "PT-1" || len(e.Changes) != 1 || e.Changes[0].Field != "location" || e.Changes[0].New != "Bay 9" {
		t.Errorf("diff wrong: %+v", e)
	}
	sql := db.Calls[0].SQL
	for _, want := range []string{"a.table_name = $2", "a.user_id = $3", "a.action = $4", "a.created_at >= $5", "a.created_at < $6", "a.id < $7", "LIMIT $8"} {
		if !strings.Contains(sql, want) {
			t.Errorf("missing %q in %s", want, sql)
		}
	}
	if db.Calls[0].Args[7] != 10 {
		t.Errorf("limit arg %v", db.Calls[0].Args[7])
	}
}

func TestListDBError(t *testing.T) {
	w := httptest.NewRecorder()
	(&Handler{pool: testutil.New(testutil.Rule{Match: "FROM audit_log", Err: errors.New("boom")})}).List(w, req("", "admin"))
	if w.Code != 500 {
		t.Errorf("got %d", w.Code)
	}
}

func TestDiffInsertDelete(t *testing.T) {
	ins := diff(nil, map[string]any{"id": "x", "name": "Acme", "created_at": "t"})
	if len(ins) != 1 || ins[0].Field != "name" || ins[0].Old != nil {
		t.Errorf("insert diff: %+v", ins)
	}
	del := diff(map[string]any{"name": "Acme"}, nil)
	if len(del) != 1 || del[0].New != nil {
		t.Errorf("delete diff: %+v", del)
	}
}

func TestLabel(t *testing.T) {
	if label(map[string]any{"number": float64(12)}) != "#12" {
		t.Error("invoice number label")
	}
	if label(nil, map[string]any{"title": "Spring PM"}) != "Spring PM" {
		t.Error("falls back to old row")
	}
	if label(map[string]any{"other": 1}) != "" {
		t.Error("no label field")
	}
	if decode([]byte("not json")) != nil {
		t.Error("bad json should decode to nil")
	}
}

func TestVerify(t *testing.T) {
	w := httptest.NewRecorder()
	NewHandler(nil).Verify(w, req("", "technician"))
	if w.Code != 403 {
		t.Errorf("technician: %d", w.Code)
	}

	db := testutil.New(testutil.Rule{Match: "audit_log_verify", Rows: [][]any{{int64(42), nil}}})
	w = httptest.NewRecorder()
	(&Handler{pool: db}).Verify(w, req("", "admin"))
	if !strings.Contains(w.Body.String(), `"ok":true`) || !strings.Contains(w.Body.String(), `"checked":42`) {
		t.Errorf("intact: %s", w.Body)
	}

	db = testutil.New(testutil.Rule{Match: "audit_log_verify", Rows: [][]any{{int64(42), int64(17)}}})
	w = httptest.NewRecorder()
	(&Handler{pool: db}).Verify(w, req("", "supervisor"))
	if !strings.Contains(w.Body.String(), `"ok":false`) || !strings.Contains(w.Body.String(), `"first_broken_id":17`) {
		t.Errorf("broken: %s", w.Body)
	}

	db = testutil.New(testutil.Rule{Match: "audit_log_verify", Err: errors.New("boom")})
	w = httptest.NewRecorder()
	(&Handler{pool: db}).Verify(w, req("", "admin"))
	if w.Code != 500 {
		t.Errorf("error: %d", w.Code)
	}
}
