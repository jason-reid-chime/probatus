package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func ok(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }

func TestRateLimit_AllowsNormalTraffic(t *testing.T) {
	handler := RateLimit(http.HandlerFunc(ok))

	// Burst size is 20 — first 20 requests from a fresh IP should all pass.
	for i := 0; i < burstSize; i++ {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = "10.0.0.1:1234"
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i+1, rr.Code)
		}
	}
}

func TestRateLimit_BlocksAfterBurst(t *testing.T) {
	handler := RateLimit(http.HandlerFunc(ok))

	// Exhaust the burst for a unique IP.
	ip := "10.1.2.3"
	for i := 0; i < burstSize; i++ {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = ip + ":9999"
		httptest.NewRecorder() // discard
		handler.ServeHTTP(httptest.NewRecorder(), req)
	}

	// Next request should be rate-limited.
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = ip + ":9999"
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rr.Code)
	}
	if rr.Header().Get("Retry-After") == "" {
		t.Error("expected Retry-After header to be set")
	}
}

func TestRateLimit_IsolatesIPs(t *testing.T) {
	handler := RateLimit(http.HandlerFunc(ok))

	// Exhaust burst for one IP.
	for i := 0; i < burstSize+1; i++ {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = "192.168.1.1:1111"
		handler.ServeHTTP(httptest.NewRecorder(), req)
	}

	// A different IP should still be allowed.
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "192.168.1.2:2222"
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("different IP should not be rate limited, got %d", rr.Code)
	}
}

func TestClientIP_XForwardedFor(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-For", "1.2.3.4, 10.0.0.1")
	req.RemoteAddr = "10.0.0.1:9999"

	ip := clientIP(req)
	if ip != "1.2.3.4" {
		t.Errorf("expected 1.2.3.4, got %s", ip)
	}
}

func TestClientIP_RemoteAddr(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "5.6.7.8:4321"

	ip := clientIP(req)
	if ip != "5.6.7.8" {
		t.Errorf("expected 5.6.7.8, got %s", ip)
	}
}
