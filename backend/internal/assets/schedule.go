package assets

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/jasonreid/probatus/internal/middleware"
)

// Schedule returns assets whose next_due_at falls within the next N days
// (default 30, max 365) and that have no open or in-progress work order.
//
// GET /assets/schedule?days=30
func (h *Handler) Schedule(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())

	daysStr := r.URL.Query().Get("days")
	days := 30
	if daysStr != "" {
		if n, err := strconv.Atoi(daysStr); err == nil && n > 0 && n <= 365 {
			days = n
		}
	}

	rows, err := h.pool.Query(r.Context(), `
		SELECT a.id::text, a.tag_id, a.instrument_type, a.serial_number,
		       a.manufacturer, a.model, a.next_due_at::text,
		       c.name as customer_name
		FROM assets a
		LEFT JOIN customers c ON c.id = a.customer_id
		WHERE a.tenant_id = $1
		  AND a.next_due_at IS NOT NULL
		  AND a.next_due_at <= (CURRENT_DATE + ($2::text || ' days')::interval)
		  AND NOT EXISTS (
		      SELECT 1
		      FROM work_order_assets woa
		      JOIN work_orders wo ON wo.id = woa.work_order_id
		      WHERE woa.asset_id = a.id
		        AND wo.status IN ('open', 'in_progress')
		  )
		ORDER BY a.next_due_at ASC
	`, tenantID, days)
	if err != nil {
		slog.Error("assets.Schedule: query failed", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query scheduled assets")
		return
	}
	defer rows.Close()

	type ScheduledAsset struct {
		ID           string  `json:"id"`
		TagID        string  `json:"tag_id"`
		Type         string  `json:"instrument_type"`
		SerialNumber *string `json:"serial_number"`
		Manufacturer *string `json:"manufacturer"`
		Model        *string `json:"model"`
		NextDueAt    string  `json:"next_due_at"`
		CustomerName *string `json:"customer_name"`
	}

	assets := []ScheduledAsset{}
	for rows.Next() {
		var a ScheduledAsset
		if err := rows.Scan(&a.ID, &a.TagID, &a.Type, &a.SerialNumber,
			&a.Manufacturer, &a.Model, &a.NextDueAt, &a.CustomerName); err != nil {
			slog.Error("assets.Schedule: scan failed", "error", err)
			continue
		}
		assets = append(assets, a)
	}

	writeJSON(w, http.StatusOK, assets)
}
