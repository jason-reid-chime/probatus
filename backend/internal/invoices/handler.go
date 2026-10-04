// Package invoices provides billing for completed calibration work.
//
// Routes (register in main.go; all supervisor/admin only):
//
//	GET    /invoices                     handler.List
//	POST   /invoices                     handler.Create
//	GET    /invoices/{id}                handler.Get
//	PUT    /invoices/{id}                handler.Update        (drafts only)
//	DELETE /invoices/{id}                handler.Delete        (drafts only)
//	PATCH  /invoices/{id}/status         handler.UpdateStatus  (sent / paid / void)
//	POST   /work-orders/{id}/invoice     handler.FromWorkOrder
package invoices

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"log/slog"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
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
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Handler serves invoices.
type Handler struct {
	pool querier
	send func(email.EmailPayload) error
}

// NewHandler creates an invoices Handler.
func NewHandler(pool db.Pool) *Handler {
	return &Handler{pool: pool, send: email.Send}
}

// Line is one invoice line.
type Line struct {
	ID          string  `json:"id,omitempty"`
	Description string  `json:"description"`
	Quantity    float64 `json:"quantity"`
	UnitPrice   float64 `json:"unit_price"`
	Amount      float64 `json:"amount"`
	AssetID     *string `json:"asset_id"`
	RecordID    *string `json:"record_id"`
	AssetTag    *string `json:"asset_tag,omitempty"`
}

// Invoice is an invoice with computed totals.
type Invoice struct {
	ID            string     `json:"id"`
	Number        int        `json:"number"`
	CustomerID    *string    `json:"customer_id"`
	CustomerName  *string    `json:"customer_name"`
	CustomerEmail *string    `json:"customer_email,omitempty"`
	WorkOrderID   *string    `json:"work_order_id"`
	Status        string     `json:"status"`
	IssueDate     string     `json:"issue_date"`
	DueDate       *string    `json:"due_date"`
	Currency      string     `json:"currency"`
	TaxRate       float64    `json:"tax_rate"`
	Notes         *string    `json:"notes"`
	SentAt        *time.Time `json:"sent_at"`
	PaidAt        *time.Time `json:"paid_at"`
	CreatedAt     time.Time  `json:"created_at"`
	Subtotal      float64    `json:"subtotal"`
	Tax           float64    `json:"tax"`
	Total         float64    `json:"total"`
	Lines         []Line     `json:"lines,omitempty"`
}

// input is the editable part of an invoice.
type input struct {
	CustomerID  *string `json:"customer_id"`
	WorkOrderID *string `json:"work_order_id"`
	IssueDate   string  `json:"issue_date"`
	DueDate     *string `json:"due_date"`
	Currency    string  `json:"currency"`
	TaxRate     float64 `json:"tax_rate"`
	Notes       *string `json:"notes"`
	Lines       []Line  `json:"lines"`
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

func (inv *Invoice) computeTotals() {
	inv.Subtotal = 0
	for i := range inv.Lines {
		inv.Lines[i].Amount = round2(inv.Lines[i].Quantity * inv.Lines[i].UnitPrice)
		inv.Subtotal += inv.Lines[i].Amount
	}
	inv.Subtotal = round2(inv.Subtotal)
	inv.Tax = round2(inv.Subtotal * inv.TaxRate / 100)
	inv.Total = round2(inv.Subtotal + inv.Tax)
}

func requireManager(w http.ResponseWriter, r *http.Request) bool {
	role := middleware.RoleFromCtx(r.Context())
	if role != "supervisor" && role != "admin" {
		httputil.WriteError(w, http.StatusForbidden, "only supervisors and admins can manage invoices")
		return false
	}
	return true
}

func (in *input) validate() string {
	if in.Currency == "" {
		in.Currency = "CAD"
	}
	if len(in.Currency) != 3 {
		return "currency must be a 3-letter code"
	}
	if in.TaxRate < 0 || in.TaxRate > 100 {
		return "tax_rate must be between 0 and 100"
	}
	for i, l := range in.Lines {
		if strings.TrimSpace(l.Description) == "" {
			return fmt.Sprintf("line %d needs a description", i+1)
		}
		if l.Quantity < 0 {
			return fmt.Sprintf("line %d has a negative quantity", i+1)
		}
	}
	return ""
}

const listCols = `
	i.id::text, i.number, i.customer_id::text, c.name, c.email, i.work_order_id::text,
	i.status::text, i.issue_date::text, i.due_date::text, i.currency, i.tax_rate::float8,
	i.notes, i.sent_at, i.paid_at, i.created_at,
	COALESCE((SELECT SUM(ROUND(l.quantity * l.unit_price, 2)) FROM invoice_lines l WHERE l.invoice_id = i.id), 0)::float8`

func scanInvoice(row pgx.Row) (*Invoice, error) {
	var inv Invoice
	err := row.Scan(&inv.ID, &inv.Number, &inv.CustomerID, &inv.CustomerName, &inv.CustomerEmail,
		&inv.WorkOrderID, &inv.Status, &inv.IssueDate, &inv.DueDate, &inv.Currency, &inv.TaxRate,
		&inv.Notes, &inv.SentAt, &inv.PaidAt, &inv.CreatedAt, &inv.Subtotal)
	if err != nil {
		return nil, err
	}
	inv.Subtotal = round2(inv.Subtotal)
	inv.Tax = round2(inv.Subtotal * inv.TaxRate / 100)
	inv.Total = round2(inv.Subtotal + inv.Tax)
	return &inv, nil
}

// List returns invoices, newest number first. Filters: status, customer_id.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if !requireManager(w, r) {
		return
	}
	ctx := r.Context()
	tenantID := middleware.TenantIDFromCtx(ctx)
	sql := `SELECT ` + listCols + ` FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.tenant_id = $1`
	args := []any{tenantID}
	if s := r.URL.Query().Get("status"); s != "" {
		args = append(args, s)
		sql += fmt.Sprintf(" AND i.status = $%d::invoice_status", len(args))
	}
	if c := r.URL.Query().Get("customer_id"); c != "" {
		args = append(args, c)
		sql += fmt.Sprintf(" AND i.customer_id = $%d::uuid", len(args))
	}
	rows, err := h.pool.Query(ctx, sql+" ORDER BY i.number DESC LIMIT 500", args...)
	if err != nil {
		slog.Error("invoices.List: query failed", "tenant_id", tenantID, "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to list invoices")
		return
	}
	defer rows.Close()
	out := []Invoice{}
	for rows.Next() {
		inv, err := scanInvoice(rows)
		if err != nil {
			slog.Error("invoices.List: scan failed", "error", err)
			httputil.WriteError(w, http.StatusInternalServerError, "failed to list invoices")
			return
		}
		out = append(out, *inv)
	}
	httputil.WriteJSON(w, http.StatusOK, out)
}

func (h *Handler) load(ctx context.Context, tenantID, id string) (*Invoice, error) {
	inv, err := scanInvoice(h.pool.QueryRow(ctx,
		`SELECT `+listCols+` FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
		 WHERE i.tenant_id = $1 AND i.id = $2::uuid`, tenantID, id))
	if err != nil {
		return nil, err
	}
	rows, err := h.pool.Query(ctx,
		`SELECT l.id::text, l.description, l.quantity::float8, l.unit_price::float8,
		        l.asset_id::text, l.record_id::text, a.tag_id
		 FROM invoice_lines l LEFT JOIN assets a ON a.id = l.asset_id
		 WHERE l.invoice_id = $1::uuid ORDER BY l.position, l.id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	inv.Lines = []Line{}
	for rows.Next() {
		var l Line
		if err := rows.Scan(&l.ID, &l.Description, &l.Quantity, &l.UnitPrice, &l.AssetID, &l.RecordID, &l.AssetTag); err != nil {
			return nil, err
		}
		inv.Lines = append(inv.Lines, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	inv.computeTotals()
	return inv, nil
}

// Get returns one invoice with its lines.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	if !requireManager(w, r) {
		return
	}
	ctx := r.Context()
	inv, err := h.load(ctx, middleware.TenantIDFromCtx(ctx), chi.URLParam(r, "id"))
	if err == pgx.ErrNoRows {
		httputil.WriteError(w, http.StatusNotFound, "invoice not found")
		return
	}
	if err != nil {
		slog.Error("invoices.Get: failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to load invoice")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, inv)
}

func replaceLines(ctx context.Context, tx pgx.Tx, invoiceID string, lines []Line) error {
	if _, err := tx.Exec(ctx, `DELETE FROM invoice_lines WHERE invoice_id = $1::uuid`, invoiceID); err != nil {
		return err
	}
	for i, l := range lines {
		if _, err := tx.Exec(ctx,
			`INSERT INTO invoice_lines (invoice_id, position, description, quantity, unit_price, asset_id, record_id)
			 VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7::uuid)`,
			invoiceID, i, strings.TrimSpace(l.Description), l.Quantity, l.UnitPrice, l.AssetID, l.RecordID,
		); err != nil {
			return err
		}
	}
	return nil
}

// create inserts an invoice with the next number for the tenant.
func (h *Handler) create(ctx context.Context, in input) (string, error) {
	tenantID := middleware.TenantIDFromCtx(ctx)
	userID := middleware.UserIDFromCtx(ctx)
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Serialise numbering per tenant so two invoices never share a number.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('invoice_number:' || $1, 0))`, tenantID); err != nil {
		return "", err
	}
	issue := in.IssueDate
	if issue == "" {
		issue = time.Now().UTC().Format("2006-01-02")
	}
	var id string
	if err := tx.QueryRow(ctx,
		`INSERT INTO invoices (tenant_id, number, customer_id, work_order_id, issue_date, due_date,
		                       currency, tax_rate, notes, created_by)
		 VALUES ($1, (SELECT COALESCE(MAX(number), 0) + 1 FROM invoices WHERE tenant_id = $1),
		         $2::uuid, $3::uuid, $4::date, $5::date, $6, $7, $8, NULLIF($9, '')::uuid)
		 RETURNING id::text`,
		tenantID, in.CustomerID, in.WorkOrderID, issue, in.DueDate, strings.ToUpper(in.Currency),
		in.TaxRate, in.Notes, userID,
	).Scan(&id); err != nil {
		return "", err
	}
	if err := replaceLines(ctx, tx, id, in.Lines); err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

// Create inserts an invoice from a JSON body.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	if !requireManager(w, r) {
		return
	}
	var in input
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if msg := in.validate(); msg != "" {
		httputil.WriteError(w, http.StatusBadRequest, msg)
		return
	}
	ctx := r.Context()
	id, err := h.create(ctx, in)
	if err != nil {
		slog.Error("invoices.Create: failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to create invoice")
		return
	}
	httputil.WriteJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// Update replaces a draft invoice's fields and lines.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	if !requireManager(w, r) {
		return
	}
	var in input
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if msg := in.validate(); msg != "" {
		httputil.WriteError(w, http.StatusBadRequest, msg)
		return
	}
	ctx := r.Context()
	tenantID := middleware.TenantIDFromCtx(ctx)
	id := chi.URLParam(r, "id")

	tx, err := h.pool.Begin(ctx)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "failed to update invoice")
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	tag, err := tx.Exec(ctx,
		`UPDATE invoices SET customer_id = $3::uuid, work_order_id = $4::uuid,
		        issue_date = COALESCE(NULLIF($5, '')::date, issue_date), due_date = $6::date,
		        currency = $7, tax_rate = $8, notes = $9, updated_at = now()
		 WHERE tenant_id = $1 AND id = $2::uuid AND status = 'draft'`,
		tenantID, id, in.CustomerID, in.WorkOrderID, in.IssueDate, in.DueDate,
		strings.ToUpper(in.Currency), in.TaxRate, in.Notes)
	if err != nil {
		slog.Error("invoices.Update: failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to update invoice")
		return
	}
	if tag.RowsAffected() == 0 {
		httputil.WriteError(w, http.StatusConflict, "invoice not found or no longer a draft")
		return
	}
	if err := replaceLines(ctx, tx, id, in.Lines); err != nil {
		slog.Error("invoices.Update: lines failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to update invoice lines")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "failed to update invoice")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"id": id})
}

// Delete removes a draft invoice. Issued invoices are voided instead, so the
// numbering has no gaps an auditor can't explain.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	if !requireManager(w, r) {
		return
	}
	ctx := r.Context()
	tag, err := h.pool.Exec(ctx,
		`DELETE FROM invoices WHERE tenant_id = $1 AND id = $2::uuid AND status = 'draft'`,
		middleware.TenantIDFromCtx(ctx), chi.URLParam(r, "id"))
	if err != nil {
		slog.Error("invoices.Delete: failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to delete invoice")
		return
	}
	if tag.RowsAffected() == 0 {
		httputil.WriteError(w, http.StatusConflict, "only draft invoices can be deleted; void it instead")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// allowedTransitions maps current status to the statuses it may move to.
var allowedTransitions = map[string][]string{
	"draft": {"sent", "void"},
	"sent":  {"paid", "void"},
	"paid":  {"sent"}, // undo a payment recorded by mistake
}

// UpdateStatus moves an invoice to sent, paid or void. With "email": true on
// a send, the invoice is emailed to the customer's contact address.
func (h *Handler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	if !requireManager(w, r) {
		return
	}
	var body struct {
		Status string `json:"status"`
		Email  bool   `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	ctx := r.Context()
	tenantID := middleware.TenantIDFromCtx(ctx)
	id := chi.URLParam(r, "id")

	inv, err := h.load(ctx, tenantID, id)
	if err == pgx.ErrNoRows {
		httputil.WriteError(w, http.StatusNotFound, "invoice not found")
		return
	}
	if err != nil {
		slog.Error("invoices.UpdateStatus: load failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to load invoice")
		return
	}
	ok := false
	for _, s := range allowedTransitions[inv.Status] {
		ok = ok || s == body.Status
	}
	if !ok {
		httputil.WriteError(w, http.StatusConflict, fmt.Sprintf("cannot change a %s invoice to %s", inv.Status, body.Status))
		return
	}
	if body.Status == "sent" && len(inv.Lines) == 0 {
		httputil.WriteError(w, http.StatusUnprocessableEntity, "add at least one line before sending")
		return
	}
	if body.Email && body.Status == "sent" {
		if inv.CustomerEmail == nil || *inv.CustomerEmail == "" {
			httputil.WriteError(w, http.StatusUnprocessableEntity, "the customer has no email address")
			return
		}
		var tenantName string
		h.pool.QueryRow(ctx, `SELECT name FROM tenants WHERE id = $1`, tenantID).Scan(&tenantName) //nolint:errcheck
		if err := h.send(email.EmailPayload{
			From:    fromAddress(),
			To:      []string{*inv.CustomerEmail},
			Subject: fmt.Sprintf("Invoice #%d from %s", inv.Number, tenantName),
			Html:    InvoiceEmailHTML(inv, tenantName),
		}); err != nil {
			slog.Error("invoices.UpdateStatus: email failed", "invoice_id", id, "error", err)
			httputil.WriteError(w, http.StatusBadGateway, "failed to email the invoice: "+err.Error())
			return
		}
	}

	if _, err := h.pool.Exec(ctx,
		`UPDATE invoices SET status = $3::invoice_status, updated_at = now(),
		        sent_at = CASE WHEN $3 = 'sent' THEN COALESCE(sent_at, now()) ELSE sent_at END,
		        paid_at = CASE WHEN $3 = 'paid' THEN now() WHEN $3 = 'sent' THEN NULL ELSE paid_at END
		 WHERE tenant_id = $1 AND id = $2::uuid`,
		tenantID, id, body.Status); err != nil {
		slog.Error("invoices.UpdateStatus: update failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to update invoice")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"id": id, "status": body.Status})
}

// FromWorkOrder creates a draft invoice for a work order: one line per
// instrument, linked to its latest approved calibration. Body (optional):
// {"unit_price": 85, "tax_rate": 13, "currency": "CAD", "due_days": 30}.
func (h *Handler) FromWorkOrder(w http.ResponseWriter, r *http.Request) {
	if !requireManager(w, r) {
		return
	}
	var body struct {
		UnitPrice float64 `json:"unit_price"`
		TaxRate   float64 `json:"tax_rate"`
		Currency  string  `json:"currency"`
		DueDays   int     `json:"due_days"`
	}
	if r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			httputil.WriteError(w, http.StatusBadRequest, "invalid request body")
			return
		}
	}
	ctx := r.Context()
	tenantID := middleware.TenantIDFromCtx(ctx)
	woID := chi.URLParam(r, "id")

	var title string
	var customerID *string
	if err := h.pool.QueryRow(ctx,
		`SELECT title, customer_id::text FROM work_orders WHERE tenant_id = $1 AND id = $2::uuid`,
		tenantID, woID).Scan(&title, &customerID); err == pgx.ErrNoRows {
		httputil.WriteError(w, http.StatusNotFound, "work order not found")
		return
	} else if err != nil {
		slog.Error("invoices.FromWorkOrder: load failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to load work order")
		return
	}

	var existing string
	if err := h.pool.QueryRow(ctx,
		`SELECT id::text FROM invoices WHERE tenant_id = $1 AND work_order_id = $2::uuid AND status <> 'void' LIMIT 1`,
		tenantID, woID).Scan(&existing); err == nil {
		httputil.WriteJSON(w, http.StatusConflict, map[string]string{"error": "this work order already has an invoice", "id": existing})
		return
	}

	rows, err := h.pool.Query(ctx,
		`SELECT a.id::text, a.tag_id, a.instrument_type::text, a.manufacturer, a.model,
		        (SELECT cr.id::text FROM calibration_records cr
		          WHERE cr.asset_id = a.id AND cr.status = 'approved'
		          ORDER BY cr.performed_at DESC LIMIT 1)
		 FROM work_order_assets woa JOIN assets a ON a.id = woa.asset_id
		 WHERE woa.work_order_id = $1::uuid
		 ORDER BY a.tag_id`, woID)
	if err != nil {
		slog.Error("invoices.FromWorkOrder: assets failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to load work order assets")
		return
	}
	defer rows.Close()
	lines := []Line{}
	for rows.Next() {
		var assetID, tag, itype string
		var mfr, model, recordID *string
		if err := rows.Scan(&assetID, &tag, &itype, &mfr, &model, &recordID); err != nil {
			httputil.WriteError(w, http.StatusInternalServerError, "failed to load work order assets")
			return
		}
		desc := "Calibration — " + tag + " (" + strings.ReplaceAll(itype, "_", " ")
		if make := strings.TrimSpace(deref(mfr) + " " + deref(model)); make != "" {
			desc += ", " + make
		}
		desc += ")"
		a := assetID
		lines = append(lines, Line{Description: desc, Quantity: 1, UnitPrice: body.UnitPrice, AssetID: &a, RecordID: recordID})
	}
	rows.Close()

	in := input{CustomerID: customerID, WorkOrderID: &woID, Currency: body.Currency, TaxRate: body.TaxRate, Lines: lines}
	notes := "Work order: " + title
	in.Notes = &notes
	if body.DueDays > 0 {
		d := time.Now().UTC().AddDate(0, 0, body.DueDays).Format("2006-01-02")
		in.DueDate = &d
	}
	if msg := in.validate(); msg != "" {
		httputil.WriteError(w, http.StatusBadRequest, msg)
		return
	}
	id, err := h.create(ctx, in)
	if err != nil {
		slog.Error("invoices.FromWorkOrder: create failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to create invoice")
		return
	}
	httputil.WriteJSON(w, http.StatusCreated, map[string]string{"id": id})
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func fromAddress() string {
	if v := os.Getenv("RESEND_FROM_EMAIL"); v != "" {
		return v
	}
	return "Probatus <noreply@probatus.app>"
}

// InvoiceEmailHTML renders an invoice as a self-contained HTML email.
func InvoiceEmailHTML(inv *Invoice, tenantName string) string {
	var b strings.Builder
	esc := html.EscapeString
	money := func(v float64) string { return fmt.Sprintf("%s %.2f", inv.Currency, v) }
	fmt.Fprintf(&b, `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:640px">
<h2 style="margin:0 0 4px">Invoice #%d</h2><p style="margin:0 0 16px;color:#555">%s</p>
<p>Issued %s`, inv.Number, esc(tenantName), esc(inv.IssueDate))
	if inv.DueDate != nil {
		fmt.Fprintf(&b, ` · Due %s`, esc(*inv.DueDate))
	}
	if inv.CustomerName != nil {
		fmt.Fprintf(&b, `<br>Bill to: <strong>%s</strong>`, esc(*inv.CustomerName))
	}
	b.WriteString(`</p><table style="width:100%;border-collapse:collapse;font-size:14px">
<tr style="background:#f4f4f4"><th align="left" style="padding:6px">Description</th><th align="right" style="padding:6px">Qty</th><th align="right" style="padding:6px">Unit</th><th align="right" style="padding:6px">Amount</th></tr>`)
	for _, l := range inv.Lines {
		fmt.Fprintf(&b, `<tr><td style="padding:6px;border-bottom:1px solid #eee">%s</td><td align="right" style="padding:6px;border-bottom:1px solid #eee">%g</td><td align="right" style="padding:6px;border-bottom:1px solid #eee">%s</td><td align="right" style="padding:6px;border-bottom:1px solid #eee">%s</td></tr>`,
			esc(l.Description), l.Quantity, money(l.UnitPrice), money(l.Amount))
	}
	fmt.Fprintf(&b, `<tr><td colspan="3" align="right" style="padding:6px">Subtotal</td><td align="right" style="padding:6px">%s</td></tr>
<tr><td colspan="3" align="right" style="padding:6px">Tax (%g%%)</td><td align="right" style="padding:6px">%s</td></tr>
<tr><td colspan="3" align="right" style="padding:6px"><strong>Total</strong></td><td align="right" style="padding:6px"><strong>%s</strong></td></tr></table>`,
		money(inv.Subtotal), inv.TaxRate, money(inv.Tax), money(inv.Total))
	if inv.Notes != nil && *inv.Notes != "" {
		fmt.Fprintf(&b, `<p style="color:#555;white-space:pre-wrap">%s</p>`, esc(*inv.Notes))
	}
	b.WriteString(`</div>`)
	return b.String()
}
