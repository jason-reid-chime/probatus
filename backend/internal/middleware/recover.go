package middleware

import (
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/getsentry/sentry-go"
)

// Recoverer catches panics, reports them to Sentry (when initialised), logs
// the stack trace, and returns a 500 to the client instead of crashing.
func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				stack := debug.Stack()

				// Report to Sentry if it's been initialised
				if hub := sentry.GetHubFromContext(r.Context()); hub != nil {
					hub.RecoverWithContext(r.Context(), rec)
				} else {
					sentry.CurrentHub().RecoverWithContext(r.Context(), rec)
				}

				slog.Error("panic recovered",
					"error", rec,
					"stack", string(stack),
					"method", r.Method,
					"path", r.URL.Path,
				)

				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte(`{"error":"internal server error"}`))
			}
		}()
		next.ServeHTTP(w, r)
	})
}
