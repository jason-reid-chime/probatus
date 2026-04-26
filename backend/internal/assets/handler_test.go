package assets

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
// Minimal pgx.Row / pgx.Rows stubs
// ---------------------------------------------------------------------------

type errRow struct{ err error }

func (r *errRow) Scan(...any) error { return r.err }

type emptyRows struct{ err error }

func (e *emptyRows) Close()                                          {}
func (e *emptyRows) Err() error                                      { return e.err }
func (e *emptyRows) CommandTag() pgconn.CommandTag                   { return pgconn.CommandTag{} }
func (e *emptyRows) FieldDescriptions() []pgconn.FieldDescription    { return nil }
func (e *emptyRows) Next() bool                                      { return false }
func (e *emptyRows) Scan(...any) error                               { return e.err }
func (e *emptyRows) Values() ([]any, error)                          { return nil, e.err }
func (e *emptyRows) RawValues() [][]byte                             { return nil }
func (e *emptyRows) Conn() *pgx.Conn                                 { return nil }

// ---------------------------------------------------------------------------
// Mock querier
// ---------------------------------------------------------------------------

type mockDB struct {
	queryErr    error
	queryRowFn  func() pgx.Row
	execTag     pgconn.CommandTag
	execErr     error
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

func withTenantCtx(r *http.Request, tenantID string) *http.Request {
	return r.WithContext(middleware.WithTenantID(r.Context(), tenantID))
}

func routeWithID(r *http.Request, id string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

func routeWithTagID(r *http.Request, tagID string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("tagId", tagID)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

func TestList_DBError(t *testing.T) {
	h := newHandler(&mockDB{queryErr: fmt.Errorf("db down")})
	req := withTenantCtx(httptest.NewRequest(http.MethodGet, "/assets", nil), "tenant-1")
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
}

func TestList_ReturnsEmptySlice(t *testing.T) {
	h := newHandler(&mockDB{}) // Query returns emptyRows{}, no error
	req := withTenantCtx(httptest.NewRequest(http.MethodGet, "/assets", nil), "tenant-1")
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	var out []any
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(out) != 0 {
		t.Errorf("expected empty slice, got %d items", len(out))
	}
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

func TestCreate_BadJSON(t *testing.T) {
	h := newHandler(nil) // DB never reached
	req := withTenantCtx(
		httptest.NewRequest(http.MethodPost, "/assets", strings.NewReader(`{bad}`)),
		"tenant-1",
	)
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestCreate_UniqueViolation(t *testing.T) {
	dupErr := &pgconn.PgError{Code: "23505"}
	h := newHandler(&mockDB{
		queryRowFn: func() pgx.Row { return &errRow{err: dupErr} },
	})
	body := `{"tag_id":"TAG-001","serial_number":"S1","manufacturer":"Acme","model":"M1","instrument_type":"pressure"}`
	req := withTenantCtx(
		httptest.NewRequest(http.MethodPost, "/assets", strings.NewReader(body)),
		"tenant-1",
	)
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

func TestGet_NotFound(t *testing.T) {
	h := newHandler(&mockDB{}) // QueryRow returns ErrNoRows by default
	req := routeWithID(
		withTenantCtx(httptest.NewRequest(http.MethodGet, "/assets/abc", nil), "tenant-1"),
		"abc",
	)
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

func TestDelete_NotFound(t *testing.T) {
	// Exec returns 0 rows affected (zero CommandTag)
	h := newHandler(&mockDB{})
	req := routeWithID(
		withTenantCtx(httptest.NewRequest(http.MethodDelete, "/assets/abc", nil), "tenant-1"),
		"abc",
	)
	rec := httptest.NewRecorder()
	h.Delete(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// GetByTagID
// ---------------------------------------------------------------------------

func TestGetByTagID_NotFound(t *testing.T) {
	h := newHandler(&mockDB{}) // QueryRow returns ErrNoRows by default
	req := routeWithTagID(
		withTenantCtx(httptest.NewRequest(http.MethodGet, "/assets/tag/T-999", nil), "tenant-1"),
		"T-999",
	)
	rec := httptest.NewRecorder()
	h.GetByTagID(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

func TestSchedule_Success(t *testing.T) {
	h := newHandler(&mockDB{}) // Query returns emptyRows{}, no error
	req := withTenantCtx(httptest.NewRequest(http.MethodGet, "/assets/schedule?days=30", nil), "tenant-1")
	rec := httptest.NewRecorder()
	h.Schedule(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	var out []any
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(out) != 0 {
		t.Errorf("expected empty slice, got %d items", len(out))
	}
}

func TestSchedule_DBError(t *testing.T) {
	h := newHandler(&mockDB{queryErr: fmt.Errorf("db down")})
	req := withTenantCtx(httptest.NewRequest(http.MethodGet, "/assets/schedule?days=30", nil), "tenant-1")
	rec := httptest.NewRecorder()
	h.Schedule(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
}

func TestSchedule_CustomDays(t *testing.T) {
	h := newHandler(&mockDB{}) // Query returns emptyRows{}, no error
	req := withTenantCtx(httptest.NewRequest(http.MethodGet, "/assets/schedule?days=60", nil), "tenant-1")
	rec := httptest.NewRecorder()
	h.Schedule(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}
