package stats

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"

	"github.com/jasonreid/probatus/internal/middleware"
)

// rowsQuerier is the extra capability analytics needs on top of querier.
type rowsQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// MakeModelStat is calibration outcomes for one manufacturer + model.
type MakeModelStat struct {
	Manufacturer   string  `json:"manufacturer"`
	Model          string  `json:"model"`
	InstrumentType string  `json:"instrument_type"`
	Instruments    int     `json:"instruments"`
	Calibrations   int     `json:"calibrations"`
	Failures       int     `json:"failures"`
	FailRate       float64 `json:"fail_rate"` // 0–100
}

// MonthStat is calibration outcomes for one month.
type MonthStat struct {
	Month        string `json:"month"` // YYYY-MM
	Calibrations int    `json:"calibrations"`
	Failures     int    `json:"failures"`
}

// AssetCost is what one instrument has been billed over the window.
type AssetCost struct {
	AssetID        string  `json:"asset_id"`
	TagID          string  `json:"tag_id"`
	Manufacturer   string  `json:"manufacturer"`
	Model          string  `json:"model"`
	InstrumentType string  `json:"instrument_type"`
	Calibrations   int     `json:"calibrations"`
	Failures       int     `json:"failures"`
	TotalBilled    float64 `json:"total_billed"`
	CostPerYear    float64 `json:"cost_per_year"`
}

// AnalyticsResponse is returned by GET /stats/analytics.
type AnalyticsResponse struct {
	Months         int             `json:"months"`
	Calibrations   int             `json:"calibrations"`
	Failures       int             `json:"failures"`
	FailRate       float64         `json:"fail_rate"`
	TotalBilled    float64         `json:"total_billed"`
	ByMakeModel    []MakeModelStat `json:"by_make_model"`
	Monthly        []MonthStat     `json:"monthly"`
	CostByAsset    []AssetCost     `json:"cost_by_asset"`
	RepeatFailures []AssetCost     `json:"repeat_failures"` // instruments that failed 2+ times
}

// A calibration counts as failed when any of its measurement points failed.
// Only approved calibrations count — drafts and rejected work aren't outcomes.
const outcomesCTE = `
WITH outcomes AS (
	SELECT cr.id, cr.asset_id, cr.performed_at,
	       EXISTS (SELECT 1 FROM calibration_measurements m
	               WHERE m.record_id = cr.id AND m.pass = false) AS failed
	FROM calibration_records cr
	WHERE cr.tenant_id = $1 AND cr.status = 'approved'
	  AND cr.performed_at >= now() - make_interval(months => $2)
)`

// billedCTE sums non-void invoice lines per asset over the same window.
const billedCTE = `
billed AS (
	SELECT l.asset_id, SUM(ROUND(l.quantity * l.unit_price, 2)) AS amount
	FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
	WHERE i.tenant_id = $1 AND i.status <> 'void' AND l.asset_id IS NOT NULL
	  AND i.issue_date >= (now() - make_interval(months => $2))::date
	GROUP BY l.asset_id
)`

// Analytics returns failure rates by make/model, a monthly trend, and billed
// cost per instrument per year. ?months= sets the window (default 12, max 60).
func (h *Handler) Analytics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	role := middleware.RoleFromCtx(ctx)
	if role != "supervisor" && role != "admin" {
		writeError(w, http.StatusForbidden, "only supervisors and admins can view analytics")
		return
	}
	rq, ok := h.pool.(rowsQuerier)
	if !ok {
		writeError(w, http.StatusInternalServerError, "analytics unavailable")
		return
	}
	tenantID := middleware.TenantIDFromCtx(ctx)
	months := 12
	if n, err := strconv.Atoi(r.URL.Query().Get("months")); err == nil && n >= 1 && n <= 60 {
		months = n
	}
	years := float64(months) / 12
	resp := AnalyticsResponse{
		Months: months, ByMakeModel: []MakeModelStat{}, Monthly: []MonthStat{},
		CostByAsset: []AssetCost{}, RepeatFailures: []AssetCost{},
	}

	fail := func(step string, err error) {
		slog.Error("stats.Analytics: query failed", "step", step, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to compute analytics")
	}

	// By manufacturer / model
	rows, err := rq.Query(ctx, outcomesCTE+`
		SELECT COALESCE(NULLIF(a.manufacturer, ''), 'Unknown'), COALESCE(NULLIF(a.model, ''), '—'),
		       a.instrument_type::text, COUNT(DISTINCT a.id), COUNT(o.id),
		       COUNT(o.id) FILTER (WHERE o.failed)
		FROM outcomes o JOIN assets a ON a.id = o.asset_id
		GROUP BY 1, 2, 3
		ORDER BY COUNT(o.id) FILTER (WHERE o.failed)::float / NULLIF(COUNT(o.id), 0) DESC, COUNT(o.id) DESC
		LIMIT 50`, tenantID, months)
	if err != nil {
		fail("make_model", err)
		return
	}
	for rows.Next() {
		var s MakeModelStat
		if err := rows.Scan(&s.Manufacturer, &s.Model, &s.InstrumentType, &s.Instruments, &s.Calibrations, &s.Failures); err != nil {
			rows.Close()
			fail("make_model scan", err)
			return
		}
		if s.Calibrations > 0 {
			s.FailRate = pct(s.Failures, s.Calibrations)
		}
		resp.ByMakeModel = append(resp.ByMakeModel, s)
		resp.Calibrations += s.Calibrations
		resp.Failures += s.Failures
	}
	rows.Close()
	if resp.Calibrations > 0 {
		resp.FailRate = pct(resp.Failures, resp.Calibrations)
	}

	// Monthly trend
	rows, err = rq.Query(ctx, outcomesCTE+`
		SELECT to_char(date_trunc('month', performed_at), 'YYYY-MM'), COUNT(*), COUNT(*) FILTER (WHERE failed)
		FROM outcomes GROUP BY 1 ORDER BY 1`, tenantID, months)
	if err != nil {
		fail("monthly", err)
		return
	}
	for rows.Next() {
		var m MonthStat
		if err := rows.Scan(&m.Month, &m.Calibrations, &m.Failures); err != nil {
			rows.Close()
			fail("monthly scan", err)
			return
		}
		resp.Monthly = append(resp.Monthly, m)
	}
	rows.Close()

	// Cost and failures per instrument
	rows, err = rq.Query(ctx, outcomesCTE+`, `+billedCTE+`
		SELECT a.id::text, a.tag_id, COALESCE(a.manufacturer, ''), COALESCE(a.model, ''),
		       a.instrument_type::text,
		       (SELECT COUNT(*) FROM outcomes o WHERE o.asset_id = a.id),
		       (SELECT COUNT(*) FROM outcomes o WHERE o.asset_id = a.id AND o.failed),
		       COALESCE(b.amount, 0)::float8
		FROM assets a LEFT JOIN billed b ON b.asset_id = a.id
		WHERE a.tenant_id = $1
		  AND (b.amount IS NOT NULL OR EXISTS (SELECT 1 FROM outcomes o WHERE o.asset_id = a.id AND o.failed))
		ORDER BY COALESCE(b.amount, 0) DESC, a.tag_id
		LIMIT 200`, tenantID, months)
	if err != nil {
		fail("cost", err)
		return
	}
	for rows.Next() {
		var c AssetCost
		if err := rows.Scan(&c.AssetID, &c.TagID, &c.Manufacturer, &c.Model, &c.InstrumentType,
			&c.Calibrations, &c.Failures, &c.TotalBilled); err != nil {
			rows.Close()
			fail("cost scan", err)
			return
		}
		c.CostPerYear = round2(c.TotalBilled / years)
		resp.TotalBilled += c.TotalBilled
		if c.TotalBilled > 0 && len(resp.CostByAsset) < 25 {
			resp.CostByAsset = append(resp.CostByAsset, c)
		}
		if c.Failures >= 2 {
			resp.RepeatFailures = append(resp.RepeatFailures, c)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		fail("cost rows", err)
		return
	}
	resp.TotalBilled = round2(resp.TotalBilled)
	writeJSON(w, http.StatusOK, resp)
}

func pct(n, d int) float64 { return round2(float64(n) * 100 / float64(d)) }

func round2(v float64) float64 {
	if v < 0 {
		return -round2(-v)
	}
	return float64(int64(v*100+0.5)) / 100
}
