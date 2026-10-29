package calibrations

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/jasonreid/probatus/internal/middleware"
)

// ---------------------------------------------------------------------------
// Minimal pgx stubs (shared with assets tests pattern)
// ---------------------------------------------------------------------------

type errRow struct{ err error }

func (r *errRow) Scan(...any) error { return r.err }

// zeroRow satisfies pgx.Row by writing zero values for each destination pointer.
type zeroRow struct{}

func (z zeroRow) Scan(dests ...any) error {
	for _, d := range dests {
		switch v := d.(type) {
		case **string:
			*v = nil
		case *string:
			*v = ""
		case *bool:
			*v = false
		case *int:
			*v = 0
		case *int64:
			*v = 0
		case *float64:
			*v = 0
		case *time.Time:
			*v = time.Time{}
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

// ---------------------------------------------------------------------------
// Mock transaction
// ---------------------------------------------------------------------------

type mockTx struct {
	execCalls  int
	execTag    pgconn.CommandTag
	execErr    error
	execFn     func(sql string) (pgconn.CommandTag, error) // overrides execTag/execErr when set
	queryRowFn func() pgx.Row
	queryFn    func() (pgx.Rows, error) // nil → empty result
	commitErr  error

	// Recorded calls, for assertions.
	execSQL    []string
	execArgs   [][]any
	querySQL   []string
	queryArgs  [][]any
	committed  bool
	rolledBack bool
}

func (t *mockTx) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	t.execCalls++
	t.execSQL = append(t.execSQL, sql)
	t.execArgs = append(t.execArgs, args)
	if t.execFn != nil {
		return t.execFn(sql)
	}
	return t.execTag, t.execErr
}
func (t *mockTx) QueryRow(_ context.Context, _ string, _ ...any) pgx.Row {
	if t.queryRowFn != nil {
		return t.queryRowFn()
	}
	return &errRow{err: pgx.ErrNoRows}
}
func (t *mockTx) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	t.querySQL = append(t.querySQL, sql)
	t.queryArgs = append(t.queryArgs, args)
	if t.queryFn != nil {
		return t.queryFn()
	}
	return &emptyRows{}, nil
}
func (t *mockTx) Commit(_ context.Context) error {
	if t.commitErr == nil {
		t.committed = true
	}
	return t.commitErr
}
func (t *mockTx) Rollback(_ context.Context) error {
	if !t.committed {
		t.rolledBack = true
	}
	return nil
}

// Satisfy remaining pgx.Tx interface methods (unused in handler code).
func (t *mockTx) Begin(_ context.Context) (pgx.Tx, error) { return nil, nil }
func (t *mockTx) CopyFrom(_ context.Context, _ pgx.Identifier, _ []string, _ pgx.CopyFromSource) (int64, error) {
	return 0, nil
}
func (t *mockTx) SendBatch(_ context.Context, _ *pgx.Batch) pgx.BatchResults { return nil }
func (t *mockTx) LargeObjects() pgx.LargeObjects                             { return pgx.LargeObjects{} }
func (t *mockTx) Prepare(_ context.Context, _, _ string) (*pgconn.StatementDescription, error) {
	return nil, nil
}
func (t *mockTx) Conn() *pgx.Conn { return nil }

// ---------------------------------------------------------------------------
// Mock querier
// ---------------------------------------------------------------------------

type mockDB struct {
	queryErr   error
	queryRowFn func() pgx.Row
	execTag    pgconn.CommandTag
	execErr    error
	beginErr   error
	tx         *mockTx

	mu          sync.Mutex
	queryRowSQL []string // recorded QueryRow statements
}

func (m *mockDB) Query(_ context.Context, _ string, _ ...any) (pgx.Rows, error) {
	if m.queryErr != nil {
		return nil, m.queryErr
	}
	return &emptyRows{}, nil
}

func (m *mockDB) QueryRow(_ context.Context, sql string, _ ...any) pgx.Row {
	m.mu.Lock()
	m.queryRowSQL = append(m.queryRowSQL, sql)
	m.mu.Unlock()
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
	return &mockTx{execTag: pgconn.NewCommandTag("UPDATE 1")}, nil
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
	req := withTenant(httptest.NewRequest(http.MethodGet, "/calibrations", nil))
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
}

func TestList_WithStatusFilter(t *testing.T) {
	// Empty rows → 200 with empty array
	h := newHandler(&mockDB{})
	req := withTenant(httptest.NewRequest(http.MethodGet, "/calibrations?status=approved", nil))
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

func TestCreate_BadJSON(t *testing.T) {
	h := newHandler(nil) // DB never reached
	req := withTenantAndUser(
		httptest.NewRequest(http.MethodPost, "/calibrations", strings.NewReader(`{bad}`)),
	)
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestCreate_InvalidPerformedAt(t *testing.T) {
	// Valid JSON, no standard_ids → skips DB validation; bad date → 400
	h := newHandler(nil)
	body := `{"asset_id":"asset-1","performed_at":"not-a-valid-date","standard_ids":[]}`
	req := withTenantAndUser(
		httptest.NewRequest(http.MethodPost, "/calibrations", strings.NewReader(body)),
	)
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestCreate_InsertErrorMapping(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"missing asset", &pgconn.PgError{Code: "23503", ConstraintName: "calibration_records_asset_id_fkey"}, http.StatusUnprocessableEntity},
		{"bad uuid", &pgconn.PgError{Code: "22P02", Message: "invalid input syntax for type uuid"}, http.StatusBadRequest},
		{"other db error", fmt.Errorf("connection reset"), http.StatusInternalServerError},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tx := &mockTx{queryRowFn: func() pgx.Row { return &errRow{err: tc.err} }}
			h := newHandler(&mockDB{tx: tx})
			body := `{"id":"11111111-1111-1111-1111-111111111111","asset_id":"asset-1"}`
			req := withTenantAndUser(
				httptest.NewRequest(http.MethodPost, "/calibrations", strings.NewReader(body)),
			)
			rec := httptest.NewRecorder()
			h.Create(rec, req)
			if rec.Code != tc.want {
				t.Errorf("expected %d, got %d (%s)", tc.want, rec.Code, rec.Body.String())
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

func TestGet_NotFound(t *testing.T) {
	h := newHandler(&mockDB{}) // QueryRow returns ErrNoRows
	req := routeWithID(
		withTenant(httptest.NewRequest(http.MethodGet, "/calibrations/abc", nil)),
		"abc",
	)
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------

func TestApprove_NotFound(t *testing.T) {
	h := newHandler(&mockDB{})
	req := routeWithID(
		withTenantUserAndRole(httptest.NewRequest(http.MethodPost, "/calibrations/abc/approve", strings.NewReader(`{}`)), "supervisor"),
		"abc",
	)
	rec := httptest.NewRecorder()
	h.Approve(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Approve handler — role and body validation (no DB required)
// ---------------------------------------------------------------------------

func TestApprove_TechnicianForbidden(t *testing.T) {
	h := &Handler{pool: nil}

	r := httptest.NewRequest(http.MethodPost, "/calibrations/some-id/approve", nil)
	ctx := middleware.WithRole(r.Context(), "technician")
	ctx = middleware.WithTenantID(ctx, "tenant-1")
	ctx = middleware.WithUserID(ctx, "user-1")
	r = r.WithContext(ctx)

	w := httptest.NewRecorder()
	h.Approve(w, r)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if !strings.Contains(resp["error"], "supervisors") {
		t.Errorf("unexpected error message: %q", resp["error"])
	}
}

func TestApprove_MalformedBody_Returns400(t *testing.T) {
	h := &Handler{pool: nil}

	r := httptest.NewRequest(http.MethodPost, "/calibrations/some-id/approve",
		strings.NewReader(`{not valid json}`))
	ctx := middleware.WithRole(r.Context(), "supervisor")
	ctx = middleware.WithTenantID(ctx, "tenant-1")
	ctx = middleware.WithUserID(ctx, "user-1")
	r = r.WithContext(ctx)

	w := httptest.NewRecorder()
	h.Approve(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestApprove_EmptyBody_PassesRoleCheck(t *testing.T) {
	// Empty body is valid for Approve (supervisor_signature is optional).
	// Without a DB the handler panics after the role check, but we can verify
	// the role check itself passes by confirming we do NOT get 403.
	h := &Handler{pool: nil}

	r := httptest.NewRequest(http.MethodPost, "/calibrations/some-id/approve",
		strings.NewReader(""))
	ctx := middleware.WithRole(r.Context(), "admin")
	ctx = middleware.WithTenantID(ctx, "tenant-1")
	ctx = middleware.WithUserID(ctx, "user-1")
	r = r.WithContext(ctx)

	w := httptest.NewRecorder()

	defer func() { recover() }() // pool is nil — expect panic after role check
	h.Approve(w, r)

	if w.Code == http.StatusForbidden {
		t.Error("admin role should not get 403")
	}
}

// ---------------------------------------------------------------------------
// buildCertTextLines and buildCertHTML — pure function tests
// ---------------------------------------------------------------------------

func minimalParams() buildCertHTMLParams {
	return buildCertHTMLParams{
		recordID:       "rec-1",
		tenantName:     "Valatix Inc",
		salesNumber:    "SO-100",
		performedAt:    mustParseTime("2026-01-15T10:00:00Z"),
		status:         "approved",
		techName:       "Jane Tech",
		assetTag:       "TAG-001",
		serialNumber:   "SN-999",
		manufacturer:   "Fluke",
		model:          "718",
		instrumentType: "pressure",
		rangeUnit:      "PSI",
		measurements: []certMeasRow{
			{PointLabel: "0%", StandardValue: 0, MeasuredValue: 0.01, ErrorPct: 0.01, Pass: true},
		},
	}
}

func mustParseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestBuildCertTextLines_ContainsKeyFields(t *testing.T) {
	p := minimalParams()
	lines := buildCertTextLines(p)
	joined := strings.Join(lines, "\n")

	for _, want := range []string{"TAG-001", "SN-999", "Fluke", "SO-100", "Jane Tech", "Valatix Inc"} {
		if !strings.Contains(joined, want) {
			t.Errorf("expected %q in text output", want)
		}
	}
}

func TestBuildCertTextLines_WithCustomerName(t *testing.T) {
	p := minimalParams()
	p.customerName = "Acme Lab"
	lines := buildCertTextLines(p)
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "Acme Lab") {
		t.Errorf("expected customer name in text output")
	}
}

func TestBuildCertTextLines_WithRange(t *testing.T) {
	p := minimalParams()
	lo, hi := 0.0, 100.0
	p.rangeMin = &lo
	p.rangeMax = &hi
	lines := buildCertTextLines(p)
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "100") {
		t.Errorf("expected range in text output")
	}
}

func TestBuildCertHTML_ContainsKeyFields(t *testing.T) {
	p := minimalParams()
	html := buildCertHTML(p)

	for _, want := range []string{"TAG-001", "SN-999", "Fluke", "SO-100", "Valatix Inc"} {
		if !strings.Contains(html, want) {
			t.Errorf("expected %q in HTML output", want)
		}
	}
}

func TestBuildCertHTML_WithCustomerName(t *testing.T) {
	p := minimalParams()
	p.customerName = "Acme Lab"
	html := buildCertHTML(p)
	if !strings.Contains(html, "Acme Lab") {
		t.Errorf("expected customer name in HTML output")
	}
}

func TestBuildCertHTML_WithoutCustomerName(t *testing.T) {
	p := minimalParams()
	p.customerName = ""
	html := buildCertHTML(p)
	// Should not contain "Client:" label when no customer
	if strings.Contains(html, ">Client:<") {
		t.Errorf("should not render Client field when customerName is empty")
	}
}

func TestBuildCertHTML_WithStandards(t *testing.T) {
	p := minimalParams()
	p.standards = []certStdRow{
		{Name: "Ref Gauge", SerialNumber: "STD-001", Manufacturer: "Druck"},
	}
	html := buildCertHTML(p)
	if !strings.Contains(html, "Ref Gauge") {
		t.Errorf("expected standard name in HTML output")
	}
}

func TestBuildCertHTML_WithSupervisor(t *testing.T) {
	p := minimalParams()
	p.supervisorName = "Bob Supervisor"
	html := buildCertHTML(p)
	if !strings.Contains(html, "Bob Supervisor") {
		t.Errorf("expected supervisor name in HTML output")
	}
}

func TestUpdate_BadJSON(t *testing.T) {
	h := newHandler(nil)
	req := routeWithID(
		withTenantAndUser(httptest.NewRequest(http.MethodPatch, "/calibrations/abc", strings.NewReader(`{bad}`))),
		"abc",
	)
	rec := httptest.NewRecorder()
	h.Update(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestUpdate_BeginTxError(t *testing.T) {
	h := newHandler(&mockDB{beginErr: fmt.Errorf("conn fail")})
	body := `{"status":"in_progress","standard_ids":[]}`
	req := routeWithID(
		withTenantAndUser(httptest.NewRequest(http.MethodPut, "/calibrations/abc", strings.NewReader(body))),
		"abc",
	)
	rec := httptest.NewRecorder()
	h.Update(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
}

func TestUpdate_ExecError(t *testing.T) {
	tx := &mockTx{execErr: fmt.Errorf("db error")}
	h := newHandler(&mockDB{tx: tx})
	body := `{"status":"in_progress","standard_ids":[]}`
	req := routeWithID(
		withTenantAndUser(httptest.NewRequest(http.MethodPut, "/calibrations/abc", strings.NewReader(body))),
		"abc",
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
	body := `{"status":"in_progress","standard_ids":[]}`
	req := routeWithID(
		withTenantAndUser(httptest.NewRequest(http.MethodPut, "/calibrations/abc", strings.NewReader(body))),
		"abc",
	)
	rec := httptest.NewRecorder()
	h.Update(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestUpdate_Success(t *testing.T) {
	tx := &mockTx{execTag: pgconn.NewCommandTag("UPDATE 1"), queryRowFn: countsRow(2, 0)}
	h := newHandler(&mockDB{tx: tx})
	body := `{"status":"pending_approval","standard_ids":["std-1","std-2"]}`
	req := routeWithID(
		withTenantAndUser(httptest.NewRequest(http.MethodPut, "/calibrations/abc", strings.NewReader(body))),
		"abc",
	)
	rec := httptest.NewRecorder()
	h.Update(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	// UPDATE + DELETE + 2 INSERTs = 4 exec calls
	if tx.execCalls != 4 {
		t.Errorf("expected 4 exec calls (update + delete + 2 inserts), got %d", tx.execCalls)
	}
}

func TestUpdate_CommitError(t *testing.T) {
	tx := &mockTx{execTag: pgconn.NewCommandTag("UPDATE 1"), commitErr: fmt.Errorf("commit fail")}
	h := newHandler(&mockDB{tx: tx})
	body := `{"status":"in_progress","standard_ids":[]}`
	req := routeWithID(
		withTenantAndUser(httptest.NewRequest(http.MethodPut, "/calibrations/abc", strings.NewReader(body))),
		"abc",
	)
	rec := httptest.NewRecorder()
	h.Update(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
}

func TestBuildMinimalPDF_ReturnsPDF(t *testing.T) {
	p := minimalParams()
	pdf := buildMinimalPDF(p)
	if len(pdf) == 0 {
		t.Fatal("expected non-empty PDF bytes")
	}
	if !strings.HasPrefix(string(pdf), "%PDF-") {
		t.Errorf("expected PDF magic bytes, got: %q", string(pdf[:10]))
	}
}

func TestBuildMinimalPDF_WithRange(t *testing.T) {
	p := minimalParams()
	lo, hi := 0.0, 100.0
	p.rangeMin = &lo
	p.rangeMax = &hi
	pdf := buildMinimalPDF(p)
	if !strings.Contains(string(pdf), "100") {
		t.Errorf("expected range value in PDF content")
	}
}

// ---------------------------------------------------------------------------
// Reject
// ---------------------------------------------------------------------------

func TestReject_TechnicianForbidden(t *testing.T) {
	h := newHandler(&mockDB{})
	req := routeWithID(withTenantUserAndRole(httptest.NewRequest(http.MethodPost, "/calibrations/abc/reject", strings.NewReader(`{"rejection_reason":"bad"}`)), "technician"), "abc")
	w := httptest.NewRecorder()
	h.Reject(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}
}

func TestReject_BadJSON(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("UPDATE 1")})
	req := routeWithID(withTenantUserAndRole(httptest.NewRequest(http.MethodPost, "/calibrations/abc/reject", strings.NewReader(`{bad`)), "supervisor"), "abc")
	w := httptest.NewRecorder()
	h.Reject(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestReject_NotFound(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("UPDATE 0")})
	req := routeWithID(withTenantUserAndRole(httptest.NewRequest(http.MethodPost, "/calibrations/abc/reject", strings.NewReader(`{"rejection_reason":"bad data"}`)), "supervisor"), "abc")
	w := httptest.NewRecorder()
	h.Reject(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestReject_Success(t *testing.T) {
	h := newHandler(&mockDB{queryRowFn: func() pgx.Row { return zeroRow{} }})
	body := `{"rejection_reason":"out of spec"}`
	req := routeWithID(withTenantUserAndRole(httptest.NewRequest(http.MethodPost, "/calibrations/abc/reject", strings.NewReader(body)), "supervisor"), "abc")
	w := httptest.NewRecorder()
	h.Reject(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// Reopen
// ---------------------------------------------------------------------------

func TestReopen_TechnicianAllowed(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("UPDATE 1")})
	req := routeWithID(withTenantUserAndRole(httptest.NewRequest(http.MethodPost, "/calibrations/abc/reopen", nil), "technician"), "abc")
	w := httptest.NewRecorder()
	h.Reopen(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestReopen_NotFound(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("UPDATE 0")})
	req := routeWithID(withTenantUserAndRole(httptest.NewRequest(http.MethodPost, "/calibrations/abc/reopen", nil), "supervisor"), "abc")
	w := httptest.NewRecorder()
	h.Reopen(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestReopen_Success(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("UPDATE 1")})
	req := routeWithID(withTenantUserAndRole(httptest.NewRequest(http.MethodPost, "/calibrations/abc/reopen", nil), "supervisor"), "abc")
	w := httptest.NewRecorder()
	h.Reopen(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

func TestDelete_TechnicianForbidden(t *testing.T) {
	h := newHandler(&mockDB{})
	req := routeWithID(withTenantUserAndRole(httptest.NewRequest(http.MethodDelete, "/calibrations/abc", nil), "technician"), "abc")
	w := httptest.NewRecorder()
	h.Delete(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}
}

func TestDelete_NotFound(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("DELETE 0")})
	req := routeWithID(withTenantUserAndRole(httptest.NewRequest(http.MethodDelete, "/calibrations/abc", nil), "supervisor"), "abc")
	w := httptest.NewRecorder()
	h.Delete(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestDelete_Success(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("DELETE 1")})
	req := routeWithID(withTenantUserAndRole(httptest.NewRequest(http.MethodDelete, "/calibrations/abc", nil), "supervisor"), "abc")
	w := httptest.NewRecorder()
	h.Delete(w, req)
	if w.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// BulkApprove
// ---------------------------------------------------------------------------

func TestBulkApprove_TechnicianForbidden(t *testing.T) {
	h := newHandler(&mockDB{})
	req := withTenantUserAndRole(httptest.NewRequest(http.MethodPost, "/calibrations/bulk/approve", strings.NewReader(`{"ids":["abc"]}`)), "technician")
	w := httptest.NewRecorder()
	h.BulkApprove(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}
}

func TestBulkApprove_BadJSON(t *testing.T) {
	h := newHandler(&mockDB{})
	req := withTenantUserAndRole(httptest.NewRequest(http.MethodPost, "/calibrations/bulk/approve", strings.NewReader(`{bad`)), "supervisor")
	w := httptest.NewRecorder()
	h.BulkApprove(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// BulkDelete
// ---------------------------------------------------------------------------

func TestBulkDelete_TechnicianForbidden(t *testing.T) {
	h := newHandler(&mockDB{})
	req := withTenantUserAndRole(httptest.NewRequest(http.MethodDelete, "/calibrations/bulk", strings.NewReader(`{"ids":["abc"]}`)), "technician")
	w := httptest.NewRecorder()
	h.BulkDelete(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}
}

func TestBulkDelete_BadJSON(t *testing.T) {
	h := newHandler(&mockDB{})
	req := withTenantUserAndRole(httptest.NewRequest(http.MethodDelete, "/calibrations/bulk", strings.NewReader(`{bad`)), "supervisor")
	w := httptest.NewRecorder()
	h.BulkDelete(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestBulkDelete_Success(t *testing.T) {
	h := newHandler(&mockDB{execTag: pgconn.NewCommandTag("DELETE 3")})
	req := withTenantUserAndRole(httptest.NewRequest(http.MethodDelete, "/calibrations/bulk", strings.NewReader(`{"ids":["a","b","c"]}`)), "supervisor")
	w := httptest.NewRecorder()
	h.BulkDelete(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var resp map[string]int
	json.NewDecoder(w.Body).Decode(&resp) //nolint:errcheck
	if resp["deleted"] != 3 {
		t.Errorf("expected deleted=3, got %d", resp["deleted"])
	}
}

// ---------------------------------------------------------------------------
// Offline sync guarantees (Create replay / Update locking)
// ---------------------------------------------------------------------------

// idRow scans a fixed string into the first destination.
type idRow struct{ val string }

func (r idRow) Scan(dests ...any) error {
	if p, ok := dests[0].(*string); ok {
		*p = r.val
	}
	return nil
}

// seqRows returns the given rows in order for successive QueryRow calls.
func seqRows(rows ...pgx.Row) func() pgx.Row {
	i := 0
	return func() pgx.Row {
		row := rows[i]
		if i < len(rows)-1 {
			i++
		}
		return row
	}
}

func putCalibration(h *Handler, body string) *httptest.ResponseRecorder {
	req := routeWithID(
		withTenantAndUser(httptest.NewRequest(http.MethodPut, "/calibrations/abc", strings.NewReader(body))),
		"abc",
	)
	rec := httptest.NewRecorder()
	h.Update(rec, req)
	return rec
}

func postCalibration(h *Handler, body string) *httptest.ResponseRecorder {
	req := withTenantAndUser(httptest.NewRequest(http.MethodPost, "/calibrations", strings.NewReader(body)))
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	return rec
}

func TestUpdate_RejectsApprovedStatus(t *testing.T) {
	tx := &mockTx{execTag: pgconn.NewCommandTag("UPDATE 1")}
	rec := putCalibration(newHandler(&mockDB{tx: tx}), `{"status":"approved"}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for status=approved, got %d", rec.Code)
	}
	if tx.execCalls != 0 {
		t.Errorf("expected no writes, got %d exec calls", tx.execCalls)
	}
}

func TestUpdate_LockedRecordReturns409(t *testing.T) {
	tx := &mockTx{
		execTag:    pgconn.NewCommandTag("UPDATE 0"),
		queryRowFn: func() pgx.Row { return idRow{val: "approved"} },
	}
	rec := putCalibration(newHandler(&mockDB{tx: tx}), `{"status":"in_progress","measurements":[]}`)
	if rec.Code != http.StatusConflict {
		t.Errorf("expected 409 for locked record, got %d", rec.Code)
	}
	if tx.execCalls != 1 {
		t.Errorf("expected only the guarded UPDATE, got %d exec calls", tx.execCalls)
	}
}

func TestUpdate_OmittedStandardsAreKept(t *testing.T) {
	tx := &mockTx{execTag: pgconn.NewCommandTag("UPDATE 1"), queryRowFn: countsRow(1, 0)}
	rec := putCalibration(newHandler(&mockDB{tx: tx}), `{"status":"pending_approval"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	// Only the UPDATE — no DELETE of standards or measurements.
	if tx.execCalls != 1 {
		t.Errorf("expected 1 exec call (update only), got %d", tx.execCalls)
	}
}

func TestUpdate_ReplacesMeasurementsWhenProvided(t *testing.T) {
	tx := &mockTx{execTag: pgconn.NewCommandTag("UPDATE 1")}
	body := `{"measurements":[{"point_label":"0%","standard_value":0,"as_found_value":null},{"point_label":"100%"}]}`
	rec := putCalibration(newHandler(&mockDB{tx: tx}), body)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	// UPDATE + DELETE measurements + 2 INSERTs = 4
	if tx.execCalls != 4 {
		t.Errorf("expected 4 exec calls, got %d", tx.execCalls)
	}
}

func TestCreate_ClientIDReplacesChildren(t *testing.T) {
	tx := &mockTx{
		execTag:    pgconn.NewCommandTag("INSERT 0 1"),
		queryRowFn: func() pgx.Row { return idRow{val: "11111111-1111-1111-1111-111111111111"} },
	}
	body := `{"id":"11111111-1111-1111-1111-111111111111","asset_id":"a1",
		"measurements":[{"point_label":"0%"}],"standard_ids":["s1"]}`
	rec := postCalibration(newHandler(&mockDB{tx: tx}), body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	// DELETE measurements + 1 INSERT + DELETE standards + 1 INSERT = 4, so a
	// replayed create replaces children instead of duplicating them.
	if tx.execCalls != 4 {
		t.Errorf("expected 4 exec calls, got %d", tx.execCalls)
	}
}

func TestCreate_ReplayOnLockedRecordIsNoop(t *testing.T) {
	tx := &mockTx{
		execTag:    pgconn.NewCommandTag("INSERT 0 1"),
		queryRowFn: seqRows(&errRow{err: pgx.ErrNoRows}, idRow{val: "approved"}),
	}
	body := `{"id":"11111111-1111-1111-1111-111111111111","asset_id":"a1","measurements":[{"point_label":"0%"}]}`
	rec := postCalibration(newHandler(&mockDB{tx: tx}), body)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 no-op, got %d", rec.Code)
	}
	if tx.execCalls != 0 {
		t.Errorf("locked record must not be modified, got %d exec calls", tx.execCalls)
	}
}

func TestCreate_IDOwnedByOtherTenantReturns409(t *testing.T) {
	tx := &mockTx{
		execTag:    pgconn.NewCommandTag("INSERT 0 1"),
		queryRowFn: seqRows(&errRow{err: pgx.ErrNoRows}, &errRow{err: pgx.ErrNoRows}),
	}
	body := `{"id":"11111111-1111-1111-1111-111111111111","asset_id":"a1","measurements":[{"point_label":"0%"}]}`
	rec := postCalibration(newHandler(&mockDB{tx: tx}), body)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", rec.Code)
	}
	if tx.execCalls != 0 {
		t.Errorf("other tenant's record must not be modified, got %d exec calls", tx.execCalls)
	}
}

// ---------------------------------------------------------------------------
// Row helpers for multi-column results
// ---------------------------------------------------------------------------

// valsRow scans fixed values into string, int64 (from int) and time destinations.
type valsRow []any

func (r valsRow) Scan(dests ...any) error {
	if len(dests) != len(r) {
		return fmt.Errorf("valsRow: %d dests for %d values", len(dests), len(r))
	}
	for i, d := range dests {
		switch p := d.(type) {
		case *string:
			*p = r[i].(string)
		case *int64:
			*p = int64(r[i].(int))
		case *time.Time:
			*p = r[i].(time.Time)
		default:
			return fmt.Errorf("valsRow: unsupported destination %T", d)
		}
	}
	return nil
}

// countsRow is the (total, blank) result of the measurement readiness check.
func countsRow(total, blank int) func() pgx.Row {
	return func() pgx.Row { return valsRow{total, blank} }
}

// sliceRows is a pgx.Rows over fixed rows.
type sliceRows struct {
	emptyRows
	rows []valsRow
	i    int
}

func (s *sliceRows) Next() bool { s.i++; return s.i <= len(s.rows) }
func (s *sliceRows) Scan(dests ...any) error {
	return s.rows[s.i-1].Scan(dests...)
}

// seqQueries returns the given result sets for successive Query calls.
func seqQueries(sets ...[]valsRow) func() (pgx.Rows, error) {
	i := 0
	return func() (pgx.Rows, error) {
		set := sets[i]
		i++
		return &sliceRows{rows: set}, nil
	}
}

// recordEmails replaces the certificate emailer for one test. Each call
// reports the record id and whether the transaction had committed by then.
type sentEmail struct {
	recordID  string
	committed bool
}

func recordEmails(t *testing.T, tx *mockTx) chan sentEmail {
	t.Helper()
	ch := make(chan sentEmail, 10)
	prev := certificateEmailer
	certificateEmailer = func(_ querier, _ context.Context, recordID, _ string) {
		ch <- sentEmail{recordID: recordID, committed: tx.committed}
	}
	t.Cleanup(func() { certificateEmailer = prev })
	return ch
}

// collectEmails waits briefly for n background emails, then checks no more arrive.
func collectEmails(t *testing.T, ch chan sentEmail, n int) []sentEmail {
	t.Helper()
	var got []sentEmail
	timeout := time.After(time.Second)
	for len(got) < n {
		select {
		case e := <-ch:
			got = append(got, e)
		case <-timeout:
			t.Fatalf("expected %d certificate emails, got %d", n, len(got))
		}
	}
	select {
	case e := <-ch:
		t.Fatalf("unexpected extra certificate email for %s", e.recordID)
	case <-time.After(50 * time.Millisecond):
	}
	return got
}

func errorMessage(rec *httptest.ResponseRecorder) string {
	var resp map[string]any
	json.NewDecoder(rec.Body).Decode(&resp) //nolint:errcheck
	msg, _ := resp["error"].(string)
	return msg
}

func approveAs(h *Handler, role, userID string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/calibrations/rec-1/approve", strings.NewReader(`{"supervisor_signature":"sig"}`))
	ctx := middleware.WithTenantID(r.Context(), "tenant-1")
	ctx = middleware.WithUserID(ctx, userID)
	ctx = middleware.WithRole(ctx, role)
	req := routeWithID(r.WithContext(ctx), "rec-1")
	rec := httptest.NewRecorder()
	h.Approve(rec, req)
	return rec
}

func bulkApproveAs(h *Handler, role, userID, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/calibrations/bulk/approve", strings.NewReader(body))
	ctx := middleware.WithTenantID(r.Context(), "tenant-1")
	ctx = middleware.WithUserID(ctx, userID)
	ctx = middleware.WithRole(ctx, role)
	rec := httptest.NewRecorder()
	h.BulkApprove(rec, r.WithContext(ctx))
	return rec
}

var performed = time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)

// ---------------------------------------------------------------------------
// 1. Reject only touches pending records
// ---------------------------------------------------------------------------

func TestReject_ApprovedRecordReturns409(t *testing.T) {
	db := &mockDB{queryRowFn: seqRows(&errRow{err: pgx.ErrNoRows}, idRow{val: "approved"})}
	h := newHandler(db)
	req := routeWithID(withTenantUserAndRole(httptest.NewRequest(http.MethodPost, "/calibrations/abc/reject", strings.NewReader(`{"rejection_reason":"late"}`)), "supervisor"), "abc")
	w := httptest.NewRecorder()
	h.Reject(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", w.Code)
	}
	if msg := errorMessage(w); msg != "calibration is approved and cannot be rejected" {
		t.Errorf("unexpected message %q", msg)
	}
	if !strings.Contains(db.queryRowSQL[0], "status = 'pending_approval'") {
		t.Errorf("reject UPDATE must be guarded by status = 'pending_approval':\n%s", db.queryRowSQL[0])
	}
}

// ---------------------------------------------------------------------------
// 2. No submitting or approving without readings
// ---------------------------------------------------------------------------

func TestUpdate_SubmitWithoutReadingsRejected(t *testing.T) {
	cases := []struct {
		name         string
		total, blank int
		want         string
	}{
		{"no measurements", 0, 0, "cannot submit for approval: no measurements recorded"},
		{"one blank", 3, 1, "cannot submit for approval: 1 reading is blank"},
		{"several blank", 3, 2, "cannot submit for approval: 2 readings are blank"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tx := &mockTx{execTag: pgconn.NewCommandTag("UPDATE 1"), queryRowFn: countsRow(tc.total, tc.blank)}
			rec := putCalibration(newHandler(&mockDB{tx: tx}), `{"status":"pending_approval","measurements":[]}`)
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("expected 422, got %d", rec.Code)
			}
			if msg := errorMessage(rec); msg != tc.want {
				t.Errorf("expected %q, got %q", tc.want, msg)
			}
			if tx.committed || !tx.rolledBack {
				t.Errorf("expected rollback (committed=%v rolledBack=%v)", tx.committed, tx.rolledBack)
			}
		})
	}
}

func TestUpdate_InProgressSaveSkipsReadingCheck(t *testing.T) {
	// A draft save may have no readings yet; only submission is gated.
	tx := &mockTx{execTag: pgconn.NewCommandTag("UPDATE 1"), queryRowFn: countsRow(0, 0)}
	rec := putCalibration(newHandler(&mockDB{tx: tx}), `{"status":"in_progress","measurements":[]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !tx.committed {
		t.Error("expected commit")
	}
}

func TestApprove_WithoutReadingsRejected(t *testing.T) {
	tx := &mockTx{queryRowFn: seqRows(valsRow{"pending_approval", "tech-1"}, valsRow{0, 0})}
	emails := recordEmails(t, tx)
	rec := approveAs(newHandler(&mockDB{tx: tx}), "supervisor", "sup-1")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", rec.Code)
	}
	if msg := errorMessage(rec); msg != "cannot approve: no measurements recorded" {
		t.Errorf("unexpected message %q", msg)
	}
	if tx.committed || tx.execCalls != 0 {
		t.Errorf("nothing may be written (committed=%v execs=%d)", tx.committed, tx.execCalls)
	}
	collectEmails(t, emails, 0)
}

// ---------------------------------------------------------------------------
// 5. Approve is atomic; the email goes out after commit
// ---------------------------------------------------------------------------

func approvableTx() *mockTx {
	return &mockTx{
		execTag: pgconn.NewCommandTag("UPDATE 1"),
		queryRowFn: seqRows(
			valsRow{"pending_approval", "tech-1"},  // lock + lookup
			valsRow{4, 0},                          // readings
			valsRow{"rec-1", "asset-1", performed}, // UPDATE ... RETURNING
		),
	}
}

func TestApprove_UpdatesAssetInSameTransactionThenEmails(t *testing.T) {
	tx := approvableTx()
	emails := recordEmails(t, tx)
	rec := approveAs(newHandler(&mockDB{tx: tx}), "supervisor", "sup-1")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if tx.execCalls != 1 || !strings.Contains(tx.execSQL[0], "UPDATE assets") {
		t.Fatalf("expected the asset dates update inside the transaction, got %v", tx.execSQL)
	}
	if !reflect.DeepEqual(tx.execArgs[0], []any{"asset-1", performed}) {
		t.Errorf("unexpected asset update args %v", tx.execArgs[0])
	}
	if !tx.committed {
		t.Error("expected commit")
	}
	got := collectEmails(t, emails, 1)
	if got[0].recordID != "rec-1" || !got[0].committed {
		t.Errorf("email must be sent for rec-1 after commit, got %+v", got[0])
	}
}

func TestApprove_AssetUpdateFailureRollsBack(t *testing.T) {
	tx := approvableTx()
	tx.execFn = func(string) (pgconn.CommandTag, error) { return pgconn.CommandTag{}, fmt.Errorf("asset locked") }
	emails := recordEmails(t, tx)
	rec := approveAs(newHandler(&mockDB{tx: tx}), "supervisor", "sup-1")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}
	if tx.committed || !tx.rolledBack {
		t.Errorf("expected rollback so the record stays pending (committed=%v rolledBack=%v)", tx.committed, tx.rolledBack)
	}
	collectEmails(t, emails, 0)
}

// ---------------------------------------------------------------------------
// 7. No self-approval for supervisors
// ---------------------------------------------------------------------------

func TestApprove_SupervisorCannotSelfApprove(t *testing.T) {
	tx := approvableTx()
	emails := recordEmails(t, tx)
	rec := approveAs(newHandler(&mockDB{tx: tx}), "supervisor", "tech-1")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
	if msg := errorMessage(rec); msg != "you cannot approve your own calibration" {
		t.Errorf("unexpected message %q", msg)
	}
	if tx.committed {
		t.Error("nothing may be committed")
	}
	collectEmails(t, emails, 0)
}

func TestApprove_AdminCanSelfApprove(t *testing.T) {
	tx := approvableTx()
	emails := recordEmails(t, tx)
	rec := approveAs(newHandler(&mockDB{tx: tx}), "admin", "tech-1")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	collectEmails(t, emails, 1)
}

// ---------------------------------------------------------------------------
// 2, 3, 7. BulkApprove: readiness, asset dates, emails, self-approval
// ---------------------------------------------------------------------------

type bulkResp struct {
	Approved int      `json:"approved"`
	Skipped  []string `json:"skipped"`
}

func TestBulkApprove_ApprovesOnlyReadyRecords(t *testing.T) {
	tx := &mockTx{
		execTag: pgconn.NewCommandTag("UPDATE 1"),
		queryFn: seqQueries(
			[]valsRow{ // pending candidates: id, technician, total, blank
				{"a", "tech-1", 2, 0}, // ready
				{"b", "tech-1", 0, 0}, // no measurements
				{"c", "sup-1", 3, 0},  // supervisor's own record
				{"e", "tech-2", 3, 1}, // a blank reading
			},
			[]valsRow{{"a", "asset-a", performed}}, // UPDATE ... RETURNING
		),
	}
	emails := recordEmails(t, tx)
	rec := bulkApproveAs(newHandler(&mockDB{tx: tx}), "supervisor", "sup-1", `{"ids":["a","b","c","d","e"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp bulkResp
	json.NewDecoder(rec.Body).Decode(&resp) //nolint:errcheck
	if resp.Approved != 1 || !reflect.DeepEqual(resp.Skipped, []string{"b", "c", "d", "e"}) {
		t.Errorf("unexpected response %+v", resp)
	}
	if got := tx.queryArgs[1][0]; !reflect.DeepEqual(got, []string{"a"}) {
		t.Errorf("only ready records may be approved, UPDATE got ids %v", got)
	}
	if tx.execCalls != 1 || !reflect.DeepEqual(tx.execArgs[0], []any{"asset-a", performed}) {
		t.Errorf("expected one asset dates update for asset-a, got %v", tx.execArgs)
	}
	if !tx.committed {
		t.Error("expected commit")
	}
	got := collectEmails(t, emails, 1)
	if got[0].recordID != "a" || !got[0].committed {
		t.Errorf("expected email for a after commit, got %+v", got[0])
	}
}

func TestBulkApprove_AdminMaySelfApprove(t *testing.T) {
	tx := &mockTx{
		execTag: pgconn.NewCommandTag("UPDATE 1"),
		queryFn: seqQueries(
			[]valsRow{{"a", "admin-1", 1, 0}, {"b", "tech-1", 1, 0}},
			[]valsRow{{"a", "asset-a", performed}, {"b", "asset-b", performed}},
		),
	}
	emails := recordEmails(t, tx)
	rec := bulkApproveAs(newHandler(&mockDB{tx: tx}), "admin", "admin-1", `{"ids":["a","b"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var resp bulkResp
	json.NewDecoder(rec.Body).Decode(&resp) //nolint:errcheck
	if resp.Approved != 2 || len(resp.Skipped) != 0 {
		t.Errorf("unexpected response %+v", resp)
	}
	if tx.execCalls != 2 {
		t.Errorf("expected 2 asset updates, got %d", tx.execCalls)
	}
	collectEmails(t, emails, 2)
}

func TestBulkApprove_AssetUpdateFailureRollsBack(t *testing.T) {
	tx := &mockTx{
		execFn: func(string) (pgconn.CommandTag, error) { return pgconn.CommandTag{}, fmt.Errorf("boom") },
		queryFn: seqQueries(
			[]valsRow{{"a", "tech-1", 1, 0}},
			[]valsRow{{"a", "asset-a", performed}},
		),
	}
	emails := recordEmails(t, tx)
	rec := bulkApproveAs(newHandler(&mockDB{tx: tx}), "supervisor", "sup-1", `{"ids":["a"]}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}
	if tx.committed || !tx.rolledBack {
		t.Error("expected rollback")
	}
	collectEmails(t, emails, 0)
}

func TestBulkApprove_NothingReady(t *testing.T) {
	tx := &mockTx{queryFn: seqQueries([]valsRow{{"a", "tech-1", 0, 0}})}
	rec := bulkApproveAs(newHandler(&mockDB{tx: tx}), "supervisor", "sup-1", `{"ids":["a"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var resp bulkResp
	json.NewDecoder(rec.Body).Decode(&resp) //nolint:errcheck
	if resp.Approved != 0 || !reflect.DeepEqual(resp.Skipped, []string{"a"}) {
		t.Errorf("unexpected response %+v", resp)
	}
	if len(tx.querySQL) != 1 || tx.execCalls != 0 {
		t.Errorf("no approval UPDATE expected, got %d queries and %d execs", len(tx.querySQL), tx.execCalls)
	}
}

// ---------------------------------------------------------------------------
// 6. Optional text fields: omitted keeps, "" clears
// ---------------------------------------------------------------------------

func TestUpdate_TextFieldsOmittedKeepEmptyClears(t *testing.T) {
	tx := &mockTx{execTag: pgconn.NewCommandTag("UPDATE 1")}
	rec := putCalibration(newHandler(&mockDB{tx: tx}), `{"notes":"","flag_number":"F-9","tech_signature":null}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if !strings.Contains(tx.execSQL[0], "notes = COALESCE($7::text, notes)") {
		t.Errorf("notes must be set from a nullable parameter:\n%s", tx.execSQL[0])
	}
	// args: id, tenant, status, tech_signature, sales_number, flag_number, notes, local_id
	args := tx.execArgs[0]
	str := func(i int) *string { return args[i].(*string) }
	if str(3) != nil {
		t.Errorf("null tech_signature must keep the column (nil arg), got %q", *str(3))
	}
	if str(4) != nil {
		t.Errorf("omitted sales_number must keep the column (nil arg), got %q", *str(4))
	}
	if str(5) == nil || *str(5) != "F-9" {
		t.Errorf("flag_number must be set to F-9, got %v", str(5))
	}
	if str(6) == nil || *str(6) != "" {
		t.Errorf(`notes "" must clear the column, got %v`, str(6))
	}
}
