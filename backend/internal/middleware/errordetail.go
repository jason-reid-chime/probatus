package middleware

import (
	"bytes"
	"encoding/json"
	"net/http"

	chimiddleware "github.com/go-chi/chi/v5/middleware"

	"github.com/jasonreid/probatus/internal/logging"
)

// ErrorDetails makes 5xx responses say what actually broke. It records the
// first error logged while serving the request (see logging.WithCapture) and
// adds it to the JSON error body as "detail", along with "request_id", which
// matches the request_id tag on the Sentry event and the request log line.
//
// Must come after chi's RequestID and before Recoverer, so panics are covered.
func ErrorDetails(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, captured := logging.WithCapture(r.Context())
		dw := &detailWriter{ResponseWriter: w}
		next.ServeHTTP(dw, r.WithContext(ctx))
		if dw.status >= 500 {
			dw.flushError(captured.Detail(), chimiddleware.GetReqID(ctx))
		}
	})
}

// detailWriter holds back 5xx responses so their body can be extended.
type detailWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
	buf         bytes.Buffer
}

func (d *detailWriter) WriteHeader(code int) {
	if d.wroteHeader {
		return
	}
	d.wroteHeader = true
	d.status = code
	if code < 500 {
		d.ResponseWriter.WriteHeader(code)
	}
}

func (d *detailWriter) Write(b []byte) (int, error) {
	if !d.wroteHeader {
		d.WriteHeader(http.StatusOK)
	}
	if d.status >= 500 {
		return d.buf.Write(b)
	}
	return d.ResponseWriter.Write(b)
}

func (d *detailWriter) flushError(detail, requestID string) {
	body := map[string]any{}
	if err := json.Unmarshal(d.buf.Bytes(), &body); err != nil {
		body = map[string]any{"error": http.StatusText(d.status)}
		if s := bytes.TrimSpace(d.buf.Bytes()); len(s) > 0 {
			body["error"] = string(s)
		}
	}
	if _, ok := body["detail"]; !ok && detail != "" {
		body["detail"] = detail
	}
	if requestID != "" {
		body["request_id"] = requestID
	}
	h := d.ResponseWriter.Header()
	h.Set("Content-Type", "application/json")
	h.Del("Content-Length")
	d.ResponseWriter.WriteHeader(d.status)
	json.NewEncoder(d.ResponseWriter).Encode(body) //nolint:errcheck
}
