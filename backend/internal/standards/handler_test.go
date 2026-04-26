package standards

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/jasonreid/probatus/internal/middleware"
)

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

type errRow struct{ err error }

func (r *errRow) Scan(...any) error { return r.err }

type emptyRows struct{ err error }

func (e *emptyRows) Close()                                       {}
func (e *emptyRows) Err() error                                   { return e.err }
func (e *emptyRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (e *emptyRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (e *emptyRows) Next() bool                                   { return false }
func (e *emptyRows) Scan(...any) error                            { return e.err }
func (e *emptyRows) Values() ([]any, error)                       { return nil, e.err }
func (e *emptyRows) RawValues() [][]byte                          { return nil }
func (e *emptyRows) Conn() *pgx.Conn                              { return nil }

type mockDB struct {
	queryErr   error
	queryRowFn func() pgx.Row
	execTag    pgconn.CommandTag
	execErr    error
}

func (m *mockDB) Query(_ context.Context, _ string, _ ...any) (pgx.Rows, error) {
	if m.queryErr != nil {
		return nil, m.queryErr
	}
	return &emptyRows{}, nil
}

func (m *mockDB) QueryRow(_ context.Context, _ string, _ ...any) pgx.Row {
	if m.queryRowFn != nil {
		return m.queryRowFn()
	}
	return &errRow{err: pgx.ErrNoRows}
}

func (m *mockDB) Exec(_ context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
	return m.execTag, m.execErr
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func newHandler(db querier) *Handler { return &Handler{pool: db} }

func withTenant(r *http.Request) *http.Request {
	return r.WithContext(middleware.WithTenantID(r.Context(), "tenant-1"))
}

func withTenantAndRole(r *http.Request, role string) *http.Request {
	ctx := middleware.WithTenantID(r.Context(), "tenant-1")
	ctx = middleware.WithRole(ctx, role)
	return r.WithContext(ctx)
}

func routeWithID(r *http.Request, id string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

func TestList_DBError(t *testing.T) {
	h := newHandler(&mockDB{queryErr: fmt.Errorf("db down")})
	req := withTenant(httptest.NewRequest(http.MethodGet, "/standards", nil))
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
}

func TestList_ReturnsEmptySlice(t *testing.T) {
	h := newHandler(&mockDB{})
	req := withTenant(httptest.NewRequest(http.MethodGet, "/standards", nil))
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

func TestGet_NotFound(t *testing.T) {
	h := newHandler(&mockDB{})
	req := routeWithID(withTenant(httptest.NewRequest(http.MethodGet, "/standards/abc", nil)), "abc")
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

func TestCreate_BadJSON(t *testing.T) {
	h := newHandler(nil)
	req := withTenant(httptest.NewRequest(http.MethodPost, "/standards", strings.NewReader(`{bad}`)))
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestCreate_InvalidCalibratedAt(t *testing.T) {
	h := newHandler(nil)
	body := `{"name":"Ref-1","calibrated_at":"not-a-date"}`
	req := withTenant(httptest.NewRequest(http.MethodPost, "/standards", strings.NewReader(body)))
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestCreate_InvalidDueAt(t *testing.T) {
	h := newHandler(nil)
	body := `{"name":"Ref-1","due_at":"not-a-date"}`
	req := withTenant(httptest.NewRequest(http.MethodPost, "/standards", strings.NewReader(body)))
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

func TestUpdate_BadJSON(t *testing.T) {
	h := newHandler(nil)
	req := routeWithID(withTenant(httptest.NewRequest(http.MethodPut, "/standards/abc", strings.NewReader(`{bad}`))), "abc")
	rec := httptest.NewRecorder()
	h.Update(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestUpdate_NotFound(t *testing.T) {
	h := newHandler(&mockDB{})
	req := routeWithID(withTenant(httptest.NewRequest(http.MethodPut, "/standards/abc", strings.NewReader(`{"name":"X"}`))), "abc")
	rec := httptest.NewRecorder()
	h.Update(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

func TestDelete_NotFound(t *testing.T) {
	h := newHandler(&mockDB{}) // Exec returns 0 rows
	req := routeWithID(withTenant(httptest.NewRequest(http.MethodDelete, "/standards/abc", nil)), "abc")
	rec := httptest.NewRecorder()
	h.Delete(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestDelete_DBError(t *testing.T) {
	h := newHandler(&mockDB{execErr: fmt.Errorf("db down")})
	req := routeWithID(withTenant(httptest.NewRequest(http.MethodDelete, "/standards/abc", nil)), "abc")
	rec := httptest.NewRecorder()
	h.Delete(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Recall
// ---------------------------------------------------------------------------

func TestRecall_Forbidden(t *testing.T) {
	h := newHandler(nil) // DB never reached
	req := routeWithID(
		withTenantAndRole(httptest.NewRequest(http.MethodPost, "/standards/abc/recall", strings.NewReader(`{"recall_reason":"bad batch"}`)), "technician"),
		"abc",
	)
	rec := httptest.NewRecorder()
	h.Recall(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
}

func TestRecall_BadJSON(t *testing.T) {
	h := newHandler(nil) // DB never reached
	req := routeWithID(
		withTenantAndRole(httptest.NewRequest(http.MethodPost, "/standards/abc/recall", strings.NewReader(`{bad}`)), "supervisor"),
		"abc",
	)
	rec := httptest.NewRecorder()
	h.Recall(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestRecall_MissingReason(t *testing.T) {
	h := newHandler(nil) // DB never reached
	req := routeWithID(
		withTenantAndRole(httptest.NewRequest(http.MethodPost, "/standards/abc/recall", strings.NewReader(`{"recall_reason":""}`)), "supervisor"),
		"abc",
	)
	rec := httptest.NewRecorder()
	h.Recall(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestRecall_DBError(t *testing.T) {
	h := newHandler(&mockDB{execErr: fmt.Errorf("db down")})
	req := routeWithID(
		withTenantAndRole(httptest.NewRequest(http.MethodPost, "/standards/abc/recall", strings.NewReader(`{"recall_reason":"bad batch"}`)), "supervisor"),
		"abc",
	)
	rec := httptest.NewRecorder()
	h.Recall(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
}

func TestRecall_Success(t *testing.T) {
	tag := pgconn.NewCommandTag("UPDATE 3")
	h := newHandler(&mockDB{execTag: tag})
	req := routeWithID(
		withTenantAndRole(httptest.NewRequest(http.MethodPost, "/standards/abc/recall", strings.NewReader(`{"recall_reason":"bad batch"}`)), "supervisor"),
		"abc",
	)
	rec := httptest.NewRecorder()
	h.Recall(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	var out map[string]int64
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out["recalled"] != 3 {
		t.Errorf("expected recalled=3, got %d", out["recalled"])
	}
}
