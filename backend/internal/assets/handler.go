package assets

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jasonreid/probatus/internal/middleware"
)

// querier is the minimal DB interface used by Handler. *pgxpool.Pool satisfies this.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// isUniqueViolation returns true when err is a PostgreSQL unique-constraint
// violation (SQLSTATE 23505).
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

// Handler holds the DB pool for the assets resource.
type Handler struct {
	pool querier
}

// NewHandler creates a new assets Handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

// Asset represents a calibration asset.
type Asset struct {
	ID                      string     `json:"id"`
	TenantID                string     `json:"tenant_id"`
	CustomerID              *string    `json:"customer_id,omitempty"`
	TagID                   string     `json:"tag_id"`
	SerialNumber            string     `json:"serial_number"`
	Manufacturer            string     `json:"manufacturer"`
	Model                   string     `json:"model"`
	InstrumentType          string     `json:"instrument_type"`
	RangeMin                *float64   `json:"range_min,omitempty"`
	RangeMax                *float64   `json:"range_max,omitempty"`
	RangeUnit               string     `json:"range_unit"`
	CalibrationIntervalDays *int       `json:"calibration_interval_days,omitempty"`
	LastCalibratedAt        *time.Time `json:"last_calibrated_at,omitempty"`
	NextDueAt               *time.Time `json:"next_due_at,omitempty"`
	Location                string     `json:"location"`
	Notes                   string     `json:"notes"`
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
	id::text, tenant_id::text, customer_id::text, tag_id, serial_number, manufacturer, model,
	instrument_type, range_min, range_max, range_unit, calibration_interval_days,
	last_calibrated_at, next_due_at, location, notes`

func scanAsset(row pgx.Row) (*Asset, error) {
	a := &Asset{}
	err := row.Scan(
		&a.ID, &a.TenantID, &a.CustomerID, &a.TagID, &a.SerialNumber, &a.Manufacturer,
		&a.Model, &a.InstrumentType, &a.RangeMin, &a.RangeMax, &a.RangeUnit,
		&a.CalibrationIntervalDays, &a.LastCalibratedAt, &a.NextDueAt,
		&a.Location, &a.Notes,
	)
	if err != nil {
		return nil, err
	}
	return a, nil
}

// List returns all assets for the authenticated tenant, ordered by next_due_at.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())

	rows, err := h.pool.Query(r.Context(),
		`SELECT`+selectCols+`
		 FROM assets
		 WHERE tenant_id = $1
		 ORDER BY next_due_at ASC NULLS LAST`,
		tenantID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query assets")
		return
	}
	defer rows.Close()

	assets := []*Asset{}
	for rows.Next() {
		a, err := scanAsset(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to scan asset")
			return
		}
		assets = append(assets, a)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "error iterating assets")
		return
	}

	writeJSON(w, http.StatusOK, assets)
}

// Get returns a single asset by ID for the authenticated tenant.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	row := h.pool.QueryRow(r.Context(),
		`SELECT`+selectCols+`
		 FROM assets
		 WHERE id = $1 AND tenant_id = $2`,
		id, tenantID,
	)

	a, err := scanAsset(row)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "asset not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query asset")
		return
	}

	writeJSON(w, http.StatusOK, a)
}

// Create inserts a new asset for the authenticated tenant.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())

	var body struct {
		CustomerID              *string  `json:"customer_id"`
		TagID                   string   `json:"tag_id"`
		SerialNumber            string   `json:"serial_number"`
		Manufacturer            string   `json:"manufacturer"`
		Model                   string   `json:"model"`
		InstrumentType          string   `json:"instrument_type"`
		RangeMin                *float64 `json:"range_min"`
		RangeMax                *float64 `json:"range_max"`
		RangeUnit               string   `json:"range_unit"`
		CalibrationIntervalDays *int     `json:"calibration_interval_days"`
		Location                string   `json:"location"`
		Notes                   string   `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	row := h.pool.QueryRow(r.Context(),
		`INSERT INTO assets
			(tenant_id, customer_id, tag_id, serial_number, manufacturer, model,
			 instrument_type, range_min, range_max, range_unit,
			 calibration_interval_days, location, notes)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		 RETURNING`+selectCols,
		tenantID, body.CustomerID, body.TagID, body.SerialNumber, body.Manufacturer,
		body.Model, body.InstrumentType, body.RangeMin, body.RangeMax, body.RangeUnit,
		body.CalibrationIntervalDays, body.Location, body.Notes,
	)

	a, err := scanAsset(row)
	if isUniqueViolation(err) {
		writeError(w, http.StatusConflict, "tag ID already exists for this tenant")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create asset")
		return
	}

	writeJSON(w, http.StatusCreated, a)
}

// Update modifies an existing asset belonging to the authenticated tenant.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	var body struct {
		CustomerID              *string  `json:"customer_id"`
		TagID                   string   `json:"tag_id"`
		SerialNumber            string   `json:"serial_number"`
		Manufacturer            string   `json:"manufacturer"`
		Model                   string   `json:"model"`
		InstrumentType          string   `json:"instrument_type"`
		RangeMin                *float64 `json:"range_min"`
		RangeMax                *float64 `json:"range_max"`
		RangeUnit               string   `json:"range_unit"`
		CalibrationIntervalDays *int     `json:"calibration_interval_days"`
		Location                string   `json:"location"`
		Notes                   string   `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	row := h.pool.QueryRow(r.Context(),
		`UPDATE assets
		 SET customer_id = $3, tag_id = $4, serial_number = $5, manufacturer = $6,
		     model = $7, instrument_type = $8, range_min = $9, range_max = $10,
		     range_unit = $11, calibration_interval_days = $12, location = $13, notes = $14
		 WHERE id = $1 AND tenant_id = $2
		 RETURNING`+selectCols,
		id, tenantID,
		body.CustomerID, body.TagID, body.SerialNumber, body.Manufacturer,
		body.Model, body.InstrumentType, body.RangeMin, body.RangeMax, body.RangeUnit,
		body.CalibrationIntervalDays, body.Location, body.Notes,
	)

	a, err := scanAsset(row)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "asset not found")
		return
	}
	if isUniqueViolation(err) {
		writeError(w, http.StatusConflict, "tag ID already exists for this tenant")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update asset")
		return
	}

	writeJSON(w, http.StatusOK, a)
}

// Delete removes an asset belonging to the authenticated tenant.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	tag, err := h.pool.Exec(r.Context(),
		`DELETE FROM assets WHERE id = $1 AND tenant_id = $2`,
		id, tenantID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete asset")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "asset not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// GetByTagID returns the asset matching a QR/tag ID for the authenticated tenant.
func (h *Handler) GetByTagID(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	tagID := chi.URLParam(r, "tagId")

	row := h.pool.QueryRow(r.Context(),
		`SELECT`+selectCols+`
		 FROM assets
		 WHERE tag_id = $1 AND tenant_id = $2`,
		tagID, tenantID,
	)

	a, err := scanAsset(row)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "asset not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query asset")
		return
	}

	writeJSON(w, http.StatusOK, a)
}
