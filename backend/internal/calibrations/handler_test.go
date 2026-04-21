package calibrations

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// writeJSON
// ---------------------------------------------------------------------------

func TestWriteJSON_ContentTypeAndStatus(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusOK, map[string]string{"hello": "world"})

	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}
	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestWriteJSON_Body(t *testing.T) {
	type payload struct {
		Foo string `json:"foo"`
	}
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusCreated, payload{Foo: "bar"})

	var got payload
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	if got.Foo != "bar" {
		t.Errorf("expected foo=bar, got %q", got.Foo)
	}
	if w.Code != http.StatusCreated {
		t.Errorf("expected status 201, got %d", w.Code)
	}
}

func TestWriteJSON_SliceRoundtrip(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusOK, []int{1, 2, 3})

	var got []int
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	if len(got) != 3 || got[0] != 1 || got[1] != 2 || got[2] != 3 {
		t.Errorf("unexpected slice: %v", got)
	}
}

// ---------------------------------------------------------------------------
// writeError
// ---------------------------------------------------------------------------

func TestWriteError_StatusCode(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusBadRequest, "something went wrong")

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestWriteError_ErrorKey(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusUnprocessableEntity, "validation failed")

	var body map[string]string
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	if body["error"] != "validation failed" {
		t.Errorf("expected error key 'validation failed', got %q", body["error"])
	}
}

func TestWriteError_ContentType(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusInternalServerError, "oops")

	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}
}

func TestWriteError_NotFoundStatus(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusNotFound, "not found")

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
	var body map[string]string
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	if body["error"] != "not found" {
		t.Errorf("expected error 'not found', got %q", body["error"])
	}
}

// ---------------------------------------------------------------------------
// checkStandardsDueDate — empty-slice fast path (no DB required)
// ---------------------------------------------------------------------------

func TestCheckStandardsDueDate_EmptySlice(t *testing.T) {
	h := &Handler{pool: nil} // pool will never be reached
	r := httptest.NewRequest(http.MethodGet, "/", nil)

	result := h.checkStandardsDueDate(r, "tenant-abc", []string{})
	if result != "" {
		t.Errorf("expected empty string for empty standardIDs, got %q", result)
	}
}

func TestCheckStandardsDueDate_NilSlice(t *testing.T) {
	h := &Handler{pool: nil}
	r := httptest.NewRequest(http.MethodGet, "/", nil)

	result := h.checkStandardsDueDate(r, "tenant-abc", nil)
	if result != "" {
		t.Errorf("expected empty string for nil standardIDs, got %q", result)
	}
}

// ---------------------------------------------------------------------------
// Create handler — malformed JSON body returns 400 (no DB required because
// decoding fails before any pool call)
// ---------------------------------------------------------------------------

func TestCreate_MalformedJSON_Returns400(t *testing.T) {
	h := &Handler{pool: nil}

	body := strings.NewReader(`{not valid json}`)
	r := httptest.NewRequest(http.MethodPost, "/calibrations", body)
	r.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	h.Create(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}

	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	if resp["error"] != "invalid request body" {
		t.Errorf("unexpected error message: %q", resp["error"])
	}
}

func TestCreate_EmptyBody_Returns400(t *testing.T) {
	h := &Handler{pool: nil}

	// An entirely empty body causes json.Decoder to return io.EOF, which is
	// also treated as an error by the handler.
	r := httptest.NewRequest(http.MethodPost, "/calibrations", strings.NewReader(""))
	r.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	h.Create(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestCreate_InvalidPerformedAt_Returns400(t *testing.T) {
	// Provide valid JSON but an invalid performed_at format.
	// Because standard_ids is empty the checkStandardsDueDate fast-path runs
	// without touching the DB, then the date parse error is hit before any pool
	// calls.
	h := &Handler{pool: nil}

	body := `{"asset_id":"some-id","performed_at":"not-a-date","standard_ids":[]}`
	r := httptest.NewRequest(http.MethodPost, "/calibrations", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	h.Create(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}

	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	if resp["error"] != "invalid performed_at format, use RFC3339" {
		t.Errorf("unexpected error message: %q", resp["error"])
	}
}

// ---------------------------------------------------------------------------
// buildCertTextLines — pure function; no DB or HTTP required
// ---------------------------------------------------------------------------

func TestBuildCertTextLines_ContainsTenantName(t *testing.T) {
	p := buildCertHTMLParams{
		tenantName:  "Acme Calibration Lab",
		localID:     "CERT-001",
		salesNumber: "SO-1234",
		flagNumber:  "F-001",
		performedAt: time.Date(2024, 3, 15, 0, 0, 0, 0, time.UTC),
		status:      "approved",
		techName:    "Jane Smith",
	}

	lines := buildCertTextLines(p)
	if len(lines) == 0 {
		t.Fatal("expected at least one line")
	}
	if lines[0] != "Acme Calibration Lab" {
		t.Errorf("expected first line to be tenant name, got %q", lines[0])
	}
}

func TestBuildCertTextLines_ContainsCertificateHeader(t *testing.T) {
	p := buildCertHTMLParams{
		tenantName:  "Test Lab",
		performedAt: time.Now(),
		status:      "approved",
	}

	lines := buildCertTextLines(p)

	found := false
	for _, l := range lines {
		if l == "CALIBRATION CERTIFICATE" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected 'CALIBRATION CERTIFICATE' header in text lines")
	}
}

func TestBuildCertTextLines_ContainsLocalID(t *testing.T) {
	p := buildCertHTMLParams{
		tenantName:  "Test Lab",
		localID:     "CERT-XYZ",
		performedAt: time.Now(),
		status:      "approved",
	}

	lines := buildCertTextLines(p)

	found := false
	for _, l := range lines {
		if strings.Contains(l, "CERT-XYZ") {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected localID 'CERT-XYZ' to appear in text lines")
	}
}

func TestBuildCertTextLines_MeasurementPassFail(t *testing.T) {
	p := buildCertHTMLParams{
		tenantName:  "Test Lab",
		performedAt: time.Now(),
		status:      "approved",
		measurements: []certMeasRow{
			{PointLabel: "Zero", Pass: true, Unit: "psi"},
			{PointLabel: "FullScale", Pass: false, Unit: "psi"},
		},
	}

	lines := buildCertTextLines(p)

	passFound, failFound := false, false
	for _, l := range lines {
		if strings.Contains(l, "PASS") {
			passFound = true
		}
		if strings.Contains(l, "FAIL") {
			failFound = true
		}
	}
	if !passFound {
		t.Error("expected PASS in measurement lines")
	}
	if !failFound {
		t.Error("expected FAIL in measurement lines")
	}
}

func TestBuildCertTextLines_WithRange(t *testing.T) {
	min, max := 0.0, 100.0
	p := buildCertHTMLParams{
		tenantName:  "Test Lab",
		performedAt: time.Now(),
		status:      "approved",
		rangeMin:    &min,
		rangeMax:    &max,
		rangeUnit:   "psi",
	}

	lines := buildCertTextLines(p)

	found := false
	for _, l := range lines {
		if strings.Contains(l, "Range") && strings.Contains(l, "psi") {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected Range line with unit 'psi' in text output")
	}
}

func TestBuildCertTextLines_NotesIncluded(t *testing.T) {
	p := buildCertHTMLParams{
		tenantName:  "Test Lab",
		performedAt: time.Now(),
		status:      "approved",
		notes:       "Handled with care",
	}

	lines := buildCertTextLines(p)

	found := false
	for _, l := range lines {
		if strings.Contains(l, "Handled with care") {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected notes text in output lines")
	}
}

// ---------------------------------------------------------------------------
// buildCertHTML — pure function
// ---------------------------------------------------------------------------

func TestBuildCertHTML_ContainsTenantName(t *testing.T) {
	p := buildCertHTMLParams{
		tenantName:  "My Calibration Co",
		performedAt: time.Now(),
		status:      "approved",
	}

	html := buildCertHTML(p)
	if !strings.Contains(html, "My Calibration Co") {
		t.Error("expected tenant name in HTML output")
	}
}

func TestBuildCertHTML_IsHTMLDocument(t *testing.T) {
	p := buildCertHTMLParams{
		tenantName:  "Test Lab",
		performedAt: time.Now(),
		status:      "approved",
	}

	html := buildCertHTML(p)
	if !strings.HasPrefix(html, "<!DOCTYPE html>") {
		t.Error("expected HTML output to start with <!DOCTYPE html>")
	}
	if !strings.Contains(html, "</html>") {
		t.Error("expected HTML output to contain closing </html> tag")
	}
}

func TestBuildCertHTML_PassResultColor(t *testing.T) {
	p := buildCertHTMLParams{
		tenantName:  "Test Lab",
		performedAt: time.Now(),
		status:      "approved",
		measurements: []certMeasRow{
			{PointLabel: "P1", Pass: true},
		},
	}

	html := buildCertHTML(p)
	if !strings.Contains(html, `class="pass"`) {
		t.Error("expected pass CSS class for passing measurement")
	}
}

func TestBuildCertHTML_FailResultColor(t *testing.T) {
	p := buildCertHTMLParams{
		tenantName:  "Test Lab",
		performedAt: time.Now(),
		status:      "approved",
		measurements: []certMeasRow{
			{PointLabel: "P1", Pass: false},
		},
	}

	html := buildCertHTML(p)
	if !strings.Contains(html, `class="fail"`) {
		t.Error("expected fail CSS class for failing measurement")
	}
}

func TestBuildCertHTML_StandardsSection(t *testing.T) {
	due := time.Date(2025, 12, 31, 0, 0, 0, 0, time.UTC)
	p := buildCertHTMLParams{
		tenantName:  "Test Lab",
		performedAt: time.Now(),
		status:      "approved",
		standards: []certStdRow{
			{Name: "DeadweightTester", SerialNumber: "DW-001", DueAt: &due},
		},
	}

	html := buildCertHTML(p)
	if !strings.Contains(html, "DeadweightTester") {
		t.Error("expected standard name in HTML output")
	}
	if !strings.Contains(html, "2025-12-31") {
		t.Error("expected standard due date in HTML output")
	}
}
