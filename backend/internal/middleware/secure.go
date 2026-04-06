package middleware

import (
	"net/http"
)

// maxBodyBytes is the default request body size limit (2 MB).
// The certificate and audit endpoints post larger HTML payloads, so they
// use a higher ceiling applied directly in those handlers.
const maxBodyBytes = 2 * 1024 * 1024 // 2 MB

// SecureHeaders sets defensive HTTP response headers on every response.
// These are API-appropriate values: no CSP (APIs don't serve HTML) but
// the framing/sniffing/transport headers still matter.
func SecureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Prevent MIME-type sniffing
		w.Header().Set("X-Content-Type-Options", "nosniff")
		// Disallow embedding in iframes
		w.Header().Set("X-Frame-Options", "DENY")
		// Force HTTPS for 1 year (browsers respect this even for API origins)
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		// Don't send Referrer header to third parties
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		// Remove server fingerprint
		w.Header().Del("Server")

		next.ServeHTTP(w, r)
	})
}

// LimitBody caps the incoming request body to maxBodyBytes.
// Returns 413 if exceeded so the client gets a clear signal instead of
// the server silently dropping data or hanging on a large read.
func LimitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		next.ServeHTTP(w, r)
	})
}
