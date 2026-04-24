package calibrations

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
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
// Mock querier
// ---------------------------------------------------------------------------

type mockDB struct {
	queryErr   error
	queryRowFn func() pgx.Row
	execTag    pgconn.CommandTag
	execErr    error
	beginErr   error
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
	return nil, m.beginErr
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
