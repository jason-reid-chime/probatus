package email

import (
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// CertificateEmailHTML — pure rendering function, no network or DB calls
// ---------------------------------------------------------------------------

func TestCertificateEmailHTML_IsHTMLDocument(t *testing.T) {
	p := CertificateEmailParams{
		CustomerName:     "Acme Corp",
		AssetTagID:       "SHD-PRES-001",
		AssetDescription: "Ashcroft Pressure Gauge",
		PerformedAt:      "2024-03-15",
		TechnicianName:   "Jane Smith",
		OverallResult:    "PASS",
		CertificateID:    "abc12345",
		TenantName:       "Probatus Inc",
	}

	html := CertificateEmailHTML(p)

	if !strings.HasPrefix(html, "<!DOCTYPE html>") {
		t.Error("expected output to begin with <!DOCTYPE html>")
	}
	if !strings.Contains(html, "</html>") {
		t.Error("expected output to contain closing </html> tag")
	}
}

func TestCertificateEmailHTML_ContainsCustomerName(t *testing.T) {
	p := CertificateEmailParams{
		CustomerName:  "City of London",
		OverallResult: "PASS",
		CertificateID: "certxyz",
		TenantName:    "Lab Co",
	}

	html := CertificateEmailHTML(p)
	if !strings.Contains(html, "City of London") {
		t.Error("expected customer name in email HTML")
	}
}

func TestCertificateEmailHTML_ContainsAssetTagID(t *testing.T) {
	p := CertificateEmailParams{
		AssetTagID:    "ASSET-999",
		OverallResult: "PASS",
		CertificateID: "cert001",
		TenantName:    "Lab",
	}

	html := CertificateEmailHTML(p)
	if !strings.Contains(html, "ASSET-999") {
		t.Error("expected asset tag ID in email HTML")
	}
}

func TestCertificateEmailHTML_ContainsCertificateID(t *testing.T) {
	p := CertificateEmailParams{
		CertificateID: "deadbeef",
		OverallResult: "PASS",
		TenantName:    "Lab",
	}

	html := CertificateEmailHTML(p)
	if !strings.Contains(html, "deadbeef") {
		t.Error("expected certificate ID in email HTML")
	}
}

func TestCertificateEmailHTML_ContainsTenantName(t *testing.T) {
	p := CertificateEmailParams{
		TenantName:    "Probatus Inc",
		OverallResult: "PASS",
		CertificateID: "cert001",
	}

	html := CertificateEmailHTML(p)
	if !strings.Contains(html, "Probatus Inc") {
		t.Error("expected tenant name in email HTML")
	}
}

func TestCertificateEmailHTML_PassResultGreenColor(t *testing.T) {
	p := CertificateEmailParams{
		OverallResult: "PASS",
		CertificateID: "cert001",
		TenantName:    "Lab",
	}

	html := CertificateEmailHTML(p)
	// The green colour for PASS is #27ae60.
	if !strings.Contains(html, "#27ae60") {
		t.Error("expected green colour (#27ae60) for PASS result")
	}
}

func TestCertificateEmailHTML_FailResultRedColor(t *testing.T) {
	p := CertificateEmailParams{
		OverallResult: "FAIL",
		CertificateID: "cert001",
		TenantName:    "Lab",
	}

	html := CertificateEmailHTML(p)
	// The red colour for non-PASS is #c0392b.
	if !strings.Contains(html, "#c0392b") {
		t.Error("expected red colour (#c0392b) for FAIL result")
	}
}

func TestCertificateEmailHTML_PassOverridesFail(t *testing.T) {
	// When result is PASS the green colour should appear and NOT the red one
	// (they are mutually exclusive in the template).
	p := CertificateEmailParams{
		OverallResult: "PASS",
		CertificateID: "cert001",
		TenantName:    "Lab",
	}

	html := CertificateEmailHTML(p)
	if !strings.Contains(html, "#27ae60") {
		t.Error("expected green colour for PASS")
	}
	// The red colour is only injected when the result is not PASS.
	if strings.Contains(html, "#c0392b") {
		t.Error("did not expect red colour for PASS result")
	}
}

func TestCertificateEmailHTML_ContainsPerformedAt(t *testing.T) {
	p := CertificateEmailParams{
		PerformedAt:   "2025-06-01",
		OverallResult: "PASS",
		CertificateID: "cert001",
		TenantName:    "Lab",
	}

	html := CertificateEmailHTML(p)
	if !strings.Contains(html, "2025-06-01") {
		t.Error("expected PerformedAt date in email HTML")
	}
}

func TestCertificateEmailHTML_ContainsTechnicianName(t *testing.T) {
	p := CertificateEmailParams{
		TechnicianName: "Bob Jones",
		OverallResult:  "PASS",
		CertificateID:  "cert001",
		TenantName:     "Lab",
	}

	html := CertificateEmailHTML(p)
	if !strings.Contains(html, "Bob Jones") {
		t.Error("expected technician name in email HTML")
	}
}

func TestCertificateEmailHTML_ContainsOverallResult(t *testing.T) {
	for _, result := range []string{"PASS", "FAIL"} {
		p := CertificateEmailParams{
			OverallResult: result,
			CertificateID: "cert001",
			TenantName:    "Lab",
		}
		html := CertificateEmailHTML(p)
		if !strings.Contains(html, result) {
			t.Errorf("expected result %q in email HTML", result)
		}
	}
}

// ---------------------------------------------------------------------------
// Send — verify it fails fast when RESEND_API_KEY is unset (no network call)
// ---------------------------------------------------------------------------

func TestSend_NoAPIKey_ReturnsError(t *testing.T) {
	// Ensure the env var is absent for this test.
	t.Setenv("RESEND_API_KEY", "")

	err := Send(EmailPayload{
		From:    "test@example.com",
		To:      []string{"recipient@example.com"},
		Subject: "Test",
		Html:    "<p>Hello</p>",
	})
	if err == nil {
		t.Fatal("expected error when RESEND_API_KEY is not set")
	}
	if !strings.Contains(err.Error(), "RESEND_API_KEY") {
		t.Errorf("expected error to mention RESEND_API_KEY, got: %v", err)
	}
}
