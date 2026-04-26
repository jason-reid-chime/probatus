package certificates

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// writeError
// ---------------------------------------------------------------------------

func TestWriteError(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusBadRequest, "something went wrong")

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("expected application/json, got %q", ct)
	}
	var body map[string]string
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["error"] != "something went wrong" {
		t.Fatalf("unexpected error message: %q", body["error"])
	}
}

func TestWriteError_NotFound(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusNotFound, "not found")
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// buildMinimalCertPDF
// ---------------------------------------------------------------------------

func makeCertData() certData {
	now := time.Date(2026, 1, 15, 10, 0, 0, 0, time.UTC)
	rangeMin := 0.0
	rangeMax := 100.0
	return certData{
		RecordID:       "rec-abc",
		LocalID:        "SA-2026-001",
		SalesNumber:    "SO-1234",
		FlagNumber:     "F-99",
		PerformedAt:    now,
		Status:         "approved",
		TechName:       "Jason Reid",
		AssetTag:       "SHD-PRES-001",
		SerialNumber:   "P-1042",
		Manufacturer:   "Ashcroft",
		Model:          "Type 1009",
		InstrumentType: "pressure",
		Location:       "Pump Room A",
		RangeMin:       &rangeMin,
		RangeMax:       &rangeMax,
		RangeUnit:      "psi",
		TenantName:     "Probatus Inc",
		GeneratedAt:    now,
		Measurements: []measurementRow{
			{PointLabel: "0%", StandardValue: 0, MeasuredValue: 0.1, Unit: "psi", ErrorPct: 0.0, Pass: true},
			{PointLabel: "50%", StandardValue: 50, MeasuredValue: 50.4, Unit: "psi", ErrorPct: 0.8, Pass: true},
			{PointLabel: "100%", StandardValue: 100, MeasuredValue: 100.3, Unit: "psi", ErrorPct: 0.3, Pass: true},
		},
	}
}

func TestBuildMinimalCertPDF_ReturnsPDF(t *testing.T) {
	d := makeCertData()
	pdf := buildMinimalCertPDF(d)

	if len(pdf) == 0 {
		t.Fatal("expected non-empty PDF bytes")
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF-1.4")) {
		t.Fatalf("expected PDF to start with %%PDF-1.4, got: %q", pdf[:min(20, len(pdf))])
	}
}

func TestBuildMinimalCertPDF_ContainsTenantName(t *testing.T) {
	d := makeCertData()
	pdf := buildMinimalCertPDF(d)
	text := string(pdf)
	if !strings.Contains(text, "Probatus Inc") {
		t.Error("expected tenant name in PDF content")
	}
}

func TestBuildMinimalCertPDF_ContainsAssetTag(t *testing.T) {
	d := makeCertData()
	pdf := buildMinimalCertPDF(d)
	text := string(pdf)
	if !strings.Contains(text, "SHD-PRES-001") {
		t.Error("expected asset tag in PDF content")
	}
}

func TestBuildMinimalCertPDF_ContainsMeasurements(t *testing.T) {
	d := makeCertData()
	pdf := buildMinimalCertPDF(d)
	text := string(pdf)
	if !strings.Contains(text, "PASS") {
		t.Error("expected PASS in measurements section")
	}
	if !strings.Contains(text, "50%") {
		t.Error("expected 50% point label in PDF")
	}
}

func TestBuildMinimalCertPDF_ContainsStandards(t *testing.T) {
	due := time.Date(2026, 9, 15, 0, 0, 0, 0, time.UTC)
	d := makeCertData()
	d.Standards = []standardRow{
		{Name: "Fluke 743B", SerialNumber: "SA-F743-001", CertificateRef: "NRC-2025-48271", DueAt: &due},
	}
	pdf := buildMinimalCertPDF(d)
	text := string(pdf)
	if !strings.Contains(text, "Fluke 743B") {
		t.Error("expected standard name in PDF")
	}
	if !strings.Contains(text, "NRC-2025-48271") {
		t.Error("expected certificate ref in PDF")
	}
}

func TestBuildMinimalCertPDF_NilStandardDueDate(t *testing.T) {
	d := makeCertData()
	d.Standards = []standardRow{
		{Name: "Fluke 87V", SerialNumber: "SA-87V-001", DueAt: nil},
	}
	// Should not panic
	pdf := buildMinimalCertPDF(d)
	if len(pdf) == 0 {
		t.Fatal("expected non-empty PDF even with nil DueAt")
	}
}

func TestBuildMinimalCertPDF_NilRange(t *testing.T) {
	d := makeCertData()
	d.RangeMin = nil
	d.RangeMax = nil
	// Should not panic when range pointers are nil
	pdf := buildMinimalCertPDF(d)
	if !bytes.HasPrefix(pdf, []byte("%PDF-1.4")) {
		t.Fatal("expected valid PDF with nil range")
	}
}

func TestBuildMinimalCertPDF_SpecialCharacters(t *testing.T) {
	d := makeCertData()
	d.TechName = "O'Brien (Technician)"
	d.Notes = "Check valve at 50% point"
	// Should not panic — parentheses and backslashes must be escaped
	pdf := buildMinimalCertPDF(d)
	if !bytes.HasPrefix(pdf, []byte("%PDF-1.4")) {
		t.Fatalf("expected valid PDF with special chars, got: %q", pdf[:min(20, len(pdf))])
	}
}

func TestBuildMinimalCertPDF_ApprovedAt(t *testing.T) {
	d := makeCertData()
	approved := time.Date(2026, 1, 16, 9, 0, 0, 0, time.UTC)
	d.ApprovedAt = &approved
	pdf := buildMinimalCertPDF(d)
	text := string(pdf)
	if !strings.Contains(text, "2026-01-16") {
		t.Error("expected approval date in PDF")
	}
}

func TestBuildMinimalCertPDF_EndsWithEOF(t *testing.T) {
	d := makeCertData()
	pdf := buildMinimalCertPDF(d)
	text := string(pdf)
	if !strings.Contains(text, "%%EOF") {
		t.Errorf("expected %%%%EOF at end of PDF, got last 50 chars: %q", text[max(0, len(text)-50):])
	}
}

// ---------------------------------------------------------------------------
// callGotenberg
// ---------------------------------------------------------------------------

func TestCallGotenberg_NonOKStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	var buf bytes.Buffer
	buf.WriteString("<html>test</html>")

	_, err := callGotenberg(t.Context(), srv.URL, buf)
	if err == nil {
		t.Fatal("expected error when Gotenberg returns non-200")
	}
	if !strings.Contains(err.Error(), "503") && !strings.Contains(err.Error(), "500") {
		t.Fatalf("expected gotenberg status error, got: %v", err)
	}
}

func TestCallGotenberg_ReturnsBody(t *testing.T) {
	pdfContent := []byte("%PDF-1.4 fake")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if !strings.HasSuffix(r.URL.Path, "/convert/html") {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.Write(pdfContent)
	}))
	defer srv.Close()

	var buf bytes.Buffer
	buf.WriteString("<html>test</html>")

	got, err := callGotenberg(t.Context(), srv.URL, buf)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !bytes.Equal(got, pdfContent) {
		t.Fatalf("expected %q, got %q", pdfContent, got)
	}
}

func TestCallGotenberg_Unreachable(t *testing.T) {
	var buf bytes.Buffer
	buf.WriteString("<html>test</html>")

	_, err := callGotenberg(t.Context(), "http://127.0.0.1:19999", buf)
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
}

// ---------------------------------------------------------------------------
// generateCertPDF
// ---------------------------------------------------------------------------

func TestGenerateCertPDF_FallsBackToBuiltIn(t *testing.T) {
	t.Setenv("GOTENBERG_URL", "")

	d := makeCertData()
	var buf bytes.Buffer
	buf.WriteString("<html>test</html>")

	pdf, err := generateCertPDF(t.Context(), buf, d)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF-1.4")) {
		t.Fatalf("expected built-in PDF, got: %q", pdf[:min(20, len(pdf))])
	}
}

func TestGenerateCertPDF_UsesGotenbergWhenSet(t *testing.T) {
	fakePDF := []byte("%PDF-1.4 gotenberg")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(fakePDF)
	}))
	defer srv.Close()

	t.Setenv("GOTENBERG_URL", srv.URL)

	d := makeCertData()
	var buf bytes.Buffer
	buf.WriteString("<html>test</html>")

	pdf, err := generateCertPDF(t.Context(), buf, d)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !bytes.Equal(pdf, fakePDF) {
		t.Fatalf("expected Gotenberg PDF, got: %q", pdf)
	}
}

func TestGenerateCertPDF_GotenbergFailFallsBack(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	t.Setenv("GOTENBERG_URL", srv.URL)

	d := makeCertData()
	var buf bytes.Buffer
	buf.WriteString("<html>test</html>")

	pdf, err := generateCertPDF(t.Context(), buf, d)
	if err != nil {
		t.Fatalf("expected fallback to succeed, got error: %v", err)
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF-1.4")) {
		t.Fatalf("expected built-in fallback PDF, got: %q", pdf[:min(20, len(pdf))])
	}
}

// ---------------------------------------------------------------------------
// SendEmail — request parsing
// ---------------------------------------------------------------------------

func TestSendEmail_MissingBody(t *testing.T) {
	h := &Handler{pool: nil}
	r := httptest.NewRequest(http.MethodPost, "/calibrations/abc/send-email", strings.NewReader("not json"))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SendEmail(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestSendEmail_EmptyEmail(t *testing.T) {
	h := &Handler{pool: nil}
	body := `{"email":""}`
	r := httptest.NewRequest(http.MethodPost, "/calibrations/abc/send-email", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.SendEmail(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty email, got %d", w.Code)
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["error"] != "email is required" {
		t.Fatalf("unexpected error message: %q", resp["error"])
	}
}

// min is available in Go 1.21+ but define locally for safety.
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
