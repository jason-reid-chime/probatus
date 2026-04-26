// Package workorders provides HTTP handlers for the work_orders resource.
//
// Routes (register in main.go):
//
//	GET    /work-orders                  handler.List
//	POST   /work-orders                  handler.Create
//	GET    /work-orders/{id}             handler.Get
//	PUT    /work-orders/{id}             handler.Update
//	DELETE /work-orders/{id}             handler.Delete
//	PATCH  /work-orders/{id}/status      handler.UpdateStatus
package workorders

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jasonreid/probatus/internal/middleware"
)

// querier is the minimal DB interface used by Handler.
// *pgxpool.Pool satisfies this interface.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Handler holds the DB pool for the work_orders resource.
type Handler struct {
	pool querier
}

// NewHandler creates a new work orders Handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

// WorkOrder represents a work_orders row (with optional customer name).
type WorkOrder struct {
	ID            string  `json:"id"`
	TenantID      string  `json:"tenant_id"`
	CustomerID    *string `json:"customer_id"`
	Title         string  `json:"title"`
	Notes         *string `json:"notes"`
	ScheduledDate string  `json:"scheduled_date"`
	Status        string  `json:"status"`
	CreatedBy     *string `json:"created_by"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
	CustomerName  *string `json:"customer_name"`
}

// WorkOrderDetail extends WorkOrder with related assets and technicians.
type WorkOrderDetail struct {
	WorkOrder
	Assets      []WorkOrderAsset      `json:"assets"`
	Technicians []WorkOrderTechnician `json:"technicians"`
}

// WorkOrderAsset is a summarised asset row attached to a work order.
type WorkOrderAsset struct {
	ID             string  `json:"id"`
	TagID          string  `json:"tag_id"`
	InstrumentType string  `json:"instrument_type"`
	SerialNumber   *string `json:"serial_number"`
	Manufacturer   *string `json:"manufacturer"`
	Model          *string `json:"model"`
}

// WorkOrderTechnician is a summarised profile row attached to a work order.
type WorkOrderTechnician struct {
	ID       string `json:"id"`
	FullName string `json:"full_name"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// List returns all work orders for the authenticated tenant ordered by scheduled_date DESC.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())

	rows, err := h.pool.Query(r.Context(),
		`SELECT wo.id::text, wo.tenant_id::text, wo.customer_id::text, wo.title,
		        wo.notes, wo.scheduled_date::text, wo.status, wo.created_by::text,
		        wo.created_at::text, wo.updated_at::text,
		        c.name as customer_name
		 FROM work_orders wo
		 LEFT JOIN customers c ON c.id = wo.customer_id
		 WHERE wo.tenant_id = $1
		 ORDER BY wo.scheduled_date DESC`,
		tenantID,
	)
	if err != nil {
		slog.Error("workorders.List: query failed", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query work orders")
		return
	}
	defer rows.Close()

	orders := []*WorkOrder{}
	for rows.Next() {
		wo := &WorkOrder{}
		if err := rows.Scan(
			&wo.ID, &wo.TenantID, &wo.CustomerID, &wo.Title,
			&wo.Notes, &wo.ScheduledDate, &wo.Status, &wo.CreatedBy,
			&wo.CreatedAt, &wo.UpdatedAt, &wo.CustomerName,
		); err != nil {
			slog.Error("workorders.List: scan failed", "tenant_id", tenantID, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to scan work order")
			return
		}
		orders = append(orders, wo)
	}
	if err := rows.Err(); err != nil {
		slog.Error("workorders.List: iteration error", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "error iterating work orders")
		return
	}

	writeJSON(w, http.StatusOK, orders)
}

// Get returns a single work order including its linked assets and technicians.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	row := h.pool.QueryRow(r.Context(),
		`SELECT wo.id::text, wo.tenant_id::text, wo.customer_id::text, wo.title,
		        wo.notes, wo.scheduled_date::text, wo.status, wo.created_by::text,
		        wo.created_at::text, wo.updated_at::text,
		        c.name as customer_name
		 FROM work_orders wo
		 LEFT JOIN customers c ON c.id = wo.customer_id
		 WHERE wo.tenant_id = $1 AND wo.id = $2`,
		tenantID, id,
	)

	detail := &WorkOrderDetail{}
	err := row.Scan(
		&detail.ID, &detail.TenantID, &detail.CustomerID, &detail.Title,
		&detail.Notes, &detail.ScheduledDate, &detail.Status, &detail.CreatedBy,
		&detail.CreatedAt, &detail.UpdatedAt, &detail.CustomerName,
	)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "work order not found")
		return
	}
	if err != nil {
		slog.Error("workorders.Get: query failed", "work_order_id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query work order")
		return
	}

	// Load linked assets.
	aRows, err := h.pool.Query(r.Context(),
		`SELECT a.id::text, a.tag_id, a.instrument_type, a.serial_number, a.manufacturer, a.model
		 FROM assets a
		 JOIN work_order_assets woa ON woa.asset_id = a.id
		 WHERE woa.work_order_id = $1`,
		id,
	)
	if err != nil {
		slog.Error("workorders.Get: assets query failed", "work_order_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query work order assets")
		return
	}
	defer aRows.Close()

	detail.Assets = []WorkOrderAsset{}
	for aRows.Next() {
		var a WorkOrderAsset
		if err := aRows.Scan(&a.ID, &a.TagID, &a.InstrumentType, &a.SerialNumber, &a.Manufacturer, &a.Model); err != nil {
			slog.Error("workorders.Get: asset scan failed", "work_order_id", id, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to scan asset")
			return
		}
		detail.Assets = append(detail.Assets, a)
	}
	if err := aRows.Err(); err != nil {
		slog.Error("workorders.Get: asset iteration error", "work_order_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "error iterating assets")
		return
	}
	aRows.Close()

	// Load linked technicians.
	tRows, err := h.pool.Query(r.Context(),
		`SELECT p.id::text, p.full_name
		 FROM profiles p
		 JOIN work_order_technicians wot ON wot.technician_id = p.id
		 WHERE wot.work_order_id = $1`,
		id,
	)
	if err != nil {
		slog.Error("workorders.Get: technicians query failed", "work_order_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query work order technicians")
		return
	}
	defer tRows.Close()

	detail.Technicians = []WorkOrderTechnician{}
	for tRows.Next() {
		var t WorkOrderTechnician
		if err := tRows.Scan(&t.ID, &t.FullName); err != nil {
			slog.Error("workorders.Get: technician scan failed", "work_order_id", id, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to scan technician")
			return
		}
		detail.Technicians = append(detail.Technicians, t)
	}
	if err := tRows.Err(); err != nil {
		slog.Error("workorders.Get: technician iteration error", "work_order_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "error iterating technicians")
		return
	}

	writeJSON(w, http.StatusOK, detail)
}

// Create inserts a new work order with its linked assets and technicians.
// Role restricted: supervisor or admin only.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	userID := middleware.UserIDFromCtx(r.Context())
	role := middleware.RoleFromCtx(r.Context())

	if role != "supervisor" && role != "admin" {
		writeError(w, http.StatusForbidden, "only supervisors and admins can create work orders")
		return
	}

	var body struct {
		Title          string   `json:"title"`
		Notes          *string  `json:"notes"`
		ScheduledDate  string   `json:"scheduled_date"`
		Status         string   `json:"status"`
		CustomerID     *string  `json:"customer_id"`
		AssetIDs       []string `json:"asset_ids"`
		TechnicianIDs  []string `json:"technician_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	if body.ScheduledDate == "" {
		writeError(w, http.StatusBadRequest, "scheduled_date is required")
		return
	}
	if body.Status == "" {
		body.Status = "open"
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		slog.Error("workorders.Create: begin transaction failed", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to begin transaction")
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck

	var woID string
	err = tx.QueryRow(r.Context(),
		`INSERT INTO work_orders (tenant_id, customer_id, title, notes, scheduled_date, status, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id::text`,
		tenantID, body.CustomerID, body.Title, body.Notes, body.ScheduledDate, body.Status, userID,
	).Scan(&woID)
	if err != nil {
		slog.Error("workorders.Create: insert failed", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create work order")
		return
	}

	// Link assets.
	for _, assetID := range body.AssetIDs {
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO work_order_assets (work_order_id, asset_id) VALUES ($1, $2)`,
			woID, assetID,
		); err != nil {
			slog.Error("workorders.Create: asset link failed", "work_order_id", woID, "asset_id", assetID, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to link asset")
			return
		}
	}

	// Link technicians.
	for _, techID := range body.TechnicianIDs {
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO work_order_technicians (work_order_id, technician_id) VALUES ($1, $2)`,
			woID, techID,
		); err != nil {
			slog.Error("workorders.Create: technician link failed", "work_order_id", woID, "technician_id", techID, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to link technician")
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		slog.Error("workorders.Create: commit failed", "work_order_id", woID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to commit transaction")
		return
	}

	slog.Info("workorders.Create: work order created", "work_order_id", woID, "tenant_id", tenantID)
	writeJSON(w, http.StatusCreated, map[string]string{"id": woID})
}

// Update modifies an existing work order and optionally replaces its linked assets/technicians.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	var body struct {
		Title         *string  `json:"title"`
		Notes         *string  `json:"notes"`
		ScheduledDate *string  `json:"scheduled_date"`
		Status        *string  `json:"status"`
		CustomerID    *string  `json:"customer_id"`
		AssetIDs      []string `json:"asset_ids"`
		TechnicianIDs []string `json:"technician_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		slog.Error("workorders.Update: begin transaction failed", "work_order_id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to begin transaction")
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck

	tag, err := tx.Exec(r.Context(),
		`UPDATE work_orders
		 SET title          = COALESCE($3, title),
		     notes          = COALESCE($4, notes),
		     scheduled_date = COALESCE($5, scheduled_date),
		     status         = COALESCE($6, status),
		     customer_id    = COALESCE($7, customer_id),
		     updated_at     = now()
		 WHERE id = $1 AND tenant_id = $2`,
		id, tenantID, body.Title, body.Notes, body.ScheduledDate, body.Status, body.CustomerID,
	)
	if err != nil {
		slog.Error("workorders.Update: exec failed", "work_order_id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update work order")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "work order not found")
		return
	}

	// Replace assets if provided.
	if body.AssetIDs != nil {
		if _, err := tx.Exec(r.Context(),
			`DELETE FROM work_order_assets WHERE work_order_id = $1`, id,
		); err != nil {
			slog.Error("workorders.Update: delete assets failed", "work_order_id", id, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to replace assets")
			return
		}
		for _, assetID := range body.AssetIDs {
			if _, err := tx.Exec(r.Context(),
				`INSERT INTO work_order_assets (work_order_id, asset_id) VALUES ($1, $2)`,
				id, assetID,
			); err != nil {
				slog.Error("workorders.Update: asset link failed", "work_order_id", id, "asset_id", assetID, "error", err)
				writeError(w, http.StatusInternalServerError, "failed to link asset")
				return
			}
		}
	}

	// Replace technicians if provided.
	if body.TechnicianIDs != nil {
		if _, err := tx.Exec(r.Context(),
			`DELETE FROM work_order_technicians WHERE work_order_id = $1`, id,
		); err != nil {
			slog.Error("workorders.Update: delete technicians failed", "work_order_id", id, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to replace technicians")
			return
		}
		for _, techID := range body.TechnicianIDs {
			if _, err := tx.Exec(r.Context(),
				`INSERT INTO work_order_technicians (work_order_id, technician_id) VALUES ($1, $2)`,
				id, techID,
			); err != nil {
				slog.Error("workorders.Update: technician link failed", "work_order_id", id, "technician_id", techID, "error", err)
				writeError(w, http.StatusInternalServerError, "failed to link technician")
				return
			}
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		slog.Error("workorders.Update: commit failed", "work_order_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to commit transaction")
		return
	}

	slog.Info("workorders.Update: work order updated", "work_order_id", id, "tenant_id", tenantID)
	writeJSON(w, http.StatusOK, map[string]bool{"updated": true})
}

// Delete removes a work order. CASCADE handles work_order_assets and work_order_technicians.
// Role restricted: supervisor or admin only.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	role := middleware.RoleFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	if role != "supervisor" && role != "admin" {
		writeError(w, http.StatusForbidden, "only supervisors and admins can delete work orders")
		return
	}

	tag, err := h.pool.Exec(r.Context(),
		`DELETE FROM work_orders WHERE id = $1 AND tenant_id = $2`,
		id, tenantID,
	)
	if err != nil {
		slog.Error("workorders.Delete: exec failed", "work_order_id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to delete work order")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "work order not found")
		return
	}

	slog.Info("workorders.Delete: work order deleted", "work_order_id", id, "tenant_id", tenantID)
	w.WriteHeader(http.StatusNoContent)
}

// UpdateStatus sets the status of a work order.
// No role restriction — technicians can update status too.
func (h *Handler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	validStatuses := map[string]bool{
		"open":        true,
		"in_progress": true,
		"completed":   true,
		"cancelled":   true,
	}
	if !validStatuses[body.Status] {
		writeError(w, http.StatusBadRequest, "status must be one of: open, in_progress, completed, cancelled")
		return
	}

	tag, err := h.pool.Exec(r.Context(),
		`UPDATE work_orders SET status = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3`,
		body.Status, id, tenantID,
	)
	if err != nil {
		slog.Error("workorders.UpdateStatus: exec failed", "work_order_id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update work order status")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "work order not found")
		return
	}

	slog.Info("workorders.UpdateStatus: status updated", "work_order_id", id, "status", body.Status, "tenant_id", tenantID)
	writeJSON(w, http.StatusOK, map[string]bool{"updated": true})
}
