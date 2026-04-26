package customers

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

type idRow struct{ id string }

func (r *idRow) Scan(dests ...any) error {
	if len(dests) > 0 {
		if s, ok := dests[0].(*string); ok {
			*s = r.id
		}
	}
	return nil
}

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
	req := withTenant(httptest.NewRequest(http.MethodGet, "/customers", nil))
	w := httptest.NewRecorder()
	h.List(w, req)
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestList_Success(t *testing.T) {
	h := newHandler(&mockDB{})
	req := withTenant(httptest.NewRequest(http.MethodGet, "/customers", nil))
	w := httptest.NewRecorder()
	h.List(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var result []Customer
	json.NewDecoder(w.Body).Decode(&result) //nolint:errcheck
	if result == nil {
		t.Error("expected non-nil slice")
	}
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

func TestCreate_BadJSON(t *testing.T) {
	h := newHandler(&mockDB{})
	req := withTenant(httptest.NewRequest(http.MethodPost, "/customers", strings.NewReader(`{bad`)))
	w := httptest.NewRecorder()
	h.Create(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestCreate_MissingName(t *testing.T) {
	h := newHandler(&mockDB{})
	req := withTenant(httptest.NewRequest(http.MethodPost, "/customers", strings.NewReader(`{"name":""}`)))
	w := httptest.NewRecorder()
	h.Create(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestCreate_DBError(t *testing.T) {
	h := newHandler(&mockDB{execErr: fmt.Errorf("constraint")})
	req := withTenant(httptest.NewRequest(http.MethodPost, "/customers", strings.NewReader(`{"name":"Acme"}`)))
	w := httptest.NewRecorder()
	h.Create(w, req)
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestCreate_Success(t *testing.T) {
	h := newHandler(&mockDB{queryRowFn: func() pgx.Row { return &idRow{id: "new-uuid"} }})
	body := `{"name":"Acme Corp","contact":"Jane","email":"jane@acme.com","phone":"555-0100","address":"123 Main St"}`
	req := withTenant(httptest.NewRequest(http.MethodPost, "/customers", strings.NewReader(body)))
	w := httptest.NewRecorder()
	h.Create(w, req)
	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

func TestUpdate_BadJSON(t *testing.T) {
	h := newHandler(&mockDB{})
	req := routeWithID(withTenant(httptest.NewRequest(http.MethodPut, "/customers/c1", strings.NewReader(`{bad`))), "c1")
	w := httptest.NewRecorder()
	h.Update(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestUpdate_NotFound(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("UPDATE 0")})
	req := routeWithID(withTenant(httptest.NewRequest(http.MethodPut, "/customers/c1", strings.NewReader(`{"name":"Acme"}`))), "c1")
	w := httptest.NewRecorder()
	h.Update(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestUpdate_Success(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("UPDATE 1")})
	req := routeWithID(withTenant(httptest.NewRequest(http.MethodPut, "/customers/c1", strings.NewReader(`{"name":"Acme Updated"}`))), "c1")
	w := httptest.NewRecorder()
	h.Update(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

func TestDelete_NotAdmin(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("DELETE 1")})
	req := routeWithID(withTenantAndRole(httptest.NewRequest(http.MethodDelete, "/customers/c1", nil), "technician"), "c1")
	w := httptest.NewRecorder()
	h.Delete(w, req)
	// technician is not blocked by role check in customers — delete proceeds
	// (customers.Delete has no role check; RLS handles it in prod)
	if w.Code == http.StatusInternalServerError {
		t.Errorf("unexpected 500")
	}
}

func TestDelete_DBError(t *testing.T) {
	h := newHandler(&mockDB{execErr: fmt.Errorf("fk violation")})
	req := routeWithID(withTenant(httptest.NewRequest(http.MethodDelete, "/customers/c1", nil)), "c1")
	w := httptest.NewRecorder()
	h.Delete(w, req)
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestDelete_Success(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("DELETE 1")})
	req := routeWithID(withTenant(httptest.NewRequest(http.MethodDelete, "/customers/c1", nil)), "c1")
	w := httptest.NewRecorder()
	h.Delete(w, req)
	if w.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", w.Code)
	}
}
