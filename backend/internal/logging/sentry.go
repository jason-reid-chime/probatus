// Package logging forwards error-level slog records to Sentry, so every error
// the API logs shows up there without each call site reporting it.
package logging

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/getsentry/sentry-go"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
)

// ReportedKey marks a record that has already been sent to Sentry (e.g. a
// recovered panic), so the handler doesn't report it twice.
const ReportedKey = "sentry_reported"

// Captured holds the first error logged while serving a request, so the
// response can tell the user what actually failed.
type Captured struct {
	mu     sync.Mutex
	set    bool
	detail string
}

// Detail returns the first logged error's text, or "" if none was logged.
func (c *Captured) Detail() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.detail
}

type captureKey struct{}

// WithCapture returns a context in which errors logged with
// slog.ErrorContext are recorded in the returned Captured.
func WithCapture(ctx context.Context) (context.Context, *Captured) {
	c := &Captured{}
	return context.WithValue(ctx, captureKey{}, c), c
}

// SentryHandler wraps another handler, passing every record through. Records
// at slog.LevelError and above are also sent to Sentry (a no-op when Sentry is
// not initialised) and recorded in the request's Captured, if any.
type SentryHandler struct {
	next  slog.Handler
	attrs []slog.Attr
}

// NewSentryHandler wraps next.
func NewSentryHandler(next slog.Handler) *SentryHandler {
	return &SentryHandler{next: next}
}

func (h *SentryHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.next.Enabled(ctx, level)
}

func (h *SentryHandler) Handle(ctx context.Context, r slog.Record) error {
	if r.Level >= slog.LevelError {
		h.report(ctx, r)
	}
	return h.next.Handle(ctx, r)
}

func (h *SentryHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &SentryHandler{
		next:  h.next.WithAttrs(attrs),
		attrs: append(append([]slog.Attr{}, h.attrs...), attrs...),
	}
}

// WithGroup is passed through; grouped attrs are reported flat.
func (h *SentryHandler) WithGroup(name string) slog.Handler {
	return &SentryHandler{next: h.next.WithGroup(name), attrs: h.attrs}
}

func (h *SentryHandler) report(ctx context.Context, r slog.Record) {
	extra := map[string]any{}
	var errVal error
	skip := false
	collect := func(a slog.Attr) bool {
		if a.Key == ReportedKey {
			skip = true
			return true
		}
		v := a.Value.Resolve().Any()
		if e, ok := v.(error); ok && a.Key == "error" {
			errVal = e
			v = e.Error()
		}
		extra[a.Key] = v
		return true
	}
	for _, a := range h.attrs {
		collect(a)
	}
	r.Attrs(collect)

	if c, ok := ctx.Value(captureKey{}).(*Captured); ok {
		c.mu.Lock()
		if !c.set {
			c.set = true
			c.detail = r.Message
			if errVal != nil {
				c.detail += ": " + errVal.Error()
			} else if v, ok := extra["error"]; ok {
				c.detail += ": " + fmt.Sprint(v)
			}
		}
		c.mu.Unlock()
	}
	if skip {
		return
	}

	hub := sentry.GetHubFromContext(ctx)
	if hub == nil {
		hub = sentry.CurrentHub()
	}
	hub.WithScope(func(scope *sentry.Scope) {
		scope.SetLevel(sentry.LevelError)
		if id := chimiddleware.GetReqID(ctx); id != "" {
			scope.SetTag("request_id", id)
		}
		scope.SetContext("log", extra)
		// Group by log message rather than by the (variable) error text.
		scope.SetFingerprint([]string{"slog", r.Message})
		if errVal != nil {
			scope.SetTag("log_message", r.Message)
			hub.CaptureException(errVal)
			return
		}
		hub.CaptureMessage(r.Message)
	})
}
