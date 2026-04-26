package standards

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/jasonreid/probatus/internal/middleware"
)

// Recall marks all calibration records that used the given standard as recalled.
// POST /standards/{id}/recall
// Body: {"recall_reason": "..."}
// Role: supervisor or admin only.
func (h *Handler) Recall(w http.ResponseWriter, r *http.Request) {
	role := middleware.RoleFromCtx(r.Context())
	if role != "supervisor" && role != "admin" {
		writeError(w, http.StatusForbidden, "supervisor or admin role required")
		return
	}

	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	var body struct {
		RecallReason string `json:"recall_reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.RecallReason == "" {
		writeError(w, http.StatusBadRequest, "recall_reason is required")
		return
	}

	tag, err := h.pool.Exec(r.Context(), `
		UPDATE calibration_records cr
		SET recalled_at  = now(),
		    recall_reason = $1,
		    updated_at   = now()
		FROM calibration_standards_used csu
		WHERE csu.record_id   = cr.id
		  AND csu.standard_id = $2
		  AND cr.tenant_id    = $3
		  AND cr.recalled_at IS NULL`,
		body.RecallReason, id, tenantID,
	)
	if err != nil {
		slog.Error("standards.Recall: exec failed", "standard_id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to recall calibration records")
		return
	}

	n := tag.RowsAffected()
	slog.Info("standards.Recall: records recalled", "standard_id", id, "count", n, "tenant_id", tenantID)
	writeJSON(w, http.StatusOK, map[string]int64{"recalled": n})
}
