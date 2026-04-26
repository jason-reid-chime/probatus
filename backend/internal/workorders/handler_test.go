package workorders

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
// Minimal pgx stubs
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

// mockTx is a pgx.Tx stub used for Create/Update transaction tests.
type mockTx struct {
	queryRowFn func() pgx.Row
	execTag    pgconn.CommandTag
	execErr    error
	commitErr  error
}

func (tx *mockTx) QueryRow(_ context.Context, _ string, _ ...any) pgx.Row {
	if tx.queryRowFn != nil {
		return tx.queryRowFn()
	}
	return &errRow{err: pgx.ErrNoRows}
}

func (tx *mockTx) Exec(_ context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
	return tx.execTag, tx.execErr
}

func (tx *mockTx) Commit(_ context.Context) error { return tx.commitErr }
func (tx *mockTx) Rollback(_ context.Context) error { return nil }

// Satisfy the rest of pgx.Tx (unused in handler tests).
func (tx *mockTx) Begin(_ context.Context) (pgx.Tx, error) { return nil, nil }
func (tx *mockTx) CopyFrom(_ context.Context, _ pgx.Identifier, _ []string, _ pgx.CopyFromSource) (int64, error) {
	return 0, nil
}
func (tx *mockTx) SendBatch(_ context.Context, _ *pgx.Batch) pgx.BatchResults { return nil }
func (tx *mockTx) LargeObjects() pgx.LargeObjects                              { return pgx.LargeObjects{} }
func (tx *mockTx) Prepare(_ context.Context, _, _ string) (*pgconn.StatementDescription, error) {
	return nil, nil
}
func (tx *mockTx) Query(_ context.Context, _ string, _ ...any) (pgx.Rows, error) {
	return &emptyRows{}, nil
}
func (tx *mockTx) Conn() *pgx.Conn { return nil }

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

type mockDB struct {
	queryErr   error
	queryRowFn func() pgx.Row
	execTag    pgconn.CommandTag
	execErr    error
	beginErr   error
	tx         *mockTx
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

func (m *mockDB) Begin(_ context.Context) (pgx.Tx, error) {
	if m.beginErr != nil {
		return nil, m.beginErr
	}
	if m.tx != nil {
		return m.tx, nil
	}
	return &mockTx{}, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func newHandler(db querier) *Handler { return &Handler{pool: db} }

func withTenant(r *http.Request) *http.Request {
	return r.WithContext(middleware.WithTenantID(r.Context(), "tenant-1"))
}

func withTenantAndUser(r *http.Request) *http.Request {
	ctx := middleware.WithTenantID(r.Context(), "tenant-1")
	ctx = middleware.WithUserID(ctx, "user-1")
	return r.WithContext(ctx)
}

func withTenantUserAndRole(r *http.Request, role string) *http.Request {
	ctx := middleware.WithTenantID(r.Context(), "tenant-1")
	ctx = middleware.WithUserID(ctx, "user-1")
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
	req := withTenant(httptest.NewRequest(http.MethodGet, "/work-orders", nil))
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
}

func TestList_Success(t *testing.T) {
	h := newHandler(&mockDB{})
	req := withTenant(httptest.NewRequest(http.MethodGet, "/work-orders", nil))
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	var result []*WorkOrder
	json.NewDecoder(rec.Body).Decode(&result) //nolint:errcheck
	if result == nil {
		t.Error("expected non-nil slice")
	}
}

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

func TestGet_NotFound(t *testing.T) {
	h := newHandler(&mockDB{})
	req := routeWithID(
		withTenant(httptest.NewRequest(http.MethodGet, "/work-orders/wo1", nil)),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestGet_DBError(t *testing.T) {
	h := newHandler(&mockDB{queryRowFn: func() pgx.Row { return &errRow{err: fmt.Errorf("db error")} }})
	req := routeWithID(
		withTenant(httptest.NewRequest(http.MethodGet, "/work-orders/wo1", nil)),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

func TestCreate_TechnicianForbidden(t *testing.T) {
	h := newHandler(nil)
	req := withTenantUserAndRole(
		httptest.NewRequest(http.MethodPost, "/work-orders", strings.NewReader(`{}`)),
		"technician",
	)
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
}

func TestCreate_BadJSON(t *testing.T) {
	h := newHandler(nil)
	req := withTenantUserAndRole(
		httptest.NewRequest(http.MethodPost, "/work-orders", strings.NewReader(`{bad`)),
		"supervisor",
	)
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestCreate_MissingTitle(t *testing.T) {
	h := newHandler(nil)
	body := `{"scheduled_date":"2026-05-01"}`
	req := withTenantUserAndRole(
		httptest.NewRequest(http.MethodPost, "/work-orders", strings.NewReader(body)),
		"admin",
	)
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestCreate_MissingScheduledDate(t *testing.T) {
	h := newHandler(nil)
	body := `{"title":"Inspection"}`
	req := withTenantUserAndRole(
		httptest.NewRequest(http.MethodPost, "/work-orders", strings.NewReader(body)),
		"admin",
	)
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestCreate_BeginFails(t *testing.T) {
	h := newHandler(&mockDB{beginErr: fmt.Errorf("pool exhausted")})
	body := `{"title":"Inspection","scheduled_date":"2026-05-01"}`
	req := withTenantUserAndRole(
		httptest.NewRequest(http.MethodPost, "/work-orders", strings.NewReader(body)),
		"supervisor",
	)
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
}

func TestCreate_InsertFails(t *testing.T) {
	tx := &mockTx{queryRowFn: func() pgx.Row { return &errRow{err: fmt.Errorf("constraint")} }}
	h := newHandler(&mockDB{tx: tx})
	body := `{"title":"Inspection","scheduled_date":"2026-05-01"}`
	req := withTenantUserAndRole(
		httptest.NewRequest(http.MethodPost, "/work-orders", strings.NewReader(body)),
		"supervisor",
	)
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
}

func TestCreate_Success(t *testing.T) {
	tx := &mockTx{queryRowFn: func() pgx.Row { return &idRow{id: "wo-new"} }}
	h := newHandler(&mockDB{tx: tx})
	body := `{"title":"Monthly Inspection","scheduled_date":"2026-05-01","asset_ids":[],"technician_ids":[]}`
	req := withTenantUserAndRole(
		httptest.NewRequest(http.MethodPost, "/work-orders", strings.NewReader(body)),
		"supervisor",
	)
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d", rec.Code)
	}
	var resp map[string]string
	json.NewDecoder(rec.Body).Decode(&resp) //nolint:errcheck
	if resp["id"] != "wo-new" {
		t.Errorf("expected id=wo-new, got %q", resp["id"])
	}
}

func TestCreate_AdminAllowed(t *testing.T) {
	tx := &mockTx{queryRowFn: func() pgx.Row { return &idRow{id: "wo-admin"} }}
	h := newHandler(&mockDB{tx: tx})
	body := `{"title":"Audit","scheduled_date":"2026-06-01"}`
	req := withTenantUserAndRole(
		httptest.NewRequest(http.MethodPost, "/work-orders", strings.NewReader(body)),
		"admin",
	)
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d", rec.Code)
	}
}

func TestCreate_DefaultsStatusToOpen(t *testing.T) {
	tx := &mockTx{queryRowFn: func() pgx.Row { return &idRow{id: "wo-1"} }}
	h := newHandler(&mockDB{tx: tx})
	// No status in body — handler should default to "open"
	body := `{"title":"Test","scheduled_date":"2026-05-01"}`
	req := withTenantUserAndRole(
		httptest.NewRequest(http.MethodPost, "/work-orders", strings.NewReader(body)),
		"admin",
	)
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

func TestUpdate_BadJSON(t *testing.T) {
	h := newHandler(&mockDB{})
	req := routeWithID(
		withTenant(httptest.NewRequest(http.MethodPut, "/work-orders/wo1", strings.NewReader(`{bad`))),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.Update(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestUpdate_BeginFails(t *testing.T) {
	h := newHandler(&mockDB{beginErr: fmt.Errorf("pool exhausted")})
	req := routeWithID(
		withTenant(httptest.NewRequest(http.MethodPut, "/work-orders/wo1", strings.NewReader(`{"title":"X"}`))),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.Update(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
}

func TestUpdate_NotFound(t *testing.T) {
	tx := &mockTx{execTag: pgconn.NewCommandTag("UPDATE 0")}
	h := newHandler(&mockDB{tx: tx})
	req := routeWithID(
		withTenant(httptest.NewRequest(http.MethodPut, "/work-orders/wo1", strings.NewReader(`{"title":"X"}`))),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.Update(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestUpdate_Success(t *testing.T) {
	tx := &mockTx{execTag: pgconn.NewCommandTag("UPDATE 1")}
	h := newHandler(&mockDB{tx: tx})
	req := routeWithID(
		withTenant(httptest.NewRequest(http.MethodPut, "/work-orders/wo1", strings.NewReader(`{"title":"Updated"}`))),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.Update(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

func TestDelete_TechnicianForbidden(t *testing.T) {
	h := newHandler(nil)
	req := routeWithID(
		withTenantUserAndRole(httptest.NewRequest(http.MethodDelete, "/work-orders/wo1", nil), "technician"),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.Delete(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
}

func TestDelete_NotFound(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("DELETE 0")})
	req := routeWithID(
		withTenantUserAndRole(httptest.NewRequest(http.MethodDelete, "/work-orders/wo1", nil), "admin"),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.Delete(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestDelete_DBError(t *testing.T) {
	h := newHandler(&mockDB{execErr: fmt.Errorf("fk violation")})
	req := routeWithID(
		withTenantUserAndRole(httptest.NewRequest(http.MethodDelete, "/work-orders/wo1", nil), "supervisor"),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.Delete(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
}

func TestDelete_Success(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("DELETE 1")})
	req := routeWithID(
		withTenantUserAndRole(httptest.NewRequest(http.MethodDelete, "/work-orders/wo1", nil), "supervisor"),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.Delete(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// UpdateStatus
// ---------------------------------------------------------------------------

func TestUpdateStatus_BadJSON(t *testing.T) {
	h := newHandler(&mockDB{})
	req := routeWithID(
		withTenant(httptest.NewRequest(http.MethodPatch, "/work-orders/wo1/status", strings.NewReader(`{bad`))),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.UpdateStatus(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestUpdateStatus_InvalidStatus(t *testing.T) {
	h := newHandler(&mockDB{})
	req := routeWithID(
		withTenant(httptest.NewRequest(http.MethodPatch, "/work-orders/wo1/status", strings.NewReader(`{"status":"banana"}`))),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.UpdateStatus(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestUpdateStatus_NotFound(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("UPDATE 0")})
	req := routeWithID(
		withTenant(httptest.NewRequest(http.MethodPatch, "/work-orders/wo1/status", strings.NewReader(`{"status":"completed"}`))),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.UpdateStatus(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestUpdateStatus_Success_Open(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("UPDATE 1")})
	req := routeWithID(
		withTenant(httptest.NewRequest(http.MethodPatch, "/work-orders/wo1/status", strings.NewReader(`{"status":"open"}`))),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.UpdateStatus(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestUpdateStatus_Success_InProgress(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("UPDATE 1")})
	req := routeWithID(
		withTenant(httptest.NewRequest(http.MethodPatch, "/work-orders/wo1/status", strings.NewReader(`{"status":"in_progress"}`))),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.UpdateStatus(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestUpdateStatus_Success_Completed(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("UPDATE 1")})
	req := routeWithID(
		withTenant(httptest.NewRequest(http.MethodPatch, "/work-orders/wo1/status", strings.NewReader(`{"status":"completed"}`))),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.UpdateStatus(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestUpdateStatus_Success_Cancelled(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("UPDATE 1")})
	req := routeWithID(
		withTenant(httptest.NewRequest(http.MethodPatch, "/work-orders/wo1/status", strings.NewReader(`{"status":"cancelled"}`))),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.UpdateStatus(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestUpdateStatus_TechnicianAllowed(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("UPDATE 1")})
	req := routeWithID(
		withTenantUserAndRole(httptest.NewRequest(http.MethodPatch, "/work-orders/wo1/status", strings.NewReader(`{"status":"in_progress"}`)), "technician"),
		"wo1",
	)
	rec := httptest.NewRecorder()
	h.UpdateStatus(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (technicians can update status), got %d", rec.Code)
	}
}
