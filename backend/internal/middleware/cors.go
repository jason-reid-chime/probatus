package middleware

import (
	"net/http"
	"os"
	"strings"
)

// CORS returns a middleware that sets permissive CORS headers. The allowed
// origins are read from the CORS_ORIGINS environment variable (comma-separated).
// When the variable is unset or empty, all origins ("*") are allowed.
func CORS(next http.Handler) http.Handler {
	originsEnv := os.Getenv("CORS_ORIGINS")
	allowedOrigins := []string{}
	if originsEnv != "" {
		for _, o := range strings.Split(originsEnv, ",") {
			o = strings.TrimSpace(o)
			if o != "" {
				allowedOrigins = append(allowedOrigins, o)
			}
		}
	}
	allowAll := len(allowedOrigins) == 0

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		allowedOrigin := "*"
		if !allowAll && origin != "" {
			matched := false
			for _, o := range allowedOrigins {
				if o == origin {
					matched = true
					break
				}
			}
			if matched {
				allowedOrigin = origin
			} else {
				// Origin not in whitelist — skip CORS headers.
				allowedOrigin = ""
			}
		}

		if allowedOrigin != "" {
			w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID")
			w.Header().Set("Access-Control-Max-Age", "86400")
			if !allowAll {
				w.Header().Set("Vary", "Origin")
			}
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
