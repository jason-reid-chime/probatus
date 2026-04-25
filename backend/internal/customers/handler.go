package customers

import (
	"context"
	"encoding/json"
	"log/slog"
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

// Handler holds the DB pool for the customers resource.
type Handler struct {
	pool querier
}

// NewHandler creates a new customers Handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

// Customer represents a customers row.
type Customer struct {
	ID        string     `json:"id"`
	TenantID  string     `json:"tenant_id"`
	Name      string     `json:"name"`
	Contact   string     `json:"contact"`
	Email     string     `json:"email"`
	Phone     string     `json:"phone"`
	Address   string     `json:"address"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// List returns all customers for the authenticated tenant ordered by name ASC.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())

	rows, err := h.pool.Query(r.Context(),
		`SELECT id::text, tenant_id::text,
		        COALESCE(name,''), COALESCE(contact,''), COALESCE(email,''),
		        COALESCE(phone,''), COALESCE(address,''), updated_at
		 FROM customers
		 WHERE tenant_id = $1
		 ORDER BY name ASC`,
		tenantID,
	)
	if err != nil {
		slog.Error("customers.List: query failed", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query customers")
		return
	}
	defer rows.Close()

	customers := []*Customer{}
	for rows.Next() {
		c := &Customer{}
		if err := rows.Scan(&c.ID, &c.TenantID, &c.Name, &c.Contact, &c.Email, &c.Phone, &c.Address, &c.UpdatedAt); err != nil {
			slog.Error("customers.List: scan failed", "tenant_id", tenantID, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to scan customer")
			return
		}
		customers = append(customers, c)
	}
	if err := rows.Err(); err != nil {
		slog.Error("customers.List: iteration error", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "error iterating customers")
		return
	}

	writeJSON(w, http.StatusOK, customers)
}

// Create inserts or upserts a customer record.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())

	var body struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Contact string `json:"contact"`
		Email   string `json:"email"`
		Phone   string `json:"phone"`
		Address string `json:"address"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	var row pgx.Row
	if body.ID != "" {
		// Upsert with provided ID.
		row = h.pool.QueryRow(r.Context(),
			`INSERT INTO customers (id, tenant_id, name, contact, email, phone, address, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, now())
			 ON CONFLICT (id) DO UPDATE
			   SET name = EXCLUDED.name,
			       contact = EXCLUDED.contact,
			       email = EXCLUDED.email,
			       phone = EXCLUDED.phone,
			       address = EXCLUDED.address,
			       updated_at = now()
			 RETURNING id::text`,
			body.ID, tenantID, body.Name, body.Contact, body.Email, body.Phone, body.Address,
		)
	} else {
		// Insert with auto-generated ID.
		row = h.pool.QueryRow(r.Context(),
			`INSERT INTO customers (tenant_id, name, contact, email, phone, address, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, now())
			 RETURNING id::text`,
			tenantID, body.Name, body.Contact, body.Email, body.Phone, body.Address,
		)
	}

	var id string
	if err := row.Scan(&id); err != nil {
		slog.Error("customers.Create: insert failed", "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create customer")
		return
	}

	slog.Info("customers.Create: customer created/upserted", "customer_id", id, "tenant_id", tenantID)
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// Update modifies an existing customer record.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	var body struct {
		Name    string `json:"name"`
		Contact string `json:"contact"`
		Email   string `json:"email"`
		Phone   string `json:"phone"`
		Address string `json:"address"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	tag, err := h.pool.Exec(r.Context(),
		`UPDATE customers
		 SET name    = COALESCE(NULLIF($3, ''), name),
		     contact = COALESCE(NULLIF($4, ''), contact),
		     email   = COALESCE(NULLIF($5, ''), email),
		     phone   = COALESCE(NULLIF($6, ''), phone),
		     address = COALESCE(NULLIF($7, ''), address),
		     updated_at = now()
		 WHERE id = $1 AND tenant_id = $2`,
		id, tenantID, body.Name, body.Contact, body.Email, body.Phone, body.Address,
	)
	if err != nil {
		slog.Error("customers.Update: exec failed", "customer_id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update customer")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "customer not found")
		return
	}

	slog.Info("customers.Update: customer updated", "customer_id", id, "tenant_id", tenantID)
	writeJSON(w, http.StatusOK, map[string]string{"id": id})
}

// Delete removes a customer record, first nulling out customer_id on any referencing assets.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	// Null out customer_id on assets that reference this customer so the FK
	// constraint does not block the delete (assets are not deleted with the customer).
	if _, err := h.pool.Exec(r.Context(),
		`UPDATE assets SET customer_id = NULL WHERE customer_id = $1 AND tenant_id = $2`,
		id, tenantID,
	); err != nil {
		slog.Error("customers.Delete: failed to null asset customer_id", "customer_id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to unlink assets from customer")
		return
	}

	tag, err := h.pool.Exec(r.Context(),
		`DELETE FROM customers WHERE id = $1 AND tenant_id = $2`,
		id, tenantID,
	)
	if err != nil {
		slog.Error("customers.Delete: exec failed", "customer_id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to delete customer")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "customer not found")
		return
	}

	slog.Info("customers.Delete: customer deleted", "customer_id", id, "tenant_id", tenantID)
	w.WriteHeader(http.StatusNoContent)
}
