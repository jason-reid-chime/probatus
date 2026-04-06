package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSecureHeaders(t *testing.T) {
	handler := SecureHeaders(http.HandlerFunc(ok))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	checks := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "strict-origin-when-cross-origin",
	}
	for header, want := range checks {
		if got := rr.Header().Get(header); got != want {
			t.Errorf("%s: got %q, want %q", header, got, want)
		}
	}
	if hsts := rr.Header().Get("Strict-Transport-Security"); !strings.HasPrefix(hsts, "max-age=") {
		t.Errorf("Strict-Transport-Security missing or malformed: %q", hsts)
	}
}

func TestLimitBody_AllowsSmallBody(t *testing.T) {
	handler := LimitBody(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 100)
		n, _ := r.Body.Read(buf)
		w.Write(buf[:n])
	}))

	body := strings.NewReader(`{"key":"value"}`)
	req := httptest.NewRequest(http.MethodPost, "/", body)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestLimitBody_RejectsOversizedBody(t *testing.T) {
	handler := LimitBody(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Try to read the entire body — MaxBytesReader will error
		buf := make([]byte, maxBodyBytes+10)
		if _, err := r.Body.Read(buf); err != nil {
			http.Error(w, "body too large", http.StatusRequestEntityTooLarge)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	// Body larger than 2 MB
	large := strings.NewReader(strings.Repeat("x", maxBodyBytes+1))
	req := httptest.NewRequest(http.MethodPost, "/", large)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("expected 413, got %d", rr.Code)
	}
}
