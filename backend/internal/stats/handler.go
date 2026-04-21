package stats

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jasonreid/probatus/internal/middleware"
)

// Handler holds the DB pool for the stats resource.
type Handler struct {
	pool *pgxpool.Pool
}

// NewHandler creates a new stats Handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// DashboardResponse is the shape returned by the /stats/dashboard endpoint.
type DashboardResponse struct {
	OverdueCount           int     `json:"overdue_count"`
	DueWithin30            int     `json:"due_within_30"`
	DueWithin90            int     `json:"due_within_90"`
	StandardsExpiringSoon  int     `json:"standards_expiring_soon"`
	PassRate30d            float64 `json:"pass_rate_30d"`
}

// Dashboard returns aggregated calibration statistics for the authenticated tenant.
func (h *Handler) Dashboard(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	now := time.Now().UTC()
	today := now.Truncate(24 * time.Hour)
	in30 := today.AddDate(0, 0, 30)
	in90 := today.AddDate(0, 0, 90)
	thirtyDaysAgo := today.AddDate(0, 0, -30)

	var resp DashboardResponse

	// Overdue assets: next_due_at < today.
	err := h.pool.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM assets
		 WHERE tenant_id = $1 AND next_due_at < $2`,
		tenantID, today,
	).Scan(&resp.OverdueCount)
	if err != nil {
		slog.Error("stats.Dashboard: overdue count query failed", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query overdue count")
		return
	}

	// Due within 30 days (not yet overdue).
	err = h.pool.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM assets
		 WHERE tenant_id = $1 AND next_due_at >= $2 AND next_due_at <= $3`,
		tenantID, today, in30,
	).Scan(&resp.DueWithin30)
	if err != nil {
		slog.Error("stats.Dashboard: due_within_30 query failed", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query due_within_30")
		return
	}

	// Due within 90 days (not yet overdue).
	err = h.pool.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM assets
		 WHERE tenant_id = $1 AND next_due_at >= $2 AND next_due_at <= $3`,
		tenantID, today, in90,
	).Scan(&resp.DueWithin90)
	if err != nil {
		slog.Error("stats.Dashboard: due_within_90 query failed", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query due_within_90")
		return
	}

	// Standards expiring within 30 days (including already expired).
	err = h.pool.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM master_standards
		 WHERE tenant_id = $1 AND due_at <= $2`,
		tenantID, in30,
	).Scan(&resp.StandardsExpiringSoon)
	if err != nil {
		slog.Error("stats.Dashboard: standards expiring query failed", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query standards_expiring_soon")
		return
	}

	// Pass rate over last 30 days: ratio of measurements with pass=true.
	var totalMeasurements, passMeasurements int
	err = h.pool.QueryRow(r.Context(),
		`SELECT
		   COUNT(*) AS total,
		   COUNT(*) FILTER (WHERE cm.pass = true) AS passed
		 FROM calibration_measurements cm
		 JOIN calibration_records cr ON cr.id = cm.record_id
		 WHERE cr.tenant_id = $1 AND cr.performed_at >= $2`,
		tenantID, thirtyDaysAgo,
	).Scan(&totalMeasurements, &passMeasurements)
	if err != nil {
		slog.Error("stats.Dashboard: pass rate query failed", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query pass rate")
		return
	}

	if totalMeasurements > 0 {
		resp.PassRate30d = float64(passMeasurements) / float64(totalMeasurements)
	}

	writeJSON(w, http.StatusOK, resp)
}
