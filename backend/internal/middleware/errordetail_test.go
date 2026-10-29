package middleware

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	chimiddleware "github.com/go-chi/chi/v5/middleware"

	"github.com/jasonreid/probatus/internal/logging"
)

func TestErrorDetails_AddsLoggedErrorTo5xx(t *testing.T) {
	prev := slog.Default()
	slog.SetDefault(slog.New(logging.NewSentryHandler(slog.NewTextHandler(os.Stderr, nil))))
	defer slog.SetDefault(prev)

	h := chimiddleware.RequestID(ErrorDetails(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slog.ErrorContext(r.Context(), "calibrations.Create: insert failed", "error", errors.New("boom"))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"failed to create calibration record"}`))
	})))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/calibrations", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body not JSON: %s", rec.Body.String())
	}
	if body["error"] != "failed to create calibration record" {
		t.Errorf("error = %q", body["error"])
	}
	if body["detail"] != "calibrations.Create: insert failed: boom" {
		t.Errorf("detail = %q", body["detail"])
	}
	if body["request_id"] == "" {
		t.Error("missing request_id")
	}
}

func TestErrorDetails_LeavesNon5xxUntouched(t *testing.T) {
	h := ErrorDetails(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		w.Write([]byte(`{"error":"bad"}`))
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusUnprocessableEntity || rec.Body.String() != `{"error":"bad"}` {
		t.Errorf("got %d %s", rec.Code, rec.Body.String())
	}
}
