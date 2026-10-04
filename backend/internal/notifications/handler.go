// Package notifications emails alerts for instruments coming due or overdue.
//
// Routes (register in main.go; supervisor/admin only):
//
//	GET  /notifications/settings   handler.GetSettings
//	PUT  /notifications/settings   handler.PutSettings
//	GET  /notifications/history    handler.History
//	POST /notifications/run        handler.RunNow   — run the job for this tenant now
//
// Start runs the job for every tenant on a timer (see Run for the rules).
package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"log/slog"
	"net/http"
	"net/mail"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/jasonreid/probatus/internal/db"
	"github.com/jasonreid/probatus/internal/email"
	"github.com/jasonreid/probatus/internal/httputil"
	"github.com/jasonreid/probatus/internal/middleware"
)

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Handler serves notification settings and runs the alert job.
type Handler struct {
	pool querier
	send func(email.EmailPayload) error
	now  func() time.Time
}

// NewHandler creates a notifications Handler.
func NewHandler(pool db.Pool) *Handler {
	return &Handler{pool: pool, send: email.Send, now: time.Now}
}

// Settings are a tenant's alert preferences.
type Settings struct {
	Enabled            bool     `json:"enabled"`
	LeadDays           []int    `json:"lead_days"`
	NotifyOverdue      bool     `json:"notify_overdue"`
	InternalRecipients []string `json:"internal_recipients"`
	NotifyCustomers    bool     `json:"notify_customers"`
}

func defaultSettings() Settings {
	return Settings{LeadDays: []int{30, 7}, NotifyOverdue: true, InternalRecipients: []string{}}
}

func requireManager(w http.ResponseWriter, r *http.Request) bool {
	role := middleware.RoleFromCtx(r.Context())
	if role != "supervisor" && role != "admin" {
		httputil.WriteError(w, http.StatusForbidden, "only supervisors and admins can manage alerts")
		return false
	}
	return true
}

func (h *Handler) loadSettings(ctx context.Context, tenantID string) (Settings, error) {
	s := defaultSettings()
	err := h.pool.QueryRow(ctx,
		`SELECT enabled, lead_days, notify_overdue, internal_recipients, notify_customers
		 FROM notification_settings WHERE tenant_id = $1`, tenantID,
	).Scan(&s.Enabled, &s.LeadDays, &s.NotifyOverdue, &s.InternalRecipients, &s.NotifyCustomers)
	if err == pgx.ErrNoRows {
		return defaultSettings(), nil
	}
	return s, err
}

// GetSettings returns the tenant's alert settings (defaults if never saved).
func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	if !requireManager(w, r) {
		return
	}
	s, err := h.loadSettings(r.Context(), middleware.TenantIDFromCtx(r.Context()))
	if err != nil {
		slog.Error("notifications.GetSettings: failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to load settings")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, s)
}

// PutSettings saves the tenant's alert settings.
func (h *Handler) PutSettings(w http.ResponseWriter, r *http.Request) {
	if !requireManager(w, r) {
		return
	}
	var s Settings
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	seen := map[int]bool{}
	lead := []int{}
	for _, d := range s.LeadDays {
		if d < 1 || d > 365 {
			httputil.WriteError(w, http.StatusBadRequest, "lead days must be between 1 and 365")
			return
		}
		if !seen[d] {
			seen[d] = true
			lead = append(lead, d)
		}
	}
	sort.Sort(sort.Reverse(sort.IntSlice(lead)))
	s.LeadDays = lead
	recipients := []string{}
	for _, addr := range s.InternalRecipients {
		addr = strings.TrimSpace(addr)
		if addr == "" {
			continue
		}
		if _, err := mail.ParseAddress(addr); err != nil {
			httputil.WriteError(w, http.StatusBadRequest, fmt.Sprintf("%q is not a valid email address", addr))
			return
		}
		recipients = append(recipients, strings.ToLower(addr))
	}
	s.InternalRecipients = recipients
	if s.Enabled && len(s.InternalRecipients) == 0 && !s.NotifyCustomers {
		httputil.WriteError(w, http.StatusBadRequest, "add at least one recipient or enable customer alerts")
		return
	}
	if s.Enabled && len(s.LeadDays) == 0 && !s.NotifyOverdue {
		httputil.WriteError(w, http.StatusBadRequest, "choose at least one lead time or overdue alerts")
		return
	}

	if _, err := h.pool.Exec(r.Context(),
		`INSERT INTO notification_settings
		   (tenant_id, enabled, lead_days, notify_overdue, internal_recipients, notify_customers, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, now())
		 ON CONFLICT (tenant_id) DO UPDATE SET
		   enabled = EXCLUDED.enabled, lead_days = EXCLUDED.lead_days,
		   notify_overdue = EXCLUDED.notify_overdue, internal_recipients = EXCLUDED.internal_recipients,
		   notify_customers = EXCLUDED.notify_customers, updated_at = now()`,
		middleware.TenantIDFromCtx(r.Context()), s.Enabled, s.LeadDays, s.NotifyOverdue,
		s.InternalRecipients, s.NotifyCustomers); err != nil {
		slog.Error("notifications.PutSettings: failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to save settings")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, s)
}

// HistoryEntry is one alert that was sent (or attempted).
type HistoryEntry struct {
	ID        int64      `json:"id"`
	AssetID   string     `json:"asset_id"`
	TagID     string     `json:"tag_id"`
	DueDate   string     `json:"due_date"`
	Kind      string     `json:"kind"`
	Recipient string     `json:"recipient"`
	Status    string     `json:"status"`
	Error     *string    `json:"error"`
	CreatedAt time.Time  `json:"created_at"`
	SentAt    *time.Time `json:"sent_at"`
}

// History returns the most recent alerts for the tenant.
func (h *Handler) History(w http.ResponseWriter, r *http.Request) {
	if !requireManager(w, r) {
		return
	}
	rows, err := h.pool.Query(r.Context(),
		`SELECT n.id, n.asset_id::text, a.tag_id, n.due_date::text, n.kind, n.recipient,
		        n.status, n.error, n.created_at, n.sent_at
		 FROM notifications_sent n JOIN assets a ON a.id = n.asset_id
		 WHERE n.tenant_id = $1 ORDER BY n.id DESC LIMIT 200`,
		middleware.TenantIDFromCtx(r.Context()))
	if err != nil {
		slog.Error("notifications.History: failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to load history")
		return
	}
	defer rows.Close()
	out := []HistoryEntry{}
	for rows.Next() {
		var e HistoryEntry
		if err := rows.Scan(&e.ID, &e.AssetID, &e.TagID, &e.DueDate, &e.Kind, &e.Recipient,
			&e.Status, &e.Error, &e.CreatedAt, &e.SentAt); err != nil {
			httputil.WriteError(w, http.StatusInternalServerError, "failed to load history")
			return
		}
		out = append(out, e)
	}
	httputil.WriteJSON(w, http.StatusOK, out)
}

// RunNow runs the alert job for the caller's tenant immediately.
func (h *Handler) RunNow(w http.ResponseWriter, r *http.Request) {
	if !requireManager(w, r) {
		return
	}
	res, err := h.RunTenant(r.Context(), middleware.TenantIDFromCtx(r.Context()))
	if err != nil {
		slog.Error("notifications.RunNow: failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to run alerts: "+err.Error())
		return
	}
	httputil.WriteJSON(w, http.StatusOK, res)
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

// dueAsset is an instrument that needs an alert.
type dueAsset struct {
	ID            string
	TagID         string
	Description   string
	Location      string
	DueDate       time.Time
	DaysUntil     int
	Kind          string // due_<N> or overdue
	CustomerName  string
	CustomerEmail string
}

// RunResult summarises one run for one tenant.
type RunResult struct {
	Assets  int `json:"assets"`  // instruments that needed an alert
	Sent    int `json:"sent"`    // emails delivered
	Failed  int `json:"failed"`  // emails that failed (retried next run, up to 3 attempts)
	Skipped int `json:"skipped"` // alerts already sent earlier
}

// kindFor picks the alert an instrument is due for: the tightest lead time it
// has crossed, or overdue. A run that was missed still sends the most urgent
// alert rather than every alert it skipped.
func kindFor(daysUntil int, s Settings) string {
	if daysUntil < 0 {
		if s.NotifyOverdue {
			return "overdue"
		}
		return ""
	}
	best := -1
	for _, d := range s.LeadDays {
		if daysUntil <= d && (best == -1 || d < best) {
			best = d
		}
	}
	if best == -1 {
		return ""
	}
	return fmt.Sprintf("due_%d", best)
}

// RunTenant sends alerts for one tenant. Each (asset, due date, kind,
// recipient) is claimed in notifications_sent before sending, so concurrent
// runs never double-send; failed sends are retried on later runs (3 attempts).
func (h *Handler) RunTenant(ctx context.Context, tenantID string) (RunResult, error) {
	var res RunResult
	s, err := h.loadSettings(ctx, tenantID)
	if err != nil || !s.Enabled {
		return res, err
	}
	maxLead := 0
	for _, d := range s.LeadDays {
		if d > maxLead {
			maxLead = d
		}
	}
	today := h.now().UTC().Truncate(24 * time.Hour)

	rows, err := h.pool.Query(ctx,
		`SELECT a.id::text, a.tag_id,
		        TRIM(CONCAT_WS(' ', a.manufacturer, a.model, '(' || REPLACE(a.instrument_type::text, '_', ' ') || ')')),
		        COALESCE(a.location, ''), a.next_due_at,
		        COALESCE(c.name, ''), COALESCE(c.email, '')
		 FROM assets a LEFT JOIN customers c ON c.id = a.customer_id
		 WHERE a.tenant_id = $1 AND a.next_due_at IS NOT NULL
		   AND a.next_due_at <= $2::date + $3::int
		 ORDER BY a.next_due_at, a.tag_id`,
		tenantID, today, maxLead)
	if err != nil {
		return res, err
	}
	var due []dueAsset
	for rows.Next() {
		var a dueAsset
		if err := rows.Scan(&a.ID, &a.TagID, &a.Description, &a.Location, &a.DueDate, &a.CustomerName, &a.CustomerEmail); err != nil {
			rows.Close()
			return res, err
		}
		a.DaysUntil = int(a.DueDate.UTC().Truncate(24*time.Hour).Sub(today).Hours() / 24)
		if a.Kind = kindFor(a.DaysUntil, s); a.Kind != "" {
			due = append(due, a)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return res, err
	}
	res.Assets = len(due)
	if len(due) == 0 {
		return res, nil
	}

	// One digest per recipient: staff get every instrument, each customer
	// gets only their own.
	digests := map[string][]dueAsset{}
	for _, a := range due {
		for _, r := range s.InternalRecipients {
			digests[r] = append(digests[r], a)
		}
		if s.NotifyCustomers && a.CustomerEmail != "" {
			addr := strings.ToLower(strings.TrimSpace(a.CustomerEmail))
			digests[addr] = append(digests[addr], a)
		}
	}

	var tenantName string
	h.pool.QueryRow(ctx, `SELECT name FROM tenants WHERE id = $1`, tenantID).Scan(&tenantName) //nolint:errcheck

	recipients := make([]string, 0, len(digests))
	for r := range digests {
		recipients = append(recipients, r)
	}
	sort.Strings(recipients)

	for _, recipient := range recipients {
		var claimed []dueAsset
		var claimIDs []int64
		for _, a := range digests[recipient] {
			var id int64
			err := h.pool.QueryRow(ctx,
				`INSERT INTO notifications_sent (tenant_id, asset_id, due_date, kind, recipient)
				 VALUES ($1, $2::uuid, $3::date, $4, $5)
				 ON CONFLICT (asset_id, due_date, kind, recipient) DO UPDATE
				   SET status = 'sending', attempts = notifications_sent.attempts + 1, error = NULL
				   WHERE notifications_sent.status = 'failed' AND notifications_sent.attempts < 3
				 RETURNING id`,
				tenantID, a.ID, a.DueDate, a.Kind, recipient).Scan(&id)
			if err == pgx.ErrNoRows {
				res.Skipped++
				continue
			}
			if err != nil {
				return res, err
			}
			claimed = append(claimed, a)
			claimIDs = append(claimIDs, id)
		}
		if len(claimed) == 0 {
			continue
		}
		sendErr := h.send(email.EmailPayload{
			From:    fromAddress(),
			To:      []string{recipient},
			Subject: digestSubject(claimed, tenantName),
			Html:    DigestHTML(claimed, tenantName, today),
		})
		status, errText := "sent", ""
		if sendErr != nil {
			status, errText = "failed", sendErr.Error()
			res.Failed++
			slog.Warn("notifications: send failed", "tenant_id", tenantID, "recipient", recipient, "error", sendErr)
		} else {
			res.Sent++
		}
		if _, err := h.pool.Exec(ctx,
			`UPDATE notifications_sent
			 SET status = $2, error = NULLIF($3, ''), sent_at = CASE WHEN $2 = 'sent' THEN now() END
			 WHERE id = ANY($1)`, claimIDs, status, errText); err != nil {
			return res, err
		}
	}
	return res, nil
}

// RunAll runs the job for every tenant with alerts enabled.
func (h *Handler) RunAll(ctx context.Context) {
	rows, err := h.pool.Query(ctx, `SELECT tenant_id::text FROM notification_settings WHERE enabled`)
	if err != nil {
		slog.Error("notifications: listing tenants failed", "error", err)
		return
	}
	var tenants []string
	for rows.Next() {
		var t string
		if rows.Scan(&t) == nil {
			tenants = append(tenants, t)
		}
	}
	rows.Close()
	for _, t := range tenants {
		res, err := h.RunTenant(ctx, t)
		if err != nil {
			slog.Error("notifications: run failed", "tenant_id", t, "error", err)
			continue
		}
		if res.Sent+res.Failed > 0 {
			slog.Info("notifications: run complete", "tenant_id", t, "assets", res.Assets, "sent", res.Sent, "failed", res.Failed)
		}
	}
}

// Start runs RunAll shortly after boot and then every interval until ctx ends.
// Claims in notifications_sent make it safe to run on several instances.
func (h *Handler) Start(ctx context.Context, interval time.Duration) {
	go func() {
		timer := time.NewTimer(time.Minute)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				h.RunAll(ctx)
				timer.Reset(interval)
			}
		}
	}()
}

func fromAddress() string {
	if v := os.Getenv("RESEND_FROM_EMAIL"); v != "" {
		return v
	}
	return "Probatus <noreply@probatus.app>"
}

func digestSubject(assets []dueAsset, tenantName string) string {
	overdue := 0
	for _, a := range assets {
		if a.DaysUntil < 0 {
			overdue++
		}
	}
	prefix := tenantName
	if prefix == "" {
		prefix = "Probatus"
	}
	switch {
	case overdue > 0 && overdue == len(assets):
		return fmt.Sprintf("%s: %d instrument(s) overdue for calibration", prefix, overdue)
	case overdue > 0:
		return fmt.Sprintf("%s: %d overdue, %d coming due for calibration", prefix, overdue, len(assets)-overdue)
	default:
		return fmt.Sprintf("%s: %d instrument(s) coming due for calibration", prefix, len(assets))
	}
}

// DigestHTML renders the alert email.
func DigestHTML(assets []dueAsset, tenantName string, today time.Time) string {
	esc := html.EscapeString
	var b strings.Builder
	fmt.Fprintf(&b, `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:680px">
<h2 style="margin:0 0 4px">Calibration due-date reminder</h2>
<p style="margin:0 0 16px;color:#555">%s · %s</p>
<table style="width:100%%;border-collapse:collapse;font-size:14px">
<tr style="background:#f4f4f4"><th align="left" style="padding:6px">Tag</th><th align="left" style="padding:6px">Instrument</th><th align="left" style="padding:6px">Customer / location</th><th align="left" style="padding:6px">Due</th></tr>`,
		esc(tenantName), today.Format("2 Jan 2006"))
	for _, a := range assets {
		status := fmt.Sprintf("in %d day(s)", a.DaysUntil)
		color := "#b45309"
		switch {
		case a.DaysUntil < 0:
			status, color = fmt.Sprintf("OVERDUE by %d day(s)", -a.DaysUntil), "#c0392b"
		case a.DaysUntil == 0:
			status = "today"
		}
		where := strings.Trim(strings.Join([]string{a.CustomerName, a.Location}, " · "), " ·")
		fmt.Fprintf(&b, `<tr><td style="padding:6px;border-bottom:1px solid #eee"><strong>%s</strong></td><td style="padding:6px;border-bottom:1px solid #eee">%s</td><td style="padding:6px;border-bottom:1px solid #eee">%s</td><td style="padding:6px;border-bottom:1px solid #eee;color:%s">%s<br><span style="color:#777">%s</span></td></tr>`,
			esc(a.TagID), esc(a.Description), esc(where), color, status, a.DueDate.Format("2006-01-02"))
	}
	b.WriteString(`</table><p style="color:#777;font-size:12px;margin-top:16px">You are receiving this because calibration alerts are enabled for your organisation.</p></div>`)
	return b.String()
}

// RunTenantWith runs the job for one tenant with a substitute mail sender.
// Used by tests.
func RunTenantWith(h *Handler, ctx context.Context, tenantID string, send func(email.EmailPayload) error) (RunResult, error) {
	prev := h.send
	h.send = send
	defer func() { h.send = prev }()
	return h.RunTenant(ctx, tenantID)
}
