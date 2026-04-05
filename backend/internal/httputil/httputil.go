// Package httputil provides shared HTTP response helpers used across handler packages.
package httputil

import (
	"encoding/json"
	"net/http"
)

// WriteJSON serialises v as JSON and writes it with the given status code.
// The Content-Type header is set to application/json.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

// WriteError writes a JSON object {"error": msg} with the given status code.
func WriteError(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, map[string]string{"error": msg})
}
