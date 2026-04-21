package assets

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// writeJSON (local helper)
// ---------------------------------------------------------------------------

func TestWriteJSON_ContentType(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusOK, map[string]string{"key": "value"})

	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}
}

func TestWriteJSON_StatusCode(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusCreated, nil)

	if w.Code != http.StatusCreated {
		t.Errorf("expected status 201, got %d", w.Code)
	}
}

func TestWriteJSON_Body(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusOK, map[string]int{"count": 42})

	var body map[string]int
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["count"] != 42 {
		t.Errorf("expected count=42, got %d", body["count"])
	}
}

// ---------------------------------------------------------------------------
// writeError (local helper)
// ---------------------------------------------------------------------------

func TestWriteError_StatusAndBody(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusBadRequest, "bad input")

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["error"] != "bad input" {
		t.Errorf("expected error 'bad input', got %q", body["error"])
	}
}

func TestWriteError_ContentType(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusInternalServerError, "internal error")

	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}
}

func TestWriteError_NotFoundStatus(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusNotFound, "not found")

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// isUniqueViolation — pure function, no DB required
// ---------------------------------------------------------------------------

func TestIsUniqueViolation_NilError(t *testing.T) {
	if isUniqueViolation(nil) {
		t.Error("expected false for nil error")
	}
}

func TestIsUniqueViolation_RandomError(t *testing.T) {
	err := &randomErr{"some other error"}
	if isUniqueViolation(err) {
		t.Error("expected false for non-pgconn error")
	}
}

// randomErr is a minimal error type that is NOT a *pgconn.PgError.
type randomErr struct{ msg string }

func (e *randomErr) Error() string { return e.msg }

// ---------------------------------------------------------------------------
// Create handler — malformed JSON body returns 400
// (decoding fails before any pool call)
// ---------------------------------------------------------------------------

func TestCreate_MalformedJSON_Returns400(t *testing.T) {
	h := &Handler{pool: nil}

	r := httptest.NewRequest(http.MethodPost, "/assets", strings.NewReader(`{not json}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Create(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["error"] != "invalid request body" {
		t.Errorf("unexpected error message: %q", body["error"])
	}
}

func TestCreate_EmptyBody_Returns400(t *testing.T) {
	h := &Handler{pool: nil}

	r := httptest.NewRequest(http.MethodPost, "/assets", strings.NewReader(""))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Create(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// Update handler — malformed JSON body returns 400
// ---------------------------------------------------------------------------

func TestUpdate_MalformedJSON_Returns400(t *testing.T) {
	h := &Handler{pool: nil}

	r := httptest.NewRequest(http.MethodPut, "/assets/some-id", strings.NewReader(`{bad`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Update(w, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}
