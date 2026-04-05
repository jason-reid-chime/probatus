package certificates

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

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jasonreid/probatus/internal/middleware"
)

// Handler holds the DB pool for the certificates resource.
type Handler struct {
	pool *pgxpool.Pool
}

// NewHandler creates a new certificates Handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// certData holds all data needed to render the certificate template.
type certData struct {
	// Record fields
	RecordID    string
	LocalID     string
	SalesNumber string
	FlagNumber  string
	PerformedAt time.Time
	ApprovedAt  *time.Time
	Status      string
	Notes       string

	// Technician
	TechName      string
	TechSignature string

	// Supervisor
	SupervisorName string
	SupervisorSig  string

	// Asset
	AssetTag       string
	SerialNumber   string
	Manufacturer   string
	Model          string
	InstrumentType string
	Location       string
	RangeMin       *float64
	RangeMax       *float64
	RangeUnit      string

	// Customer
	CustomerName    string
	CustomerContact string

	// Measurements
	Measurements []measurementRow

	// Standards used
	Standards []standardRow

	// Meta
	TenantName  string
	GeneratedAt time.Time
}

type measurementRow struct {
	PointLabel    string
	StandardValue float64
	MeasuredValue float64
	Unit          string
	ErrorPct      float64
	Pass          bool
	Notes         string
}

type standardRow struct {
	Name           string
	SerialNumber   string
	Model          string
	Manufacturer   string
	CertificateRef string
	DueAt          *time.Time
}

const certHTMLTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 10px; margin: 20px 28px; color: #111; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
  .header-left { font-size: 13px; font-weight: bold; line-height: 1.5; }
  .header-left .company-name { font-size: 15px; font-weight: bold; }
  .header-right { font-size: 9px; text-align: right; color: #444; line-height: 1.5; }
  .cert-title { text-align: center; font-size: 16px; font-weight: bold; border: 2px solid #111;
                padding: 5px; margin: 8px 0; letter-spacing: 1px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #999; }
  .grid2-left { border-right: 1px solid #999; }
  .section-hdr { background: #ddd; font-weight: bold; padding: 3px 6px; border-bottom: 1px solid #999; font-size: 10px; }
  .kv-table { width: 100%; border-collapse: collapse; }
  .kv-table td { padding: 3px 6px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
  .kv-table td:first-child { font-weight: bold; width: 42%; white-space: nowrap; }
  .device-row { border: 1px solid #999; border-top: none; }
  .device-inner { padding: 4px 6px; }
  .device-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; }
  .device-cell { padding: 3px 6px; border-right: 1px solid #e0e0e0; }
  .device-cell:last-child { border-right: none; }
  .device-label { font-weight: bold; display: block; font-size: 9px; color: #555; }
  .trace { font-size: 9px; color: #333; margin: 6px 0; line-height: 1.4; border: 1px solid #ccc; padding: 5px 6px; }
  table.data { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.data th { background: #333; color: #fff; padding: 4px 6px; text-align: left; font-size: 9px; border: 1px solid #555; }
  table.data td { padding: 3px 6px; border: 1px solid #ccc; font-size: 10px; }
  table.data tr:nth-child(even) td { background: #f5f5f5; }
  .pass { color: #1a7a3a; font-weight: bold; }
  .fail { color: #b00020; font-weight: bold; }
  .bottom-grid { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #999; margin-top: 8px; }
  .bottom-left { border-right: 1px solid #999; }
  .sig-line { border-top: 1px solid #555; margin: 18px 10px 2px; }
  .sig-label { font-size: 9px; color: #555; padding: 0 10px; }
  .footer { margin-top: 10px; font-size: 8px; color: #888; text-align: center; border-top: 1px solid #ddd; padding-top: 4px; }
  .section-block { border: 1px solid #999; margin-top: 6px; }
  .section-block-content { padding: 4px; }
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div class="header-left">
    <div class="company-name">{{.TenantName}}</div>
    <div>Calibration Services</div>
  </div>
  <div class="header-right">
    {{if .CustomerName}}{{.CustomerName}}<br/>{{end}}
    {{if .Location}}{{.Location}}<br/>{{end}}
  </div>
</div>

<div class="cert-title">Calibration Certificate</div>

<!-- Internal Data | Customer Data -->
<div class="grid2">
  <div class="grid2-left">
    <div class="section-hdr">Internal Data</div>
    <table class="kv-table">
      <tr><td>Calibration #</td><td>{{.LocalID}}</td></tr>
      <tr><td>Sales Number</td><td>{{.SalesNumber}}</td></tr>
      <tr><td>Flag Number</td><td>{{.FlagNumber}}</td></tr>
    </table>
  </div>
  <div>
    <div class="section-hdr">Customer Data</div>
    <table class="kv-table">
      <tr><td>Customer</td><td>{{if .CustomerName}}{{.CustomerName}}{{else}}&mdash;{{end}}</td></tr>
      <tr><td>Location</td><td>{{if .Location}}{{.Location}}{{else}}&mdash;{{end}}</td></tr>
      <tr><td>Device Tag</td><td>{{.AssetTag}}</td></tr>
    </table>
  </div>
</div>

<!-- Device / Instrument Info -->
<div class="device-row">
  <div class="device-inner">
    <div class="device-grid">
      <div class="device-cell"><span class="device-label">Description / Type</span>{{.InstrumentType}}</div>
      <div class="device-cell"><span class="device-label">Make</span>{{.Manufacturer}}</div>
      <div class="device-cell"><span class="device-label">Model</span>{{.Model}}</div>
    </div>
    <div class="device-grid" style="margin-top:3px;">
      <div class="device-cell"><span class="device-label">Serial Number</span>{{.SerialNumber}}</div>
      <div class="device-cell"><span class="device-label">Range</span>
        {{if and .RangeMin .RangeMax}}{{printf "%.4g" (deref .RangeMin)}} &ndash; {{printf "%.4g" (deref .RangeMax)}} {{.RangeUnit}}{{else}}&mdash;{{end}}
      </div>
      <div class="device-cell"></div>
    </div>
  </div>
</div>

<!-- Traceability Statement -->
<div class="trace">
  {{.TenantName}} certifies that the accuracies of the measuring equipment used in effecting the
  calibration of the above equipment is traceable to nationally recognized standards, either those of
  the National Research Council (NRC) or the NIST, or have been derived from accepted values of
  natural physical constants.
</div>

{{if .Standards}}
<!-- Standards -->
<div class="section-block">
  <div class="section-hdr">Standards</div>
  <div class="section-block-content">
    <table class="data">
      <thead>
        <tr>
          <th>Type</th>
          <th>Instrument Serial Number</th>
          <th>Certificate Ref</th>
          <th>Date Calibrated</th>
          <th>Next Date Calibrated</th>
        </tr>
      </thead>
      <tbody>
        {{range .Standards}}
        <tr>
          <td>{{.Name}}{{if .Model}} {{.Model}}{{end}}</td>
          <td>{{.SerialNumber}}</td>
          <td>{{.CertificateRef}}</td>
          <td>&mdash;</td>
          <td>{{if .DueAt}}{{.DueAt.Format "02/Jan/2006"}}{{else}}&mdash;{{end}}</td>
        </tr>
        {{end}}
      </tbody>
    </table>
  </div>
</div>
{{end}}

<!-- Calibration Results -->
<div class="section-block">
  <div class="section-hdr">Calibration Results</div>
  <div class="section-block-content">
    <table class="data">
      <thead>
        <tr>
          <th>Point</th>
          <th>Applied Value</th>
          <th>As Found</th>
          <th>As Left</th>
          <th>Unit</th>
          <th>Error %</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {{range .Measurements}}
        <tr>
          <td>{{.PointLabel}}</td>
          <td>{{printf "%.6g" .StandardValue}}</td>
          <td>{{printf "%.6g" .MeasuredValue}}</td>
          <td>{{printf "%.6g" .MeasuredValue}}</td>
          <td>{{.Unit}}</td>
          <td>{{printf "%.4f" .ErrorPct}}</td>
          <td>{{if .Pass}}<span class="pass">PASS</span>{{else}}<span class="fail">FAIL</span>{{end}}</td>
        </tr>
        {{end}}
      </tbody>
    </table>
  </div>
</div>

{{if .Notes}}
<div class="section-block" style="margin-top:6px;">
  <div class="section-hdr">Notes</div>
  <div class="section-block-content">{{.Notes}}</div>
</div>
{{end}}

<!-- Technician / Dates -->
<div class="bottom-grid">
  <div class="bottom-left">
    <div class="section-hdr">Technician</div>
    <table class="kv-table">
      <tr><td>Completed by</td><td>{{.TechName}}</td></tr>
      {{if .SupervisorName}}<tr><td>Approved by</td><td>{{.SupervisorName}}</td></tr>{{end}}
    </table>
    <div class="sig-line"></div>
    <div class="sig-label">Signature</div>
    <div style="height:12px;"></div>
  </div>
  <div>
    <div class="section-hdr">Calibration Date</div>
    <table class="kv-table">
      <tr><td>Date Completed</td><td>{{.PerformedAt.Format "02/Jan/2006"}}</td></tr>
      <tr><td>Recal Date</td><td>{{recalDate .PerformedAt}}</td></tr>
      {{if .ApprovedAt}}<tr><td>Date Approved</td><td>{{.ApprovedAt.Format "02/Jan/2006"}}</td></tr>{{end}}
    </table>
  </div>
</div>

<div class="footer">
  {{.TenantName}} &bull; Calibration Services &bull;
  This certificate shall not be reproduced except in full without written approval of the issuing laboratory.
  &bull; Generated: {{.GeneratedAt.Format "2006-01-02 15:04 UTC"}}
</div>
</body>
</html>`

// Generate builds a PDF calibration certificate via Gotenberg and streams it back.
func (h *Handler) Generate(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	// --- Load calibration record ---
	var data certData
	var techID, supervisorID string
	err := h.pool.QueryRow(r.Context(),
		`SELECT id::text, local_id, sales_number, flag_number, performed_at, approved_at,
		        status, tech_signature, supervisor_signature, notes,
		        technician_id::text, COALESCE(supervisor_id::text,'')
		 FROM calibration_records
		 WHERE id = $1 AND tenant_id = $2`,
		id, tenantID,
	).Scan(
		&data.RecordID, &data.LocalID, &data.SalesNumber, &data.FlagNumber,
		&data.PerformedAt, &data.ApprovedAt, &data.Status,
		&data.TechSignature, &data.SupervisorSig, &data.Notes,
		&techID, &supervisorID,
	)
	if err != nil {
		writeError(w, http.StatusNotFound, "calibration not found")
		return
	}

	// --- Load asset + customer ---
	var assetID string
	err = h.pool.QueryRow(r.Context(),
		`SELECT cr.asset_id::text, a.tag_id, a.serial_number, a.manufacturer, a.model,
		        a.instrument_type, a.location, a.range_min, a.range_max, a.range_unit,
		        COALESCE(c.name,''), COALESCE(c.contact,'')
		 FROM calibration_records cr
		 JOIN assets a ON a.id = cr.asset_id
		 LEFT JOIN customers c ON c.id = a.customer_id AND c.tenant_id = cr.tenant_id
		 WHERE cr.id = $1 AND cr.tenant_id = $2`,
		id, tenantID,
	).Scan(
		&assetID, &data.AssetTag, &data.SerialNumber, &data.Manufacturer,
		&data.Model, &data.InstrumentType, &data.Location,
		&data.RangeMin, &data.RangeMax, &data.RangeUnit,
		&data.CustomerName, &data.CustomerContact,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load asset details")
		return
	}

	// --- Load tenant name ---
	h.pool.QueryRow(r.Context(),
		`SELECT name FROM tenants WHERE id = $1`, tenantID,
	).Scan(&data.TenantName)
	if data.TenantName == "" {
		data.TenantName = "Calibration Services"
	}

	// --- Load technician profile ---
	h.pool.QueryRow(r.Context(),
		`SELECT full_name FROM profiles WHERE id = $1`,
		techID,
	).Scan(&data.TechName)

	// --- Load supervisor profile ---
	if supervisorID != "" {
		h.pool.QueryRow(r.Context(),
			`SELECT full_name FROM profiles WHERE id = $1`,
			supervisorID,
		).Scan(&data.SupervisorName)
	}

	// --- Load measurements ---
	mRows, err := h.pool.Query(r.Context(),
		`SELECT point_label, standard_value, measured_value, unit, error_pct, pass, notes
		 FROM calibration_measurements WHERE record_id = $1 ORDER BY id`,
		id,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load measurements")
		return
	}
	defer mRows.Close()
	for mRows.Next() {
		var m measurementRow
		if err := mRows.Scan(&m.PointLabel, &m.StandardValue, &m.MeasuredValue,
			&m.Unit, &m.ErrorPct, &m.Pass, &m.Notes); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to scan measurement")
			return
		}
		data.Measurements = append(data.Measurements, m)
	}
	mRows.Close()

	// --- Load standards used ---
	sRows, err := h.pool.Query(r.Context(),
		`SELECT ms.name, ms.serial_number, ms.model, ms.manufacturer, ms.certificate_ref, ms.due_at
		 FROM calibration_standards_used csu
		 JOIN master_standards ms ON ms.id = csu.standard_id
		 WHERE csu.record_id = $1`,
		id,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load standards")
		return
	}
	defer sRows.Close()
	for sRows.Next() {
		var s standardRow
		if err := sRows.Scan(&s.Name, &s.SerialNumber, &s.Model, &s.Manufacturer,
			&s.CertificateRef, &s.DueAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to scan standard")
			return
		}
		data.Standards = append(data.Standards, s)
	}
	sRows.Close()

	data.GeneratedAt = time.Now().UTC()

	// --- Render HTML template ---
	funcMap := template.FuncMap{
		"deref": func(f *float64) float64 {
			if f == nil {
				return 0
			}
			return *f
		},
		"recalDate": func(t time.Time) string {
			return t.AddDate(1, 0, 0).Format("02/Jan/2006")
		},
	}
	tmpl, err := template.New("cert").Funcs(funcMap).Parse(certHTMLTemplate)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to parse certificate template")
		return
	}

	var htmlBuf bytes.Buffer
	if err := tmpl.Execute(&htmlBuf, data); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to render certificate template")
		return
	}

	// --- Call Gotenberg ---
	gotenbergURL := os.Getenv("GOTENBERG_URL")
	if gotenbergURL == "" {
		gotenbergURL = "http://localhost:3000"
	}
	endpoint := gotenbergURL + "/forms/chromium/convert/html"

	var multipartBuf bytes.Buffer
	mpw := multipart.NewWriter(&multipartBuf)

	filePart, err := mpw.CreateFormFile("files", "index.html")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build multipart request")
		return
	}
	filePart.Write(htmlBuf.Bytes())
	mpw.Close()

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint,
		bytes.NewReader(multipartBuf.Bytes()))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create Gotenberg request")
		return
	}
	req.Header.Set("Content-Type", mpw.FormDataContentType())

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
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

	// --- Stream PDF back to the caller ---
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="certificate-%s.pdf"`, data.LocalID))
	w.WriteHeader(http.StatusOK)
	io.Copy(w, resp.Body)
}
