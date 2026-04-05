package templates

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jasonreid/probatus/internal/middleware"
)

// Handler holds the DB pool for the templates resource.
type Handler struct {
	pool *pgxpool.Pool
}

// NewHandler creates a new templates Handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

// CalibrationTemplate represents a calibration_templates row.
type CalibrationTemplate struct {
	ID             string          `json:"id"`
	TenantID       string          `json:"tenant_id"`
	Name           string          `json:"name"`
	Description    *string         `json:"description,omitempty"`
	InstrumentType string          `json:"instrument_type"`
	TolerancePct   float64         `json:"tolerance_pct"`
	Points         json.RawMessage `json:"points"`
	CreatedBy      *string         `json:"created_by,omitempty"`
	CreatedAt      string          `json:"created_at"`
}

// templateInput is the request body for create / update.
type templateInput struct {
	Name           string          `json:"name"`
	Description    *string         `json:"description"`
	InstrumentType string          `json:"instrument_type"`
	TolerancePct   float64         `json:"tolerance_pct"`
	Points         json.RawMessage `json:"points"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

const selectCols = `
	id::text, tenant_id::text, name, description, instrument_type,
	tolerance_pct, points, created_by::text, created_at::text`

func scanTemplate(row pgx.Row) (*CalibrationTemplate, error) {
	t := &CalibrationTemplate{}
	err := row.Scan(
		&t.ID, &t.TenantID, &t.Name, &t.Description, &t.InstrumentType,
		&t.TolerancePct, &t.Points, &t.CreatedBy, &t.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return t, nil
}

// List returns all calibration templates for the authenticated tenant,
// optionally filtered by ?instrument_type=.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	instrumentType := r.URL.Query().Get("instrument_type")

	var (
		rows pgx.Rows
		err  error
	)

	if instrumentType != "" {
		rows, err = h.pool.Query(r.Context(),
			`SELECT`+selectCols+`
			 FROM calibration_templates
			 WHERE tenant_id = $1 AND instrument_type = $2
			 ORDER BY name ASC`,
			tenantID, instrumentType,
		)
	} else {
		rows, err = h.pool.Query(r.Context(),
			`SELECT`+selectCols+`
			 FROM calibration_templates
			 WHERE tenant_id = $1
			 ORDER BY instrument_type, name ASC`,
			tenantID,
		)
	}

	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query templates")
		return
	}
	defer rows.Close()

	templates := []*CalibrationTemplate{}
	for rows.Next() {
		t, err := scanTemplate(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to scan template")
			return
		}
		templates = append(templates, t)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "error iterating templates")
		return
	}

	writeJSON(w, http.StatusOK, templates)
}

// Get returns a single calibration template by ID for the authenticated tenant.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	row := h.pool.QueryRow(r.Context(),
		`SELECT`+selectCols+`
		 FROM calibration_templates
		 WHERE id = $1 AND tenant_id = $2`,
		id, tenantID,
	)

	t, err := scanTemplate(row)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query template")
		return
	}

	writeJSON(w, http.StatusOK, t)
}

// Create inserts a new calibration template for the authenticated tenant.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	userID := middleware.UserIDFromCtx(r.Context())

	var body templateInput
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if body.InstrumentType == "" {
		writeError(w, http.StatusBadRequest, "instrument_type is required")
		return
	}
	if body.Points == nil {
		body.Points = json.RawMessage("[]")
	}
	if body.TolerancePct == 0 {
		body.TolerancePct = 1.0
	}

	row := h.pool.QueryRow(r.Context(),
		`INSERT INTO calibration_templates
			(tenant_id, name, description, instrument_type, tolerance_pct, points, created_by)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 RETURNING`+selectCols,
		tenantID, body.Name, body.Description, body.InstrumentType,
		body.TolerancePct, body.Points, userID,
	)

	t, err := scanTemplate(row)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create template")
		return
	}

	writeJSON(w, http.StatusCreated, t)
}

// Update modifies an existing calibration template belonging to the authenticated tenant.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	var body templateInput
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if body.Points == nil {
		body.Points = json.RawMessage("[]")
	}

	row := h.pool.QueryRow(r.Context(),
		`UPDATE calibration_templates
		 SET name = $3, description = $4, instrument_type = $5,
		     tolerance_pct = $6, points = $7
		 WHERE id = $1 AND tenant_id = $2
		 RETURNING`+selectCols,
		id, tenantID, body.Name, body.Description, body.InstrumentType,
		body.TolerancePct, body.Points,
	)

	t, err := scanTemplate(row)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update template")
		return
	}

	writeJSON(w, http.StatusOK, t)
}

// Delete removes a calibration template belonging to the authenticated tenant.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	tag, err := h.pool.Exec(r.Context(),
		`DELETE FROM calibration_templates WHERE id = $1 AND tenant_id = $2`,
		id, tenantID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete template")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
