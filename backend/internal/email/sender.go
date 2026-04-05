package email

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

// Attachment represents a file attachment for an email.
type Attachment struct {
	Filename string `json:"filename"`
	Content  string `json:"content"` // base64 encoded
}

// EmailPayload is the request body sent to the Resend API.
type EmailPayload struct {
	From        string       `json:"from"`
	To          []string     `json:"to"`
	Subject     string       `json:"subject"`
	Html        string       `json:"html"`
	Attachments []Attachment `json:"attachments,omitempty"`
}

// Send sends an email via the Resend API.
// It reads RESEND_API_KEY from the environment at call time.
// Returns nil on success, a descriptive error otherwise.
func Send(payload EmailPayload) error {
	apiKey := os.Getenv("RESEND_API_KEY")
	if apiKey == "" {
		return fmt.Errorf("email: RESEND_API_KEY is not set")
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("email: failed to marshal payload: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("email: failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("email: Resend request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("email: Resend returned status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}
