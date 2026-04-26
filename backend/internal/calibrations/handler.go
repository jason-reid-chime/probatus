package calibrations

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jasonreid/probatus/internal/email"
	"github.com/jasonreid/probatus/internal/middleware"
)

// querier is the minimal DB interface used by Handler. *pgxpool.Pool satisfies this.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Handler holds the DB pool for the calibrations resource.
type Handler struct {
	pool querier
}

// NewHandler creates a new calibrations Handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

// CalibrationRecord represents a calibration_records row.
type CalibrationRecord struct {
	ID                 string       `json:"id"`
	TenantID           string       `json:"tenant_id"`
	AssetID            string       `json:"asset_id"`
	TechnicianID       string       `json:"technician_id"`
	SupervisorID       *string      `json:"supervisor_id,omitempty"`
	Status             string       `json:"status"`
	PerformedAt        time.Time    `json:"performed_at"`
	ApprovedAt         *time.Time   `json:"approved_at,omitempty"`
	SalesNumber        string       `json:"sales_number"`
	FlagNumber         string       `json:"flag_number"`
	TechSignature      string       `json:"tech_signature"`
	SupervisorSig      string       `json:"supervisor_signature"`
	CertificateURL     string       `json:"certificate_url"`
	Notes              string       `json:"notes"`
	LocalID            string       `json:"local_id"`
	Measurements       []Measurement `json:"measurements,omitempty"`
}

// Measurement represents a calibration_measurements row.
type Measurement struct {
	ID           string   `json:"id"`
	RecordID     string   `json:"record_id"`
	PointLabel   string   `json:"point_label"`
	StandardValue float64 `json:"standard_value"`
	MeasuredValue float64 `json:"measured_value"`
	Unit         string   `json:"unit"`
	Pass         bool     `json:"pass"`
	ErrorPct     float64  `json:"error_pct"`
	Notes        string   `json:"notes"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// checkStandardsDueDate validates that none of the provided standard IDs have a due_at in the past.
// Returns an error message if any standard is expired, otherwise returns "".
func (h *Handler) checkStandardsDueDate(r *http.Request, tenantID string, standardIDs []string) string {
	if len(standardIDs) == 0 {
		return ""
	}

	today := time.Now().UTC().Truncate(24 * time.Hour)

	rows, err := h.pool.Query(r.Context(),
		`SELECT name, due_at FROM master_standards
		 WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
		standardIDs, tenantID,
	)
	if err != nil {
		slog.Error("checkStandardsDueDate: query failed", "tenant_id", tenantID, "error", err)
		return "failed to validate standards"
	}
	defer rows.Close()

	for rows.Next() {
		var name string
		var dueAt time.Time
		if err := rows.Scan(&name, &dueAt); err != nil {
			slog.Error("checkStandardsDueDate: scan failed", "tenant_id", tenantID, "error", err)
			return "failed to validate standards"
		}
		if dueAt.Before(today) {
			return fmt.Sprintf("Standard %s is past its calibration due date.", name)
		}
	}
	return ""
}

// List returns calibration records for the authenticated tenant with optional filters.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	assetID := r.URL.Query().Get("asset_id")
	status := r.URL.Query().Get("status")

	query := `SELECT id::text, tenant_id::text, asset_id::text, technician_id::text,
	                 supervisor_id::text, status, performed_at, approved_at,
	                 sales_number, flag_number, tech_signature, supervisor_signature,
	                 certificate_url, notes, local_id
	          FROM calibration_records
	          WHERE tenant_id = $1`
	args := []any{tenantID}

	if assetID != "" {
		args = append(args, assetID)
		query += fmt.Sprintf(" AND asset_id = $%d", len(args))
	}
	if status != "" {
		args = append(args, status)
		query += fmt.Sprintf(" AND status = $%d", len(args))
	}
	query += " ORDER BY performed_at DESC"

	rows, err := h.pool.Query(r.Context(), query, args...)
	if err != nil {
		slog.Error("calibrations.List: query failed", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query calibrations")
		return
	}
	defer rows.Close()

	records := []*CalibrationRecord{}
	for rows.Next() {
		rec := &CalibrationRecord{}
		err := rows.Scan(
			&rec.ID, &rec.TenantID, &rec.AssetID, &rec.TechnicianID,
			&rec.SupervisorID, &rec.Status, &rec.PerformedAt, &rec.ApprovedAt,
			&rec.SalesNumber, &rec.FlagNumber, &rec.TechSignature, &rec.SupervisorSig,
			&rec.CertificateURL, &rec.Notes, &rec.LocalID,
		)
		if err != nil {
			slog.Error("calibrations.List: scan failed", "tenant_id", tenantID, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to scan calibration")
			return
		}
		records = append(records, rec)
	}
	if err := rows.Err(); err != nil {
		slog.Error("calibrations.List: iteration error", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "error iterating calibrations")
		return
	}

	writeJSON(w, http.StatusOK, records)
}

// Get returns a single calibration record including its measurements.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	row := h.pool.QueryRow(r.Context(),
		`SELECT id::text, tenant_id::text, asset_id::text, technician_id::text,
		        supervisor_id::text, status, performed_at, approved_at,
		        sales_number, flag_number, tech_signature, supervisor_signature,
		        certificate_url, notes, local_id
		 FROM calibration_records
		 WHERE id = $1 AND tenant_id = $2`,
		id, tenantID,
	)

	rec := &CalibrationRecord{}
	err := row.Scan(
		&rec.ID, &rec.TenantID, &rec.AssetID, &rec.TechnicianID,
		&rec.SupervisorID, &rec.Status, &rec.PerformedAt, &rec.ApprovedAt,
		&rec.SalesNumber, &rec.FlagNumber, &rec.TechSignature, &rec.SupervisorSig,
		&rec.CertificateURL, &rec.Notes, &rec.LocalID,
	)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "calibration not found")
		return
	}
	if err != nil {
		slog.Error("calibrations.Get: query failed", "record_id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query calibration")
		return
	}

	// Load measurements.
	mRows, err := h.pool.Query(r.Context(),
		`SELECT id::text, record_id::text, point_label, standard_value, measured_value,
		        unit, pass, error_pct, notes
		 FROM calibration_measurements
		 WHERE record_id = $1
		 ORDER BY id`,
		id,
	)
	if err != nil {
		slog.Error("calibrations.Get: measurements query failed", "record_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query measurements")
		return
	}
	defer mRows.Close()

	rec.Measurements = []Measurement{}
	for mRows.Next() {
		var m Measurement
		if err := mRows.Scan(&m.ID, &m.RecordID, &m.PointLabel, &m.StandardValue,
			&m.MeasuredValue, &m.Unit, &m.Pass, &m.ErrorPct, &m.Notes); err != nil {
			slog.Error("calibrations.Get: measurement scan failed", "record_id", id, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to scan measurement")
			return
		}
		rec.Measurements = append(rec.Measurements, m)
	}
	if err := mRows.Err(); err != nil {
		slog.Error("calibrations.Get: measurement iteration error", "record_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "error iterating measurements")
		return
	}

	writeJSON(w, http.StatusOK, rec)
}

// Create inserts a new calibration record and its measurements.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	userID := middleware.UserIDFromCtx(r.Context())

	var body struct {
		ID           string `json:"id"`             // optional client-generated UUID for offline-first sync
		AssetID      string `json:"asset_id"`
		PerformedAt  string `json:"performed_at"`
		SalesNumber  string `json:"sales_number"`
		FlagNumber   string `json:"flag_number"`
		TechSignature string `json:"tech_signature"`
		Notes        string `json:"notes"`
		LocalID      string `json:"local_id"`
		StandardIDs  []string `json:"standard_ids"`
		Measurements []struct {
			PointLabel    string  `json:"point_label"`
			StandardValue float64 `json:"standard_value"`
			MeasuredValue float64 `json:"measured_value"`
			Unit          string  `json:"unit"`
			Pass          bool    `json:"pass"`
			ErrorPct      float64 `json:"error_pct"`
			Notes         string  `json:"notes"`
		} `json:"measurements"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate standards due dates.
	if errMsg := h.checkStandardsDueDate(r, tenantID, body.StandardIDs); errMsg != "" {
		writeError(w, http.StatusUnprocessableEntity, errMsg)
		return
	}

	var performedAt time.Time
	if body.PerformedAt != "" {
		var err error
		// Accept both RFC3339 (no fractional seconds) and RFC3339Nano (with fractional
		// seconds) — JS clients send ISO strings like "2024-01-01T00:00:00.000Z".
		performedAt, err = time.Parse(time.RFC3339Nano, body.PerformedAt)
		if err != nil {
			performedAt, err = time.Parse(time.RFC3339, body.PerformedAt)
			if err != nil {
				writeError(w, http.StatusBadRequest, "invalid performed_at format, use RFC3339")
				return
			}
		}
	} else {
		performedAt = time.Now().UTC()
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		slog.Error("calibrations.Create: begin transaction failed", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to begin transaction")
		return
	}
	defer tx.Rollback(r.Context())

	// If the client provided a UUID (offline-first), use it so the local Dexie
	// record and the server record share the same ID. ON CONFLICT DO NOTHING makes
	// this idempotent — safe to retry from the outbox.
	var recID string
	if body.ID != "" {
		err = tx.QueryRow(r.Context(),
			`INSERT INTO calibration_records
				(id, tenant_id, asset_id, technician_id, status, performed_at,
				 sales_number, flag_number, tech_signature, notes, local_id)
			 VALUES ($1::uuid,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10)
			 ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
			 RETURNING id::text`,
			body.ID, tenantID, body.AssetID, userID, performedAt,
			body.SalesNumber, body.FlagNumber, body.TechSignature, body.Notes, body.LocalID,
		).Scan(&recID)
	} else {
		err = tx.QueryRow(r.Context(),
			`INSERT INTO calibration_records
				(tenant_id, asset_id, technician_id, status, performed_at,
				 sales_number, flag_number, tech_signature, notes, local_id)
			 VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9)
			 RETURNING id::text`,
			tenantID, body.AssetID, userID, performedAt,
			body.SalesNumber, body.FlagNumber, body.TechSignature, body.Notes, body.LocalID,
		).Scan(&recID)
	}
	if err != nil {
		slog.Error("calibrations.Create: insert failed", "tenant_id", tenantID, "asset_id", body.AssetID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create calibration record")
		return
	}

	// Insert measurements.
	for _, m := range body.Measurements {
		_, err := tx.Exec(r.Context(),
			`INSERT INTO calibration_measurements
				(record_id, point_label, standard_value, measured_value, unit, pass, error_pct, notes)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			recID, m.PointLabel, m.StandardValue, m.MeasuredValue, m.Unit, m.Pass, m.ErrorPct, m.Notes,
		)
		if err != nil {
			slog.Error("calibrations.Create: measurement insert failed", "record_id", recID, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to insert measurement")
			return
		}
	}

	// Link standards used.
	for _, stdID := range body.StandardIDs {
		_, err := tx.Exec(r.Context(),
			`INSERT INTO calibration_standards_used (record_id, standard_id) VALUES ($1,$2)`,
			recID, stdID,
		)
		if err != nil {
			slog.Error("calibrations.Create: standard link failed", "record_id", recID, "standard_id", stdID, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to link standard")
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		slog.Error("calibrations.Create: commit failed", "record_id", recID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to commit transaction")
		return
	}

	slog.Info("calibrations.Create: record created", "record_id", recID, "tenant_id", tenantID, "asset_id", body.AssetID)

	// Return the created record.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"id": recID})
}

// Update modifies an existing calibration record (status, signatures, etc.).
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	var body struct {
		Status        string   `json:"status"`
		TechSignature string   `json:"tech_signature"`
		SalesNumber   string   `json:"sales_number"`
		FlagNumber    string   `json:"flag_number"`
		Notes         string   `json:"notes"`
		LocalID       string   `json:"local_id"`
		StandardIDs   []string `json:"standard_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate standards due dates.
	if errMsg := h.checkStandardsDueDate(r, tenantID, body.StandardIDs); errMsg != "" {
		writeError(w, http.StatusUnprocessableEntity, errMsg)
		return
	}

	tag, err := h.pool.Exec(r.Context(),
		`UPDATE calibration_records
		 SET status = COALESCE(NULLIF($3,''), status),
		     tech_signature = COALESCE(NULLIF($4,''), tech_signature),
		     sales_number = COALESCE(NULLIF($5,''), sales_number),
		     flag_number = COALESCE(NULLIF($6,''), flag_number),
		     notes = COALESCE(NULLIF($7,''), notes),
		     local_id = COALESCE(NULLIF($8,''), local_id)
		 WHERE id = $1 AND tenant_id = $2`,
		id, tenantID, body.Status, body.TechSignature,
		body.SalesNumber, body.FlagNumber, body.Notes, body.LocalID,
	)
	if err != nil {
		slog.Error("calibrations.Update: exec failed", "record_id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update calibration")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "calibration not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"id": id})
}

// Approve sets a calibration's status to "approved" and records the supervisor.
func (h *Handler) Approve(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	userID := middleware.UserIDFromCtx(r.Context())
	role := middleware.RoleFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	if role != "supervisor" && role != "admin" {
		writeError(w, http.StatusForbidden, "only supervisors and admins can approve calibrations")
		return
	}

	var body struct {
		SupervisorSignature string `json:"supervisor_signature"`
	}
	// Body is optional — supervisor_signature may be omitted. Reject only
	// clearly malformed JSON; an empty body (io.EOF) is fine.
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	now := time.Now().UTC()

	// Approve the record and get the asset_id + performed_at back so we can
	// update the asset's calibration dates in the same transaction.
	var assetID string
	var performedAt time.Time
	err := h.pool.QueryRow(r.Context(),
		`UPDATE calibration_records
		 SET status = 'approved',
		     supervisor_id = $3,
		     approved_at = $4,
		     supervisor_signature = COALESCE(NULLIF($5,''), supervisor_signature)
		 WHERE id = $1 AND tenant_id = $2 AND status = 'pending_approval'
		 RETURNING asset_id::text, performed_at`,
		id, tenantID, userID, now, body.SupervisorSignature,
	).Scan(&assetID, &performedAt)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "calibration not found or not pending approval")
		return
	}
	if err != nil {
		slog.Error("calibrations.Approve: exec failed", "record_id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to approve calibration")
		return
	}

	// Update asset's last_calibrated_at and next_due_at based on calibration_interval_days.
	if _, err := h.pool.Exec(r.Context(),
		`UPDATE assets
		 SET last_calibrated_at = $2,
		     next_due_at = $2::date + (calibration_interval_days || ' days')::interval
		 WHERE id = $1
		   AND (last_calibrated_at IS NULL OR last_calibrated_at <= $2)`,
		assetID, performedAt,
	); err != nil {
		slog.Error("calibrations.Approve: failed to update asset dates", "asset_id", assetID, "error", err)
		// Non-fatal — approval succeeded; dates will be stale until next approval.
	}

	slog.Info("calibrations.Approve: record approved", "record_id", id, "tenant_id", tenantID, "supervisor_id", userID)

	// Fire off the certificate email in the background so the HTTP response is
	// never delayed or failed due to email delivery issues.
	go sendCertificateEmail(h.pool, r.Context(), id, tenantID)

	writeJSON(w, http.StatusOK, map[string]string{"id": id, "status": "approved"})
}

// Reject sets a calibration's status to "rejected" and records the reason.
func (h *Handler) Reject(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	role := middleware.RoleFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	if role != "supervisor" && role != "admin" {
		writeError(w, http.StatusForbidden, "only supervisors and admins can reject calibrations")
		return
	}

	var body struct {
		RejectionReason string `json:"rejection_reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	row := h.pool.QueryRow(r.Context(),
		`UPDATE calibration_records
		 SET status = 'rejected', rejection_reason = $1, updated_at = now()
		 WHERE id = $2 AND tenant_id = $3
		 RETURNING id::text, tenant_id::text, asset_id::text, technician_id::text,
		           supervisor_id::text, status, performed_at, approved_at,
		           sales_number, flag_number, tech_signature, supervisor_signature,
		           certificate_url, notes, local_id`,
		body.RejectionReason, id, tenantID,
	)

	rec := &CalibrationRecord{}
	err := row.Scan(
		&rec.ID, &rec.TenantID, &rec.AssetID, &rec.TechnicianID,
		&rec.SupervisorID, &rec.Status, &rec.PerformedAt, &rec.ApprovedAt,
		&rec.SalesNumber, &rec.FlagNumber, &rec.TechSignature, &rec.SupervisorSig,
		&rec.CertificateURL, &rec.Notes, &rec.LocalID,
	)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "calibration not found")
		return
	}
	if err != nil {
		slog.Error("calibrations.Reject: exec failed", "record_id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to reject calibration")
		return
	}

	slog.Info("calibrations.Reject: record rejected", "record_id", id, "tenant_id", tenantID)
	writeJSON(w, http.StatusOK, rec)
}

// Reopen sets a rejected calibration back to "in_progress" for rework.
func (h *Handler) Reopen(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	tag, err := h.pool.Exec(r.Context(),
		`UPDATE calibration_records
		 SET status = 'in_progress', rejection_reason = NULL, updated_at = now()
		 WHERE id = $1 AND tenant_id = $2`,
		id, tenantID,
	)
	if err != nil {
		slog.Error("calibrations.Reopen: exec failed", "record_id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to reopen calibration")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "calibration not found")
		return
	}

	slog.Info("calibrations.Reopen: record reopened", "record_id", id, "tenant_id", tenantID)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Delete removes a calibration record (ON DELETE CASCADE handles child rows).
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	role := middleware.RoleFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	if role != "supervisor" && role != "admin" {
		writeError(w, http.StatusForbidden, "only supervisors and admins can delete calibrations")
		return
	}

	tag, err := h.pool.Exec(r.Context(),
		`DELETE FROM calibration_records WHERE id = $1 AND tenant_id = $2`,
		id, tenantID,
	)
	if err != nil {
		slog.Error("calibrations.Delete: exec failed", "record_id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to delete calibration")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "calibration not found")
		return
	}

	slog.Info("calibrations.Delete: record deleted", "record_id", id, "tenant_id", tenantID)
	w.WriteHeader(http.StatusNoContent)
}

// BulkApprove approves multiple calibrations that are in pending_approval status.
func (h *Handler) BulkApprove(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	userID := middleware.UserIDFromCtx(r.Context())
	role := middleware.RoleFromCtx(r.Context())

	if role != "supervisor" && role != "admin" {
		writeError(w, http.StatusForbidden, "only supervisors and admins can bulk approve calibrations")
		return
	}

	var body struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(body.IDs) == 0 {
		writeJSON(w, http.StatusOK, map[string]int{"approved": 0})
		return
	}

	tag, err := h.pool.Exec(r.Context(),
		`UPDATE calibration_records
		 SET status = 'approved', approved_at = now(), supervisor_id = $1, updated_at = now()
		 WHERE id = ANY($2::uuid[]) AND tenant_id = $3 AND status = 'pending_approval'`,
		userID, body.IDs, tenantID,
	)
	if err != nil {
		slog.Error("calibrations.BulkApprove: exec failed", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to bulk approve calibrations")
		return
	}

	n := int(tag.RowsAffected())
	slog.Info("calibrations.BulkApprove: records approved", "count", n, "tenant_id", tenantID, "supervisor_id", userID)
	writeJSON(w, http.StatusOK, map[string]int{"approved": n})
}

// BulkDelete removes multiple calibration records.
func (h *Handler) BulkDelete(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	role := middleware.RoleFromCtx(r.Context())

	if role != "supervisor" && role != "admin" {
		writeError(w, http.StatusForbidden, "only supervisors and admins can bulk delete calibrations")
		return
	}

	var body struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(body.IDs) == 0 {
		writeJSON(w, http.StatusOK, map[string]int{"deleted": 0})
		return
	}

	tag, err := h.pool.Exec(r.Context(),
		`DELETE FROM calibration_records WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
		body.IDs, tenantID,
	)
	if err != nil {
		slog.Error("calibrations.BulkDelete: exec failed", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to bulk delete calibrations")
		return
	}

	n := int(tag.RowsAffected())
	slog.Info("calibrations.BulkDelete: records deleted", "count", n, "tenant_id", tenantID)
	writeJSON(w, http.StatusOK, map[string]int{"deleted": n})
}

func sendCertificateEmail(pool querier, ctx context.Context, recordID, tenantID string) {
	// Use a detached context so the goroutine is not cancelled when the HTTP
	// handler's context is done.
	ctx = context.Background()

	// -------------------------------------------------------------------------
	// 1. Load calibration record.
	// -------------------------------------------------------------------------
	var rec struct {
		localID        string
		performedAt    time.Time
		technicianID   string
		supervisorID   string
		assetID        string
		techSignature  string
		supervisorSig  string
		salesNumber    string
		flagNumber     string
		notes          string
	}
	err := pool.QueryRow(ctx,
		`SELECT COALESCE(local_id,''), performed_at, technician_id::text,
		        COALESCE(supervisor_id::text,''), asset_id::text,
		        COALESCE(tech_signature,''), COALESCE(supervisor_signature,''),
		        COALESCE(sales_number,''), COALESCE(flag_number,''), COALESCE(notes,'')
		 FROM calibration_records
		 WHERE id = $1 AND tenant_id = $2`,
		recordID, tenantID,
	).Scan(
		&rec.localID, &rec.performedAt, &rec.technicianID, &rec.supervisorID, &rec.assetID,
		&rec.techSignature, &rec.supervisorSig, &rec.salesNumber, &rec.flagNumber, &rec.notes,
	)
	if err != nil {
		slog.Error("sendCertificateEmail: failed to load record", "record_id", recordID, "error", err)
		return
	}

	// -------------------------------------------------------------------------
	// 2. Load asset + customer contact.
	// -------------------------------------------------------------------------
	var asset struct {
		tagID          string
		serialNumber   string
		manufacturer   string
		model          string
		instrumentType string
		location       string
		rangeMin       *float64
		rangeMax       *float64
		rangeUnit      string
	}
	var customerName, customerContact string
	var tenantName string

	err = pool.QueryRow(ctx,
		`SELECT a.tag_id, COALESCE(a.serial_number,''), COALESCE(a.manufacturer,''), COALESCE(a.model,''),
		        a.instrument_type, COALESCE(a.location,''), a.range_min, a.range_max, COALESCE(a.range_unit,''),
		        COALESCE(c.name,''), COALESCE(c.contact,'')
		 FROM assets a
		 LEFT JOIN customers c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
		 WHERE a.id = $1 AND a.tenant_id = $2`,
		rec.assetID, tenantID,
	).Scan(
		&asset.tagID, &asset.serialNumber, &asset.manufacturer, &asset.model,
		&asset.instrumentType, &asset.location, &asset.rangeMin, &asset.rangeMax, &asset.rangeUnit,
		&customerName, &customerContact,
	)
	if err != nil {
		slog.Error("sendCertificateEmail: failed to load asset/customer", "record_id", recordID, "error", err)
		return
	}

	// Validate the contact email before doing any further work.
	customerContact = strings.TrimSpace(customerContact)
	if customerContact == "" || !strings.Contains(customerContact, "@") {
		slog.Info("sendCertificateEmail: skipping — no valid customer contact email",
			"record_id", recordID, "asset_tag", asset.tagID)
		return
	}

	// -------------------------------------------------------------------------
	// 3. Load tenant name (for the email footer).
	// -------------------------------------------------------------------------
	pool.QueryRow(ctx,
		`SELECT name FROM tenants WHERE id = $1`,
		tenantID,
	).Scan(&tenantName)
	if tenantName == "" {
		tenantName = "your calibration laboratory"
	}

	// -------------------------------------------------------------------------
	// 4. Load technician and supervisor names.
	// -------------------------------------------------------------------------
	var techName, supervisorName string
	pool.QueryRow(ctx,
		`SELECT full_name FROM profiles WHERE id = $1`,
		rec.technicianID,
	).Scan(&techName)
	if rec.supervisorID != "" {
		pool.QueryRow(ctx,
			`SELECT full_name FROM profiles WHERE id = $1`,
			rec.supervisorID,
		).Scan(&supervisorName)
	}

	// -------------------------------------------------------------------------
	// 5. Load measurements.
	// -------------------------------------------------------------------------
	mRows, err := pool.Query(ctx,
		`SELECT point_label,
		        COALESCE(standard_value, 0), COALESCE(measured_value, 0),
		        COALESCE(unit,''), COALESCE(error_pct, 0),
		        COALESCE(pass, false), COALESCE(notes,'')
		 FROM calibration_measurements WHERE record_id = $1 ORDER BY id`,
		recordID,
	)
	if err != nil {
		slog.Error("sendCertificateEmail: failed to load measurements", "record_id", recordID, "error", err)
		return
	}
	var measurements []certMeasRow
	overallPass := true
	for mRows.Next() {
		var m certMeasRow
		if err := mRows.Scan(&m.PointLabel, &m.StandardValue, &m.MeasuredValue,
			&m.Unit, &m.ErrorPct, &m.Pass, &m.Notes); err != nil {
			mRows.Close()
			slog.Error("sendCertificateEmail: failed to scan measurement", "record_id", recordID, "error", err)
			return
		}
		if !m.Pass {
			overallPass = false
		}
		measurements = append(measurements, m)
	}
	mRows.Close()

	overallResult := "PASS"
	if !overallPass {
		overallResult = "FAIL"
	}

	// -------------------------------------------------------------------------
	// 6. Load standards used.
	// -------------------------------------------------------------------------
	sRows, err := pool.Query(ctx,
		`SELECT ms.name, ms.serial_number, COALESCE(ms.model,''), COALESCE(ms.manufacturer,''),
		        COALESCE(ms.certificate_ref,''), ms.due_at
		 FROM calibration_standards_used csu
		 JOIN master_standards ms ON ms.id = csu.standard_id
		 WHERE csu.record_id = $1`,
		recordID,
	)
	if err != nil {
		slog.Error("sendCertificateEmail: failed to load standards", "record_id", recordID, "error", err)
		return
	}
	var standards []certStdRow
	for sRows.Next() {
		var s certStdRow
		if err := sRows.Scan(&s.Name, &s.SerialNumber, &s.Model, &s.Manufacturer,
			&s.CertificateRef, &s.DueAt); err != nil {
			sRows.Close()
			slog.Error("sendCertificateEmail: failed to scan standard", "record_id", recordID, "error", err)
			return
		}
		standards = append(standards, s)
	}
	sRows.Close()

	// -------------------------------------------------------------------------
	// 7. Render the certificate and generate a PDF.
	// -------------------------------------------------------------------------
	approvedNow := time.Now().UTC()
	certParams := buildCertHTMLParams{
		recordID:       recordID,
		localID:        rec.localID,
		tenantName:     tenantName,
		customerName:   customerName,
		salesNumber:    rec.salesNumber,
		flagNumber:     rec.flagNumber,
		performedAt:    rec.performedAt,
		approvedAt:     &approvedNow,
		status:         "approved",
		notes:          rec.notes,
		techName:       techName,
		techSignature:  rec.techSignature,
		supervisorName: supervisorName,
		supervisorSig:  rec.supervisorSig,
		assetTag:       asset.tagID,
		serialNumber:   asset.serialNumber,
		manufacturer:   asset.manufacturer,
		model:          asset.model,
		instrumentType: asset.instrumentType,
		location:       asset.location,
		rangeMin:       asset.rangeMin,
		rangeMax:       asset.rangeMax,
		rangeUnit:      asset.rangeUnit,
		measurements:   measurements,
		standards:      standards,
	}
	htmlBody := buildCertHTML(certParams)

	pdfBytes, err := generatePDF(ctx, htmlBody, certParams)
	if err != nil {
		slog.Error("sendCertificateEmail: failed to generate PDF", "record_id", recordID, "error", err)
		return
	}

	// -------------------------------------------------------------------------
	// 8. Build and send the email.
	// -------------------------------------------------------------------------
	certShortID := recordID
	if len(certShortID) > 8 {
		certShortID = certShortID[:8]
	}
	assetDescription := fmt.Sprintf("%s %s", asset.manufacturer, asset.model)

	htmlEmail := email.CertificateEmailHTML(email.CertificateEmailParams{
		CustomerName:     customerName,
		AssetTagID:       asset.tagID,
		AssetDescription: assetDescription,
		PerformedAt:      rec.performedAt.Format("2006-01-02"),
		TechnicianName:   techName,
		OverallResult:    overallResult,
		CertificateID:    certShortID,
		TenantName:       tenantName,
	})

	pdfFilename := fmt.Sprintf("certificate-%s.pdf", rec.localID)

	fromEmail := os.Getenv("RESEND_FROM_EMAIL")
	if fromEmail == "" {
		fromEmail = "onboarding@resend.dev"
	}
	payload := email.EmailPayload{
		From:    fromEmail,
		To:      []string{customerContact},
		Subject: fmt.Sprintf("Calibration Certificate — %s (%s)", asset.tagID, rec.performedAt.Format("2006-01-02")),
		Html:    htmlEmail,
		Attachments: []email.Attachment{
			{
				Filename: pdfFilename,
				Content:  base64.StdEncoding.EncodeToString(pdfBytes),
			},
		},
	}

	if err := email.Send(payload); err != nil {
		slog.Error("sendCertificateEmail: failed to send email",
			"record_id", recordID, "customer_email", customerContact, "error", err)
		return
	}

	slog.Info("sendCertificateEmail: certificate emailed successfully",
		"record_id", recordID, "customer_email", customerContact, "asset_tag", asset.tagID)
}

// generatePDF attempts to render a PDF via Gotenberg if GOTENBERG_URL is set
// and reachable. If Gotenberg is unavailable the function falls back to a
// pure-Go minimal PDF so that certificate emails are never blocked by the
// absence of the Gotenberg sidecar (e.g. on Railway where only the API
// container runs).
func generatePDF(ctx context.Context, htmlContent string, p buildCertHTMLParams) ([]byte, error) {
	gotenbergURL := os.Getenv("GOTENBERG_URL")
	if gotenbergURL != "" {
		pdfBytes, err := callGotenberg(ctx, gotenbergURL, htmlContent)
		if err == nil {
			return pdfBytes, nil
		}
		slog.Warn("generatePDF: Gotenberg unavailable, falling back to built-in PDF",
			"gotenberg_url", gotenbergURL, "error", err)
	}
	return buildMinimalPDF(p), nil
}

// callGotenberg posts the rendered HTML to Gotenberg and returns the PDF bytes.
func callGotenberg(ctx context.Context, gotenbergURL, htmlContent string) ([]byte, error) {
	endpoint := gotenbergURL + "/forms/chromium/convert/html"

	var buf bytes.Buffer
	mpw := multipart.NewWriter(&buf)

	filePart, err := mpw.CreateFormFile("files", "index.html")
	if err != nil {
		return nil, fmt.Errorf("gotenberg: failed to create form file: %w", err)
	}
	if _, err := filePart.Write([]byte(htmlContent)); err != nil {
		return nil, fmt.Errorf("gotenberg: failed to write HTML: %w", err)
	}
	mpw.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(buf.Bytes()))
	if err != nil {
		return nil, fmt.Errorf("gotenberg: failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", mpw.FormDataContentType())

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gotenberg: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gotenberg: returned status %d", resp.StatusCode)
	}

	var pdfBuf bytes.Buffer
	if _, err := pdfBuf.ReadFrom(resp.Body); err != nil {
		return nil, fmt.Errorf("gotenberg: failed to read response body: %w", err)
	}
	return pdfBuf.Bytes(), nil
}

// buildMinimalPDF produces a valid, human-readable PDF-1.4 document from the
// certificate parameters without any external dependencies. The output is a
// single-page A4 document with a monospaced text layout. It is intentionally
// simple — the Gotenberg path produces a nicer result, but this ensures email
// delivery always succeeds even when Gotenberg is not deployed.
func buildMinimalPDF(p buildCertHTMLParams) []byte {
	lines := buildCertTextLines(p)

	// Encode each line as a PDF string literal, escaping special chars.
	escapePDF := func(s string) string {
		s = strings.ReplaceAll(s, `\`, `\\`)
		s = strings.ReplaceAll(s, `(`, `\(`)
		s = strings.ReplaceAll(s, `)`, `\)`)
		return s
	}

	// Build the content stream: position text at top-left with 12pt Courier.
	const (
		fontSize  = 10.0
		leading   = 14.0
		marginL   = 50.0
		pageH     = 841.89 // A4 height in points
		startY    = 800.0
	)

	var cs strings.Builder
	cs.WriteString("BT\n")
	cs.WriteString("/F1 10 Tf\n")
	y := startY
	for _, line := range lines {
		fmt.Fprintf(&cs, "%.2f %.2f Td\n", marginL, y)
		fmt.Fprintf(&cs, "(%s) Tj\n", escapePDF(line))
		y -= leading
		// Reset X each line by going back to marginL from current position.
		// Use absolute positioning instead: move to fixed X each line.
		if y < 50 {
			break // stop before running off the bottom
		}
		// Reset Td to absolute by undoing the cumulative offset each iteration.
		// Simpler: use Tm (text matrix) for each line.
		_ = pageH
	}
	cs.WriteString("ET\n")

	// Re-render using Tm for reliable absolute positioning.
	var cs2 strings.Builder
	cs2.WriteString("BT\n")
	cs2.WriteString("/F1 10 Tf\n")
	y = startY
	for _, line := range lines {
		fmt.Fprintf(&cs2, "1 0 0 1 %.2f %.2f Tm\n", marginL, y)
		fmt.Fprintf(&cs2, "(%s) Tj\n", escapePDF(line))
		y -= leading
		if y < 50 {
			break
		}
	}
	cs2.WriteString("ET\n")

	stream := cs2.String()
	streamLen := len(stream)

	// Build PDF objects.
	// Object layout:
	//   1: Catalog
	//   2: Pages
	//   3: Page
	//   4: Font (Courier)
	//   5: Content stream

	var pdf bytes.Buffer
	pdf.WriteString("%PDF-1.4\n")

	offsets := make([]int, 6) // 1-indexed, index 0 unused

	offsets[1] = pdf.Len()
	pdf.WriteString("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")

	offsets[2] = pdf.Len()
	pdf.WriteString("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")

	offsets[3] = pdf.Len()
	pdf.WriteString("3 0 obj\n<< /Type /Page /Parent 2 0 R\n")
	pdf.WriteString("   /MediaBox [0 0 595.28 841.89]\n")
	pdf.WriteString("   /Contents 5 0 R\n")
	pdf.WriteString("   /Resources << /Font << /F1 4 0 R >> >>\n")
	pdf.WriteString(">>\nendobj\n")

	offsets[4] = pdf.Len()
	pdf.WriteString("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n")

	offsets[5] = pdf.Len()
	fmt.Fprintf(&pdf, "5 0 obj\n<< /Length %d >>\nstream\n", streamLen)
	pdf.WriteString(stream)
	pdf.WriteString("\nendstream\nendobj\n")

	xrefOffset := pdf.Len()
	fmt.Fprintf(&pdf, "xref\n0 6\n0000000000 65535 f \n")
	for i := 1; i <= 5; i++ {
		fmt.Fprintf(&pdf, "%010d 00000 n \n", offsets[i])
	}
	fmt.Fprintf(&pdf, "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", xrefOffset)

	return pdf.Bytes()
}

// buildCertTextLines converts certificate parameters into plain text lines
// suitable for embedding in a PDF content stream.
func buildCertTextLines(p buildCertHTMLParams) []string {
	var lines []string
	add := func(s string) { lines = append(lines, s) }
	sep := func() { add(strings.Repeat("-", 80)) }

	add(p.tenantName)
	add("CALIBRATION CERTIFICATE")
	add("ISO/IEC 17025 Compliant Calibration Record")
	sep()

	add("CERTIFICATE INFORMATION")
	add(fmt.Sprintf("  Certificate No : %s", p.localID))
	add(fmt.Sprintf("  Sales Order    : %s", p.salesNumber))
	add(fmt.Sprintf("  Flag Number    : %s", p.flagNumber))
	add(fmt.Sprintf("  Date Performed : %s", p.performedAt.Format("2006-01-02")))
	if p.approvedAt != nil {
		add(fmt.Sprintf("  Date Approved  : %s", p.approvedAt.Format("2006-01-02")))
	}
	add(fmt.Sprintf("  Status         : %s", strings.ToUpper(p.status)))
	add(fmt.Sprintf("  Generated      : %s", time.Now().UTC().Format("2006-01-02 15:04 UTC")))
	sep()

	add("INSTRUMENT UNDER TEST")
	add(fmt.Sprintf("  Tag ID          : %s", p.assetTag))
	add(fmt.Sprintf("  Serial Number   : %s", p.serialNumber))
	add(fmt.Sprintf("  Manufacturer    : %s", p.manufacturer))
	add(fmt.Sprintf("  Model           : %s", p.model))
	add(fmt.Sprintf("  Instrument Type : %s", p.instrumentType))
	add(fmt.Sprintf("  Location        : %s", p.location))
	if p.rangeMin != nil && p.rangeMax != nil {
		add(fmt.Sprintf("  Range           : %.4g - %.4g %s", *p.rangeMin, *p.rangeMax, p.rangeUnit))
	}
	if p.customerName != "" {
		add(fmt.Sprintf("  Client          : %s", p.customerName))
	}
	sep()

	add("CALIBRATION MEASUREMENTS")
	add(fmt.Sprintf("  %-20s %12s %12s %6s %8s %6s  Notes", "Point", "Standard", "Measured", "Unit", "Error%", "Result"))
	for _, m := range p.measurements {
		result := "PASS"
		if !m.Pass {
			result = "FAIL"
		}
		add(fmt.Sprintf("  %-20s %12.6g %12.6g %6s %8.4f %6s  %s",
			m.PointLabel, m.StandardValue, m.MeasuredValue, m.Unit, m.ErrorPct, result, m.Notes))
	}
	sep()

	if len(p.standards) > 0 {
		add("REFERENCE STANDARDS USED")
		add(fmt.Sprintf("  %-20s %-15s %-15s %-15s %-15s %s",
			"Name", "Serial", "Model", "Manufacturer", "Cert Ref", "Due At"))
		for _, s := range p.standards {
			dueAt := ""
			if s.DueAt != nil {
				dueAt = s.DueAt.Format("2006-01-02")
			}
			add(fmt.Sprintf("  %-20s %-15s %-15s %-15s %-15s %s",
				s.Name, s.SerialNumber, s.Model, s.Manufacturer, s.CertificateRef, dueAt))
		}
		sep()
	}

	if p.notes != "" {
		add("NOTES")
		add(fmt.Sprintf("  %s", p.notes))
		sep()
	}

	add("SIGNATURES")
	add(fmt.Sprintf("  Technician : %s", p.techName))
	if p.supervisorName != "" {
		add(fmt.Sprintf("  Supervisor : %s", p.supervisorName))
	}
	sep()

	add(fmt.Sprintf("%s - Calibration Services", p.tenantName))
	add("This certificate shall not be reproduced except in full without written")
	add("approval of the issuing laboratory.")

	return lines
}

// certMeasRow holds a single calibration measurement for certificate rendering.
type certMeasRow struct {
	PointLabel    string
	StandardValue float64
	MeasuredValue float64
	Unit          string
	ErrorPct      float64
	Pass          bool
	Notes         string
}

// certStdRow holds a single reference standard for certificate rendering.
type certStdRow struct {
	Name           string
	SerialNumber   string
	Model          string
	Manufacturer   string
	CertificateRef string
	DueAt          *time.Time
}

// buildCertHTMLParams bundles all the data needed to render the certificate HTML.
type buildCertHTMLParams struct {
	recordID       string
	localID        string
	tenantName     string
	customerName   string
	salesNumber    string
	flagNumber     string
	performedAt    time.Time
	approvedAt     *time.Time
	status         string
	notes          string
	techName       string
	techSignature  string
	supervisorName string
	supervisorSig  string
	assetTag       string
	serialNumber   string
	manufacturer   string
	model          string
	instrumentType string
	location       string
	rangeMin       *float64
	rangeMax       *float64
	rangeUnit      string
	measurements   []certMeasRow
	standards      []certStdRow
}

// buildCertHTML renders the same certificate HTML template used by the certificates package
// so that the emailed PDF matches what the supervisor sees.
func buildCertHTML(p buildCertHTMLParams) string {
	var sb strings.Builder

	derefF := func(f *float64) float64 {
		if f == nil {
			return 0
		}
		return *f
	}

	fmtDate := func(t time.Time) string { return t.Format("2006-01-02") }
	fmtPtr := func(t *time.Time) string {
		if t == nil {
			return ""
		}
		return t.Format("2006-01-02")
	}

	fmt.Fprintf(&sb, `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 11px; margin: 0; color: #222; background: #fff; }
  .header { background: #1e1e1e; color: #fff; padding: 20px 30px; display: flex; align-items: center; gap: 20px; }
  .header img { height: 60px; }
  .header-text { flex: 1; }
  .header-company { font-size: 18px; font-weight: bold; color: #fff; margin: 0 0 2px; }
  .header-tagline { font-size: 10px; color: #e8500a; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .header-contact { font-size: 9px; color: #9ca3af; }
  .cert-title { background: #e8500a; color: #fff; text-align: center; padding: 10px; font-size: 16px; font-weight: bold; letter-spacing: 1px; }
  .content { padding: 20px 30px; }
  .section { margin-top: 16px; }
  .section-title { font-weight: bold; border-bottom: 2px solid #e8500a; margin-bottom: 8px; padding-bottom: 3px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #1e1e1e; }
  table { width: 100%%; border-collapse: collapse; margin-top: 4px; }
  th { background: #1e1e1e; color: #fff; padding: 6px 8px; text-align: left; font-size: 10px; }
  td { padding: 5px 8px; border-bottom: 1px solid #e5e5e5; font-size: 10px; }
  tr:nth-child(even) td { background: #f9f9f9; }
  .pass  { color: #27ae60; font-weight: bold; }
  .fail  { color: #c0392b; font-weight: bold; }
  .kv { display: flex; flex-wrap: wrap; gap: 6px 24px; }
  .kv-item { min-width: 200px; }
  .kv-label { font-weight: bold; color: #555; }
  .signatures { display: flex; gap: 40px; margin-top: 24px; }
  .sig-block { flex: 1; border-top: 2px solid #1e1e1e; padding-top: 6px; font-size: 10px; }
  .footer { margin-top: 24px; background: #f5f4f2; border-top: 3px solid #e8500a; padding: 10px 30px; font-size: 8.5px; color: #666; display: flex; justify-content: space-between; }
  .footer-left { font-style: italic; }
  .footer-right { text-align: right; }
</style>
</head>
<body>

<div class="header">
  <img src="https://valatix.com/ultimate_logo_white_bg-removebg-preview.png" alt="Valatix Logo" style="background:#fff;padding:4px;border-radius:4px;"/>
  <div class="header-text">
    <p class="header-company">%s</p>
    <p class="header-tagline">NIST Traceable &bull; Audit-Ready &bull; Specialized Industrial Support</p>
    <p class="header-contact">341 Talbot Street, London, ON N6A 2R5 &nbsp;&bull;&nbsp; (416) 843-5312 &nbsp;&bull;&nbsp; info@valatix.com</p>
  </div>
</div>

<div class="cert-title">CALIBRATION CERTIFICATE</div>

<div class="content">
<div class="section">
  <div class="section-title">Certificate Information</div>
  <div class="kv">`, p.tenantName)

	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Certificate No:</span> %s</div>`, p.localID)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Sales Order:</span> %s</div>`, p.salesNumber)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Flag Number:</span> %s</div>`, p.flagNumber)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Date Performed:</span> %s</div>`, fmtDate(p.performedAt))
	if p.approvedAt != nil {
		fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Date Approved:</span> %s</div>`, fmtPtr(p.approvedAt))
	}
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Status:</span> %s</div>`, p.status)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Generated:</span> %s</div>`, time.Now().UTC().Format("2006-01-02 15:04 UTC"))

	sb.WriteString(`</div></div>

<div class="section">
  <div class="section-title">Instrument Under Test</div>
  <div class="kv">`)

	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Tag ID:</span> %s</div>`, p.assetTag)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Serial Number:</span> %s</div>`, p.serialNumber)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Manufacturer:</span> %s</div>`, p.manufacturer)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Model:</span> %s</div>`, p.model)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Instrument Type:</span> %s</div>`, p.instrumentType)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Location:</span> %s</div>`, p.location)
	if p.rangeMin != nil && p.rangeMax != nil {
		fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Range:</span> %.4g &ndash; %.4g %s</div>`,
			derefF(p.rangeMin), derefF(p.rangeMax), p.rangeUnit)
	}
	if p.customerName != "" {
		fmt.Fprintf(&sb, "<div class=\"kv-item\"><span class=\"kv-label\">Client:</span> %s</div>", p.customerName)
	}

	sb.WriteString(`</div></div>

<div class="section">
  <div class="section-title">Calibration Measurements</div>
  <table>
    <thead>
      <tr>
        <th>Point</th><th>Standard Value</th><th>Measured Value</th>
        <th>Unit</th><th>Error %</th><th>Result</th><th>Notes</th>
      </tr>
    </thead>
    <tbody>`)

	for _, m := range p.measurements {
		resultClass := "pass"
		resultText := "PASS"
		if !m.Pass {
			resultClass = "fail"
			resultText = "FAIL"
		}
		fmt.Fprintf(&sb,
			`<tr><td>%s</td><td>%.6g</td><td>%.6g</td><td>%s</td><td>%.4f</td>`+
				`<td><span class="%s">%s</span></td><td>%s</td></tr>`,
			m.PointLabel, m.StandardValue, m.MeasuredValue, m.Unit, m.ErrorPct,
			resultClass, resultText, m.Notes,
		)
	}

	sb.WriteString(`</tbody></table></div>`)

	if len(p.standards) > 0 {
		sb.WriteString(`
<div class="section">
  <div class="section-title">Reference Standards Used</div>
  <table>
    <thead>
      <tr>
        <th>Name</th><th>Serial Number</th><th>Model</th>
        <th>Manufacturer</th><th>Certificate Ref</th><th>Due At</th>
      </tr>
    </thead>
    <tbody>`)
		for _, s := range p.standards {
			dueAt := ""
			if s.DueAt != nil {
				dueAt = s.DueAt.Format("2006-01-02")
			}
			fmt.Fprintf(&sb,
				`<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>`,
				s.Name, s.SerialNumber, s.Model, s.Manufacturer, s.CertificateRef, dueAt,
			)
		}
		sb.WriteString(`</tbody></table></div>`)
	}

	if p.notes != "" {
		fmt.Fprintf(&sb, `<div class="section"><div class="section-title">Notes</div><p>%s</p></div>`, p.notes)
	}

	sb.WriteString(`<div class="signatures">`)
	fmt.Fprintf(&sb,
		`<div class="sig-block"><strong>Technician</strong><br/>%s<br/>`, p.techName)
	if p.techSignature != "" {
		sb.WriteString(`<em>Signature on file</em>`)
	}
	sb.WriteString(`</div>`)

	if p.supervisorName != "" {
		fmt.Fprintf(&sb,
			`<div class="sig-block"><strong>Supervisor / Approver</strong><br/>%s<br/>`, p.supervisorName)
		if p.supervisorSig != "" {
			sb.WriteString(`<em>Signature on file</em>`)
		}
		sb.WriteString(`</div>`)
	}
	sb.WriteString(`</div>`)

	fmt.Fprintf(&sb, `
</div><!-- /content -->
<div class="footer">
  <span class="footer-left">This certificate shall not be reproduced except in full without written approval of %s.</span>
  <span class="footer-right">Generated %s &bull; 447 Licensed Instrumentation &amp; Control</span>
</div>
</body>
</html>`, p.tenantName, time.Now().UTC().Format("2006-01-02"))

	return sb.String()
}
