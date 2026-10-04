// Package activity serves the tamper-evident activity log written by the
// audit_capture trigger (migration 017).
//
// Routes (register in main.go):
//
//	GET /activity          handler.List    — tenant log (supervisor/admin), or one
//	                                        record's history (?record_id=, any staff)
//	GET /activity/verify   handler.Verify  — recompute the hash chain (supervisor/admin)
package activity

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/jasonreid/probatus/internal/db"
	"github.com/jasonreid/probatus/internal/httputil"
	"github.com/jasonreid/probatus/internal/middleware"
)

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Handler serves the activity log.
type Handler struct {
	pool querier
}

// NewHandler creates an activity Handler.
func NewHandler(pool db.Pool) *Handler {
	return &Handler{pool: pool}
}

// Change is one field that differs between the old and new row.
type Change struct {
	Field string `json:"field"`
	Old   any    `json:"old"`
	New   any    `json:"new"`
}

// Entry is one activity log row, ready for display.
type Entry struct {
	ID        int64     `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	UserID    *string   `json:"user_id"`
	UserName  *string   `json:"user_name"`
	Table     string    `json:"table_name"`
	RecordID  string    `json:"record_id"`
	ParentID  *string   `json:"parent_id"`
	Action    string    `json:"action"`
	Label     string    `json:"label"`
	Changes   []Change  `json:"changes"`
}

// ignoredFields never count as a change worth showing.
var ignoredFields = map[string]bool{"updated_at": true, "created_at": true, "tenant_id": true}

// labelFields name the column that identifies a row to a person, in order of preference.
var labelFields = []string{"tag_id", "number", "title", "name", "full_name", "file_name", "point_label", "description"}

func isManager(role string) bool { return role == "supervisor" || role == "admin" }

// List returns activity newest-first. Filters: record_id, table, user_id,
// action, from, to (YYYY-MM-DD), before_id (pagination cursor), limit.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := middleware.TenantIDFromCtx(ctx)
	role := middleware.RoleFromCtx(ctx)
	q := r.URL.Query()
	recordID := q.Get("record_id")

	if role == "customer" || (recordID == "" && !isManager(role)) {
		httputil.WriteError(w, http.StatusForbidden, "only supervisors and admins can view the full activity log")
		return
	}

	limit := 50
	if n, err := strconv.Atoi(q.Get("limit")); err == nil && n > 0 && n <= 200 {
		limit = n
	}

	where := []string{"a.tenant_id = $1"}
	args := []any{tenantID}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(cond, len(args)))
	}
	if recordID != "" {
		args = append(args, recordID)
		where = append(where, fmt.Sprintf("(a.record_id = $%d::uuid OR a.parent_id = $%d::uuid)", len(args), len(args)))
	}
	if v := q.Get("table"); v != "" {
		add("a.table_name = $%d", v)
	}
	if v := q.Get("user_id"); v != "" {
		add("a.user_id = $%d::uuid", v)
	}
	if v := strings.ToUpper(q.Get("action")); v == "INSERT" || v == "UPDATE" || v == "DELETE" {
		add("a.action = $%d", v)
	}
	if v := q.Get("from"); v != "" {
		add("a.created_at >= $%d::date", v)
	}
	if v := q.Get("to"); v != "" {
		add("a.created_at < $%d::date + 1", v)
	}
	if v, err := strconv.ParseInt(q.Get("before_id"), 10, 64); err == nil && v > 0 {
		add("a.id < $%d", v)
	}
	args = append(args, limit)

	rows, err := h.pool.Query(ctx, `
		SELECT a.id, a.created_at, a.user_id::text, p.full_name, a.table_name,
		       a.record_id::text, a.parent_id::text, a.action, a.old_data, a.new_data
		FROM audit_log a
		LEFT JOIN profiles p ON p.id = a.user_id
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY a.id DESC
		LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		slog.Error("activity.List: query failed", "tenant_id", tenantID, "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to load activity")
		return
	}
	defer rows.Close()

	entries := []Entry{}
	for rows.Next() {
		var e Entry
		var oldRaw, newRaw []byte
		if err := rows.Scan(&e.ID, &e.CreatedAt, &e.UserID, &e.UserName, &e.Table,
			&e.RecordID, &e.ParentID, &e.Action, &oldRaw, &newRaw); err != nil {
			slog.Error("activity.List: scan failed", "error", err)
			httputil.WriteError(w, http.StatusInternalServerError, "failed to load activity")
			return
		}
		oldRow, newRow := decode(oldRaw), decode(newRaw)
		e.Changes = diff(oldRow, newRow)
		e.Label = label(newRow, oldRow)
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		slog.Error("activity.List: rows failed", "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to load activity")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, entries)
}

// VerifyResponse reports whether the tenant's hash chain is intact.
type VerifyResponse struct {
	OK            bool   `json:"ok"`
	Checked       int64  `json:"checked"`
	FirstBrokenID *int64 `json:"first_broken_id"`
}

// Verify recomputes the tenant's hash chain.
func (h *Handler) Verify(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if !isManager(middleware.RoleFromCtx(ctx)) {
		httputil.WriteError(w, http.StatusForbidden, "only supervisors and admins can verify the activity log")
		return
	}
	tenantID := middleware.TenantIDFromCtx(ctx)
	var resp VerifyResponse
	if err := h.pool.QueryRow(ctx,
		`SELECT checked, first_broken_id FROM audit_log_verify($1::uuid)`, tenantID,
	).Scan(&resp.Checked, &resp.FirstBrokenID); err != nil {
		slog.Error("activity.Verify: failed", "tenant_id", tenantID, "error", err)
		httputil.WriteError(w, http.StatusInternalServerError, "failed to verify activity log")
		return
	}
	resp.OK = resp.FirstBrokenID == nil
	httputil.WriteJSON(w, http.StatusOK, resp)
}

func decode(raw []byte) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	return m
}

// diff lists changed fields. For an insert every non-empty field is "new";
// for a delete every non-empty field is "old".
func diff(oldRow, newRow map[string]any) []Change {
	keys := map[string]bool{}
	for k := range oldRow {
		keys[k] = true
	}
	for k := range newRow {
		keys[k] = true
	}
	changes := []Change{}
	for k := range keys {
		if ignoredFields[k] || k == "id" {
			continue
		}
		o, n := oldRow[k], newRow[k]
		if reflect.DeepEqual(o, n) || (o == nil && n == "") || (o == "" && n == nil) {
			continue
		}
		changes = append(changes, Change{Field: k, Old: o, New: n})
	}
	sort.Slice(changes, func(i, j int) bool { return changes[i].Field < changes[j].Field })
	return changes
}

func label(rows ...map[string]any) string {
	for _, row := range rows {
		for _, f := range labelFields {
			if v, ok := row[f]; ok && v != nil && fmt.Sprint(v) != "" {
				if f == "number" {
					return "#" + fmt.Sprint(v)
				}
				return fmt.Sprint(v)
			}
		}
	}
	return ""
}
