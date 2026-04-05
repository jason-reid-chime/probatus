package standards

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jasonreid/probatus/internal/middleware"
)

// Handler holds the DB pool for the standards resource.
type Handler struct {
	pool *pgxpool.Pool
}

// NewHandler creates a new standards Handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

// MasterStandard represents a master_standards row.
type MasterStandard struct {
	ID             string     `json:"id"`
	TenantID       string     `json:"tenant_id"`
	Name           string     `json:"name"`
	SerialNumber   string     `json:"serial_number"`
	Model          string     `json:"model"`
	Manufacturer   string     `json:"manufacturer"`
	CertificateRef string     `json:"certificate_ref"`
	CalibratedAt   *time.Time `json:"calibrated_at,omitempty"`
	DueAt          *time.Time `json:"due_at,omitempty"`
	Notes          string     `json:"notes"`
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
	id::text, tenant_id::text, name, serial_number, model, manufacturer,
	certificate_ref, calibrated_at, due_at, notes`

func scanStandard(row pgx.Row) (*MasterStandard, error) {
	s := &MasterStandard{}
	err := row.Scan(
		&s.ID, &s.TenantID, &s.Name, &s.SerialNumber, &s.Model,
		&s.Manufacturer, &s.CertificateRef, &s.CalibratedAt, &s.DueAt, &s.Notes,
	)
	if err != nil {
		return nil, err
	}
	return s, nil
}

// List returns all master standards for the authenticated tenant.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())

	rows, err := h.pool.Query(r.Context(),
		`SELECT`+selectCols+`
		 FROM master_standards
		 WHERE tenant_id = $1
		 ORDER BY name ASC`,
		tenantID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query standards")
		return
	}
	defer rows.Close()

	standards := []*MasterStandard{}
	for rows.Next() {
		s, err := scanStandard(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to scan standard")
			return
		}
		standards = append(standards, s)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "error iterating standards")
		return
	}

	writeJSON(w, http.StatusOK, standards)
}

// Get returns a single master standard by ID for the authenticated tenant.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	row := h.pool.QueryRow(r.Context(),
		`SELECT`+selectCols+`
		 FROM master_standards
		 WHERE id = $1 AND tenant_id = $2`,
		id, tenantID,
	)

	s, err := scanStandard(row)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "standard not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query standard")
		return
	}

	writeJSON(w, http.StatusOK, s)
}

// Create inserts a new master standard for the authenticated tenant.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())

	var body struct {
		Name           string  `json:"name"`
		SerialNumber   string  `json:"serial_number"`
		Model          string  `json:"model"`
		Manufacturer   string  `json:"manufacturer"`
		CertificateRef string  `json:"certificate_ref"`
		CalibratedAt   *string `json:"calibrated_at"`
		DueAt          *string `json:"due_at"`
		Notes          string  `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var calibratedAt, dueAt *time.Time
	if body.CalibratedAt != nil {
		t, err := time.Parse("2006-01-02", *body.CalibratedAt)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid calibrated_at format, use YYYY-MM-DD")
			return
		}
		calibratedAt = &t
	}
	if body.DueAt != nil {
		t, err := time.Parse("2006-01-02", *body.DueAt)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid due_at format, use YYYY-MM-DD")
			return
		}
		dueAt = &t
	}

	row := h.pool.QueryRow(r.Context(),
		`INSERT INTO master_standards
			(tenant_id, name, serial_number, model, manufacturer, certificate_ref, calibrated_at, due_at, notes)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 RETURNING`+selectCols,
		tenantID, body.Name, body.SerialNumber, body.Model, body.Manufacturer,
		body.CertificateRef, calibratedAt, dueAt, body.Notes,
	)

	s, err := scanStandard(row)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create standard")
		return
	}

	writeJSON(w, http.StatusCreated, s)
}

// Update modifies an existing master standard belonging to the authenticated tenant.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	var body struct {
		Name           string  `json:"name"`
		SerialNumber   string  `json:"serial_number"`
		Model          string  `json:"model"`
		Manufacturer   string  `json:"manufacturer"`
		CertificateRef string  `json:"certificate_ref"`
		CalibratedAt   *string `json:"calibrated_at"`
		DueAt          *string `json:"due_at"`
		Notes          string  `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var calibratedAt, dueAt *time.Time
	if body.CalibratedAt != nil {
		t, err := time.Parse("2006-01-02", *body.CalibratedAt)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid calibrated_at format, use YYYY-MM-DD")
			return
		}
		calibratedAt = &t
	}
	if body.DueAt != nil {
		t, err := time.Parse("2006-01-02", *body.DueAt)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid due_at format, use YYYY-MM-DD")
			return
		}
		dueAt = &t
	}

	row := h.pool.QueryRow(r.Context(),
		`UPDATE master_standards
		 SET name = $3, serial_number = $4, model = $5, manufacturer = $6,
		     certificate_ref = $7, calibrated_at = $8, due_at = $9, notes = $10
		 WHERE id = $1 AND tenant_id = $2
		 RETURNING`+selectCols,
		id, tenantID, body.Name, body.SerialNumber, body.Model, body.Manufacturer,
		body.CertificateRef, calibratedAt, dueAt, body.Notes,
	)

	s, err := scanStandard(row)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "standard not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update standard")
		return
	}

	writeJSON(w, http.StatusOK, s)
}
