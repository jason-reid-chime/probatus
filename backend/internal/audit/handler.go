package audit

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jasonreid/probatus/internal/middleware"
)

// Handler holds the DB pool for the audit resource.
type Handler struct {
	pool *pgxpool.Pool
}

// NewHandler creates a new audit Handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// GenerateRequest is the JSON body for the audit package endpoint.
type GenerateRequest struct {
	StartDate  string `json:"start_date"`
	EndDate    string `json:"end_date"`
	CustomerID string `json:"customer_id"`
}

type auditStandard struct {
	Name           string
	SerialNumber   string
	CertificateRef string
	CalibratedAt   string
	DueAt          string
	IsExpired      bool
}

type auditMeasurement struct {
	PointLabel    string
	StandardValue string
	MeasuredValue string
	Unit          string
	ErrorPct      string
	Pass          *bool
}

type auditRecord struct {
	ID               string
	AssetTagID       string
	AssetDescription string
	InstrumentType   string
	CustomerName     string
	PerformedAt      string
	TechnicianName   string
	SupervisorName   string
	Status           string
	SalesNumber      string
	Measurements     []auditMeasurement
	StandardsUsed    []string
	OverallPass      *bool
}

type auditAsset struct {
	TagID          string
	Manufacturer   string
	Model          string
	InstrumentType string
	Range          string
	LastCal        string
	NextDue        string
	IsOverdue      bool
}

type auditData struct {
	TenantName    string
	StartDate     string
	EndDate       string
	GeneratedAt   string
	TotalRecords  int
	PassCount     int
	FailCount     int
	PendingCount  int
	InProgCount   int
	TotalAssets   int
	OverdueAssets int
	Standards     []auditStandard
	ExpiredStds   int
	Records       []auditRecord
	Assets        []auditAsset
	CustomerName  string // if filtered
}

const auditHTMLTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  @page { margin: 18mm 20mm; }
  @media print { .page-break { page-break-after: always; } }
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; margin: 0; }
  /* Cover */
  .cover { text-align: center; padding: 80px 40px; }
  .cover-logo { font-size: 28px; font-weight: bold; color: #1e3a5f; letter-spacing: 3px; margin-bottom: 8px; }
  .cover-title { font-size: 22px; font-weight: bold; color: #1e3a5f; margin: 24px 0 8px; }
  .cover-sub { font-size: 14px; color: #555; margin-bottom: 40px; }
  .cover-meta { display: inline-block; text-align: left; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 6px; padding: 20px 32px; margin-top: 16px; }
  .cover-meta-row { margin: 6px 0; font-size: 12px; }
  .cover-meta-label { font-weight: bold; color: #374151; display: inline-block; width: 140px; }
  .cover-iso { margin-top: 48px; font-size: 10px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 16px; }
  /* Headings */
  h2 { font-size: 15px; color: #1e3a5f; border-bottom: 2px solid #1e3a5f; padding-bottom: 4px; margin: 0 0 14px; }
  h3 { font-size: 12px; color: #374151; margin: 16px 0 6px; }
  /* Summary cards */
  .summary-grid { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
  .stat-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 18px; min-width: 130px; flex: 1; }
  .stat-card .val { font-size: 24px; font-weight: bold; color: #1e3a5f; }
  .stat-card .lbl { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .stat-card.red { border-color: #fca5a5; background: #fef2f2; }
  .stat-card.red .val { color: #dc2626; }
  .stat-card.green { border-color: #86efac; background: #f0fdf4; }
  .stat-card.green .val { color: #16a34a; }
  .stat-card.amber { border-color: #fcd34d; background: #fffbeb; }
  .stat-card.amber .val { color: #d97706; }
  /* Tables */
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 10px; }
  th { background: #1e3a5f; color: #fff; padding: 6px 8px; text-align: left; font-size: 10px; }
  td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  tr:nth-child(even) td { background: #f9fafb; }
  tr.expired td { background: #fef2f2; }
  tr.overdue td { background: #fef2f2; }
  /* Record blocks */
  .record-block { border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 16px; overflow: hidden; }
  .record-header { background: #f3f4f6; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; }
  .record-header-left { font-weight: bold; font-size: 11px; color: #1e3a5f; }
  .record-header-right { font-size: 10px; color: #6b7280; }
  .record-body { padding: 10px 12px; }
  .record-meta { display: flex; flex-wrap: wrap; gap: 4px 24px; margin-bottom: 8px; font-size: 10px; }
  .record-meta-item .lbl { color: #6b7280; }
  .result-banner { display: inline-block; padding: 3px 14px; border-radius: 4px; font-weight: bold; font-size: 11px; margin-bottom: 8px; }
  .result-pass { background: #dcfce7; color: #16a34a; border: 1px solid #86efac; }
  .result-fail { background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; }
  .result-incomplete { background: #f3f4f6; color: #6b7280; border: 1px solid #d1d5db; }
  /* Status badges */
  .badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 9px; font-weight: bold; }
  .badge-approved { background: #dcfce7; color: #16a34a; }
  .badge-pending { background: #dbeafe; color: #1d4ed8; }
  .badge-progress { background: #fef9c3; color: #854d0e; }
  .badge-expired { background: #fee2e2; color: #dc2626; }
  /* Traceability */
  .traceability-box { background: #f0f4ff; border: 1px solid #c7d2fe; border-radius: 6px; padding: 12px 16px; margin: 16px 0; font-size: 10px; line-height: 1.6; color: #374151; }
  /* Footer note */
  .section-note { font-size: 9px; color: #9ca3af; margin-bottom: 10px; }
  .page-section { margin-bottom: 0; }
</style>
</head>
<body>

<!-- ═══════════════════════════ COVER PAGE ═══════════════════════════ -->
<div class="cover page-break">
  <div class="cover-logo">PROBATUS</div>
  <div style="font-size:11px;color:#9ca3af;letter-spacing:2px;margin-bottom:40px;">CALIBRATION MANAGEMENT</div>
  <div class="cover-title">CALIBRATION AUDIT PACKAGE</div>
  <div class="cover-sub">{{.TenantName}}{{if .CustomerName}} — {{.CustomerName}}{{end}}</div>
  <div class="cover-meta">
    <div class="cover-meta-row"><span class="cover-meta-label">Prepared for:</span>{{.TenantName}}</div>
    <div class="cover-meta-row"><span class="cover-meta-label">Audit period:</span>{{.StartDate}} to {{.EndDate}}</div>
    <div class="cover-meta-row"><span class="cover-meta-label">Generated:</span>{{.GeneratedAt}}</div>
    <div class="cover-meta-row"><span class="cover-meta-label">Total records:</span>{{.TotalRecords}}</div>
    <div class="cover-meta-row"><span class="cover-meta-label">Total assets:</span>{{.TotalAssets}}</div>
  </div>
  <div class="cover-iso">
    Prepared in accordance with ISO/IEC 17025:2017 — General requirements for the competence of testing and calibration laboratories.<br/>
    All measurements are traceable to national measurement standards maintained by the National Research Council of Canada (NRC).
  </div>
</div>

<!-- ════════════════════════ EXECUTIVE SUMMARY ════════════════════════ -->
<div class="page-section page-break">
  <h2>Executive Summary</h2>
  <div class="summary-grid">
    <div class="stat-card"><div class="val">{{.TotalRecords}}</div><div class="lbl">Total Calibrations</div></div>
    <div class="stat-card green"><div class="val">{{.PassCount}}</div><div class="lbl">Passed</div></div>
    <div class="stat-card red"><div class="val">{{.FailCount}}</div><div class="lbl">Failed</div></div>
    <div class="stat-card amber"><div class="val">{{.PendingCount}}</div><div class="lbl">Pending Approval</div></div>
    <div class="stat-card"><div class="val">{{.TotalAssets}}</div><div class="lbl">Instruments Managed</div></div>
    <div class="stat-card red"><div class="val">{{.OverdueAssets}}</div><div class="lbl">Instruments Overdue</div></div>
    <div class="stat-card"><div class="val">{{len .Standards}}</div><div class="lbl">Master Standards</div></div>
    <div class="stat-card {{if gt .ExpiredStds 0}}red{{end}}"><div class="val">{{.ExpiredStds}}</div><div class="lbl">Expired Standards</div></div>
  </div>
</div>

<!-- ════════════════════ MASTER STANDARDS & TRACEABILITY ════════════════════ -->
<div class="page-section page-break">
  <h2>Master Standards &amp; Traceability</h2>
  <div class="traceability-box">
    <strong>Traceability Statement (ISO/IEC 17025:2017 Clause 6.5)</strong><br/>
    All measurements performed by {{.TenantName}} are traceable to national measurement standards
    maintained by the National Research Council of Canada (NRC) through an unbroken chain of
    comparisons, each with stated measurement uncertainties, in accordance with ISO/IEC 17025:2017.
    The reference standards listed below were used for calibrations within the stated audit period.
  </div>
  {{if .Standards}}
  <table>
    <thead>
      <tr>
        <th>Standard Name</th>
        <th>Serial Number</th>
        <th>Certificate Ref</th>
        <th>Calibrated</th>
        <th>Due Date</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {{range .Standards}}
      <tr {{if .IsExpired}}class="expired"{{end}}>
        <td>{{.Name}}</td>
        <td>{{.SerialNumber}}</td>
        <td>{{.CertificateRef}}</td>
        <td>{{.CalibratedAt}}</td>
        <td>{{.DueAt}}</td>
        <td>{{if .IsExpired}}<span class="badge badge-expired">EXPIRED</span>{{else}}<span class="badge badge-approved">VALID</span>{{end}}</td>
      </tr>
      {{end}}
    </tbody>
  </table>
  {{else}}
  <p style="color:#9ca3af;font-style:italic;">No master standards recorded for this tenant.</p>
  {{end}}
</div>

<!-- ═════════════════════════ CALIBRATION RECORDS ═════════════════════════ -->
<div class="page-section page-break">
  <h2>Calibration Records</h2>
  <p class="section-note">Records performed between {{.StartDate}} and {{.EndDate}}. Total: {{.TotalRecords}}.</p>
  {{if .Records}}
  {{range .Records}}
  <div class="record-block">
    <div class="record-header">
      <div class="record-header-left">{{.AssetTagID}} — {{.AssetDescription}}</div>
      <div class="record-header-right">{{.PerformedAt}}{{if .CustomerName}} &bull; {{.CustomerName}}{{end}}</div>
    </div>
    <div class="record-body">
      <div class="record-meta">
        <div class="record-meta-item"><span class="lbl">Technician: </span>{{.TechnicianName}}</div>
        {{if .SupervisorName}}<div class="record-meta-item"><span class="lbl">Supervisor: </span>{{.SupervisorName}}</div>{{end}}
        <div class="record-meta-item"><span class="lbl">Status: </span>
          {{if eq .Status "approved"}}<span class="badge badge-approved">APPROVED</span>
          {{else if eq .Status "pending_approval"}}<span class="badge badge-pending">PENDING</span>
          {{else}}<span class="badge badge-progress">IN PROGRESS</span>{{end}}
        </div>
        {{if .SalesNumber}}<div class="record-meta-item"><span class="lbl">Sales #: </span>{{.SalesNumber}}</div>{{end}}
        {{if .StandardsUsed}}<div class="record-meta-item"><span class="lbl">Standards: </span>{{range $i,$s := .StandardsUsed}}{{if $i}}, {{end}}{{$s}}{{end}}</div>{{end}}
      </div>
      {{if .OverallPass}}
        {{if derefBool .OverallPass}}<div class="result-banner result-pass">✓ PASS</div>
        {{else}}<div class="result-banner result-fail">✗ FAIL</div>{{end}}
      {{else}}<div class="result-banner result-incomplete">— INCOMPLETE</div>{{end}}
      {{if .Measurements}}
      <table>
        <thead>
          <tr><th>Point</th><th>Standard</th><th>Measured</th><th>Unit</th><th>Error %</th><th>Result</th></tr>
        </thead>
        <tbody>
          {{range .Measurements}}
          <tr>
            <td>{{.PointLabel}}</td>
            <td>{{.StandardValue}}</td>
            <td>{{.MeasuredValue}}</td>
            <td>{{.Unit}}</td>
            <td>{{.ErrorPct}}</td>
            <td>{{if .Pass}}{{if derefBool .Pass}}<span style="color:#16a34a;font-weight:bold;">PASS</span>{{else}}<span style="color:#dc2626;font-weight:bold;">FAIL</span>{{end}}{{else}}—{{end}}</td>
          </tr>
          {{end}}
        </tbody>
      </table>
      {{end}}
    </div>
  </div>
  {{end}}
  {{else}}
  <p style="color:#9ca3af;font-style:italic;">No calibration records found for the selected period.</p>
  {{end}}
</div>

<!-- ══════════════════════════ ASSET REGISTER ══════════════════════════ -->
<div class="page-section">
  <h2>Asset Register</h2>
  <p class="section-note">All instruments under calibration management as of {{.EndDate}}. Total: {{.TotalAssets}}.</p>
  {{if .Assets}}
  <table>
    <thead>
      <tr>
        <th>Tag ID</th>
        <th>Manufacturer</th>
        <th>Model</th>
        <th>Type</th>
        <th>Range</th>
        <th>Last Calibrated</th>
        <th>Next Due</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {{range .Assets}}
      <tr {{if .IsOverdue}}class="overdue"{{end}}>
        <td>{{.TagID}}</td>
        <td>{{.Manufacturer}}</td>
        <td>{{.Model}}</td>
        <td>{{.InstrumentType}}</td>
        <td>{{.Range}}</td>
        <td>{{.LastCal}}</td>
        <td>{{.NextDue}}</td>
        <td>{{if .IsOverdue}}<span class="badge badge-expired">OVERDUE</span>{{else}}<span class="badge badge-approved">CURRENT</span>{{end}}</td>
      </tr>
      {{end}}
    </tbody>
  </table>
  {{else}}
  <p style="color:#9ca3af;font-style:italic;">No assets found.</p>
  {{end}}
  <div style="margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:9px;color:#9ca3af;text-align:center;">
    {{.TenantName}} &bull; Probatus Calibration Management &bull; Generated {{.GeneratedAt}} &bull; ISO/IEC 17025:2017
  </div>
</div>

</body>
</html>`

// Generate builds a full audit PDF via Gotenberg and streams it back.
func (h *Handler) Generate(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())

	var req GenerateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.StartDate == "" || req.EndDate == "" {
		writeError(w, http.StatusBadRequest, "start_date and end_date are required")
		return
	}

	today := time.Now().UTC().Format("2006-01-02")

	data := auditData{
		StartDate:   req.StartDate,
		EndDate:     req.EndDate,
		GeneratedAt: time.Now().UTC().Format("2006-01-02 15:04 UTC"),
	}

	// 1. Tenant name
	h.pool.QueryRow(r.Context(),
		`SELECT name FROM tenants WHERE id = $1`, tenantID,
	).Scan(&data.TenantName)

	// 2. Customer name if filtered
	if req.CustomerID != "" {
		h.pool.QueryRow(r.Context(),
			`SELECT name FROM customers WHERE id = $1 AND tenant_id = $2`,
			req.CustomerID, tenantID,
		).Scan(&data.CustomerName)
	}

	// 3. Master standards
	stdRows, err := h.pool.Query(r.Context(),
		`SELECT name, serial_number, COALESCE(certificate_ref,''), calibrated_at, due_at
		 FROM master_standards WHERE tenant_id = $1 ORDER BY due_at`,
		tenantID,
	)
	if err == nil {
		defer stdRows.Close()
		for stdRows.Next() {
			var s auditStandard
			var calAt, dueAt time.Time
			if err := stdRows.Scan(&s.Name, &s.SerialNumber, &s.CertificateRef, &calAt, &dueAt); err == nil {
				s.CalibratedAt = calAt.Format("2006-01-02")
				s.DueAt = dueAt.Format("2006-01-02")
				s.IsExpired = dueAt.Format("2006-01-02") < today
				if s.IsExpired {
					data.ExpiredStds++
				}
				data.Standards = append(data.Standards, s)
			}
		}
		stdRows.Close()
	}

	// 4. Calibration records
	recQuery := `
		SELECT cr.id::text, cr.status, COALESCE(cr.sales_number,''), cr.performed_at,
		       a.tag_id, COALESCE(a.manufacturer,'') || ' ' || COALESCE(a.model,''),
		       a.instrument_type, COALESCE(c.name,''),
		       COALESCE(tp.full_name,''), COALESCE(sp.full_name,'')
		FROM calibration_records cr
		JOIN assets a ON a.id = cr.asset_id
		LEFT JOIN customers c ON c.id = a.customer_id
		LEFT JOIN profiles tp ON tp.id = cr.technician_id
		LEFT JOIN profiles sp ON sp.id = cr.supervisor_id
		WHERE cr.tenant_id = $1
		  AND cr.performed_at::date BETWEEN $2::date AND $3::date`
	args := []any{tenantID, req.StartDate, req.EndDate}
	if req.CustomerID != "" {
		recQuery += ` AND a.customer_id = $4`
		args = append(args, req.CustomerID)
	}
	recQuery += ` ORDER BY cr.performed_at DESC`

	recRows, err := h.pool.Query(r.Context(), recQuery, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load calibration records")
		return
	}
	defer recRows.Close()

	for recRows.Next() {
		var rec auditRecord
		var performedAt time.Time
		if err := recRows.Scan(
			&rec.ID, &rec.Status, &rec.SalesNumber, &performedAt,
			&rec.AssetTagID, &rec.AssetDescription, &rec.InstrumentType, &rec.CustomerName,
			&rec.TechnicianName, &rec.SupervisorName,
		); err != nil {
			continue
		}
		rec.PerformedAt = performedAt.Format("2006-01-02 15:04")

		// Measurements
		mRows, err := h.pool.Query(r.Context(),
			`SELECT point_label, COALESCE(standard_value::text,''), COALESCE(measured_value::text,''),
			        COALESCE(unit,''), COALESCE(error_pct::text,''), pass
			 FROM calibration_measurements WHERE record_id = $1 ORDER BY id`,
			rec.ID,
		)
		if err == nil {
			allPass := true
			hasMeasurements := false
			for mRows.Next() {
				var m auditMeasurement
				if err := mRows.Scan(&m.PointLabel, &m.StandardValue, &m.MeasuredValue, &m.Unit, &m.ErrorPct, &m.Pass); err == nil {
					rec.Measurements = append(rec.Measurements, m)
					hasMeasurements = true
					if m.Pass != nil && !*m.Pass {
						allPass = false
					}
				}
			}
			mRows.Close()
			if hasMeasurements {
				rec.OverallPass = &allPass
			}
		}

		// Standards used
		sRows, _ := h.pool.Query(r.Context(),
			`SELECT ms.name FROM calibration_standards_used csu
			 JOIN master_standards ms ON ms.id = csu.standard_id
			 WHERE csu.record_id = $1`, rec.ID,
		)
		if sRows != nil {
			for sRows.Next() {
				var name string
				if err := sRows.Scan(&name); err == nil {
					rec.StandardsUsed = append(rec.StandardsUsed, name)
				}
			}
			sRows.Close()
		}

		// Tally summary stats
		data.TotalRecords++
		if rec.OverallPass != nil {
			if *rec.OverallPass {
				data.PassCount++
			} else {
				data.FailCount++
			}
		}
		if rec.Status == "pending_approval" {
			data.PendingCount++
		} else if rec.Status == "in_progress" {
			data.InProgCount++
		}

		data.Records = append(data.Records, rec)
	}
	recRows.Close()

	// 5. Asset register
	assetQuery := `
		SELECT tag_id, COALESCE(manufacturer,''), COALESCE(model,''), instrument_type,
		       COALESCE(range_min::text,'') || COALESCE(' – '||range_max::text,'') || COALESCE(' '||range_unit,''),
		       COALESCE(last_calibrated_at::text,''), COALESCE(next_due_at::text,''),
		       COALESCE(next_due_at::text,'') < $2
		FROM assets WHERE tenant_id = $1`
	assetArgs := []any{tenantID, today}
	if req.CustomerID != "" {
		assetQuery += ` AND customer_id = $3`
		assetArgs = append(assetArgs, req.CustomerID)
	}
	assetQuery += ` ORDER BY next_due_at ASC NULLS LAST`

	aRows, err := h.pool.Query(r.Context(), assetQuery, assetArgs...)
	if err == nil {
		defer aRows.Close()
		for aRows.Next() {
			var a auditAsset
			if err := aRows.Scan(&a.TagID, &a.Manufacturer, &a.Model, &a.InstrumentType,
				&a.Range, &a.LastCal, &a.NextDue, &a.IsOverdue); err == nil {
				data.TotalAssets++
				if a.IsOverdue && a.NextDue != "" {
					data.OverdueAssets++
				}
				data.Assets = append(data.Assets, a)
			}
		}
		aRows.Close()
	}

	// Render HTML template
	funcMap := template.FuncMap{
		"derefBool": func(b *bool) bool {
			if b == nil {
				return false
			}
			return *b
		},
	}
	tmpl, err := template.New("audit").Funcs(funcMap).Parse(auditHTMLTemplate)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to parse audit template")
		return
	}

	var htmlBuf bytes.Buffer
	if err := tmpl.Execute(&htmlBuf, data); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to render audit template")
		return
	}

	// Call Gotenberg
	gotenbergURL := os.Getenv("GOTENBERG_URL")
	if gotenbergURL == "" {
		gotenbergURL = "http://localhost:3000"
	}
	endpoint := gotenbergURL + "/forms/chromium/convert/html"

	var mpBuf bytes.Buffer
	mpw := multipart.NewWriter(&mpBuf)
	filePart, err := mpw.CreateFormFile("files", "index.html")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build multipart request")
		return
	}
	filePart.Write(htmlBuf.Bytes())
	mpw.Close()

	httpReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint,
		bytes.NewReader(mpBuf.Bytes()))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create Gotenberg request")
		return
	}
	httpReq.Header.Set("Content-Type", mpw.FormDataContentType())

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Gotenberg request failed: %v", err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway,
			fmt.Sprintf("Gotenberg returned status %d", resp.StatusCode))
		return
	}

	filename := fmt.Sprintf("audit-package-%s.pdf", time.Now().UTC().Format("2006-01-02"))
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.WriteHeader(http.StatusOK)
	io.Copy(w, resp.Body)
}
