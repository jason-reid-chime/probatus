package stats

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/jasonreid/probatus/internal/middleware"
)

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

// scanRow returns the given values one per Scan call in sequence.
type scanRow struct {
	vals []any
	err  error
}

func (s *scanRow) Scan(dest ...any) error {
	if s.err != nil {
		return s.err
	}
	for i, d := range dest {
		if i >= len(s.vals) {
			break
		}
		switch p := d.(type) {
		case *int:
			*p = s.vals[i].(int)
		case *float64:
			*p = s.vals[i].(float64)
		}
	}
	return nil
}

// multiRow cycles through a slice of scanRows for successive QueryRow calls.
type mockDB struct {
	rows []*scanRow
	idx  int
}

func (m *mockDB) QueryRow(_ context.Context, _ string, _ ...any) pgx.Row {
	if m.idx >= len(m.rows) {
		return &scanRow{err: fmt.Errorf("unexpected QueryRow call")}
	}
	r := m.rows[m.idx]
	m.idx++
	return r
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func newHandler(db querier) *Handler { return &Handler{pool: db} }

func tenantReq() *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/stats/dashboard", nil)
	return r.WithContext(middleware.WithTenantID(r.Context(), "tenant-1"))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func TestDashboard_FirstQueryError(t *testing.T) {
	h := newHandler(&mockDB{rows: []*scanRow{
		{err: fmt.Errorf("db down")},
	}})
	rec := httptest.NewRecorder()
	h.Dashboard(rec, tenantReq())
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
}

func TestDashboard_Success(t *testing.T) {
	// Five QueryRow calls: overdue, due_within_30, due_within_90,
	// standards_expiring_soon, and pass-rate (two ints in one scan).
	h := newHandler(&mockDB{rows: []*scanRow{
		{vals: []any{2}},          // overdue_count
		{vals: []any{3}},          // due_within_30
		{vals: []any{5}},          // due_within_90
		{vals: []any{1}},          // standards_expiring_soon
		{vals: []any{10, 8}},      // total, passed → pass_rate = 0.8
	}})
	rec := httptest.NewRecorder()
	h.Dashboard(rec, tenantReq())
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var resp DashboardResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.OverdueCount != 2 {
		t.Errorf("overdue_count: want 2, got %d", resp.OverdueCount)
	}
	if resp.DueWithin30 != 3 {
		t.Errorf("due_within_30: want 3, got %d", resp.DueWithin30)
	}
	if resp.PassRate30d != 0.8 {
		t.Errorf("pass_rate_30d: want 0.8, got %f", resp.PassRate30d)
	}
}
