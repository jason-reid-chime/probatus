package certificates

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jasonreid/probatus/internal/email"
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
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', Arial, sans-serif;
    font-size: 9.5px;
    color: #1a1a2e;
    background: #fff;
    padding: 0;
  }
  /* Outer page frame */
  .page {
    margin: 14px 18px;
    border: 3px solid #1a3a5c;
    padding: 0;
    min-height: calc(100vh - 28px);
    display: flex;
    flex-direction: column;
  }
  /* ── Header band ── */
  .page-header {
    background: linear-gradient(135deg, #1a3a5c 0%, #2a5298 100%);
    color: #fff;
    padding: 10px 16px 8px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .company-block { flex: 1; }
  .company-name  { font-size: 16px; font-weight: 700; letter-spacing: 0.4px; }
  .company-sub   { font-size: 9px; opacity: 0.80; margin-top: 2px; letter-spacing: 0.8px; text-transform: uppercase; }
  .cert-id-block { text-align: right; }
  .cert-id-label { font-size: 8px; opacity: 0.75; text-transform: uppercase; letter-spacing: 0.6px; }
  .cert-id-value { font-size: 13px; font-weight: 700; margin-top: 2px; }
  /* ── Title banner ── */
  .title-band {
    background: #eaf0fb;
    border-bottom: 2px solid #1a3a5c;
    border-top: 2px solid #1a3a5c;
    text-align: center;
    padding: 5px 0 4px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    color: #1a3a5c;
  }
  /* ── Content area ── */
  .content { padding: 10px 14px; flex: 1; }
  /* ── Two-column info grid ── */
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 8px;
  }
  .info-card {
    border: 1px solid #c8d6e8;
    border-radius: 3px;
    overflow: hidden;
  }
  .info-card-full {
    border: 1px solid #c8d6e8;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 8px;
  }
  .card-hdr {
    background: #1a3a5c;
    color: #fff;
    font-size: 8px;
    font-weight: 600;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    padding: 3px 8px;
  }
  .kv { width: 100%; border-collapse: collapse; }
  .kv td { padding: 3px 8px; border-bottom: 1px solid #eaf0fb; vertical-align: top; font-size: 9px; }
  .kv tr:last-child td { border-bottom: none; }
  .kv td.lbl { color: #4a6080; font-weight: 600; width: 40%; white-space: nowrap; }
  .kv td.val { color: #1a1a2e; font-weight: 500; }
  /* ── Instrument row ── */
  .instrument-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 0;
  }
  .inst-cell {
    padding: 4px 8px;
    border-right: 1px solid #c8d6e8;
    font-size: 9px;
  }
  .inst-cell:last-child { border-right: none; }
  .inst-lbl { font-size: 7.5px; color: #4a6080; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px; }
  .inst-val  { color: #1a1a2e; font-weight: 600; }
  /* ── Traceability ── */
  .trace {
    background: #f5f8ff;
    border: 1px solid #c8d6e8;
    border-left: 3px solid #2a5298;
    border-radius: 2px;
    padding: 5px 8px;
    font-size: 8.5px;
    color: #334466;
    line-height: 1.5;
    margin-bottom: 8px;
    font-style: italic;
  }
  /* ── Data tables ── */
  table.data { width: 100%; border-collapse: collapse; }
  table.data thead tr { background: #1a3a5c; }
  table.data th {
    color: #fff;
    padding: 4px 8px;
    text-align: left;
    font-size: 8px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
  }
  table.data td { padding: 3.5px 8px; font-size: 9px; border-bottom: 1px solid #dce8f5; }
  table.data tbody tr:nth-child(even) td { background: #f5f8ff; }
  table.data tbody tr:hover td { background: #eaf0fb; }
  .pass-badge {
    display: inline-block;
    background: #d1fae5;
    color: #065f46;
    font-weight: 700;
    font-size: 8px;
    padding: 1px 7px;
    border-radius: 10px;
    letter-spacing: 0.5px;
    border: 1px solid #6ee7b7;
  }
  .fail-badge {
    display: inline-block;
    background: #fee2e2;
    color: #991b1b;
    font-weight: 700;
    font-size: 8px;
    padding: 1px 7px;
    border-radius: 10px;
    letter-spacing: 0.5px;
    border: 1px solid #fca5a5;
  }
  /* ── Signature block ── */
  .sig-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 10px;
    margin-top: 10px;
  }
  .sig-box {
    border: 1px solid #c8d6e8;
    border-radius: 3px;
    overflow: hidden;
  }
  .sig-box-hdr {
    background: #1a3a5c;
    color: #fff;
    font-size: 7.5px;
    font-weight: 600;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    padding: 3px 8px;
  }
  .sig-body { padding: 6px 8px 4px; }
  .sig-name { font-size: 9px; font-weight: 600; color: #1a1a2e; }
  .sig-line { border-top: 1px solid #8899bb; margin: 18px 0 3px; }
  .sig-caption { font-size: 7.5px; color: #6677aa; }
  /* ── Footer ── */
  .page-footer {
    background: #f0f4fa;
    border-top: 1px solid #c8d6e8;
    padding: 5px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 7.5px;
    color: #5566aa;
  }
  .footer-legal { font-style: italic; max-width: 70%; }
  .footer-gen { text-align: right; white-space: nowrap; }
  /* ── Misc ── */
  .section-gap { margin-bottom: 8px; }
  .text-center { text-align: center; }
  .mono { font-family: 'Courier New', monospace; }
</style>
</head>
<body>
<div class="page">

  <!-- ── Header ── -->
  <div class="page-header">
    <div class="company-block">
      <div class="company-name">{{.TenantName}}</div>
      <div class="company-sub">Calibration Services &bull; Measurement &amp; Instrumentation</div>
    </div>
    <div class="cert-id-block">
      <div class="cert-id-label">Certificate No.</div>
      <div class="cert-id-value mono">{{.LocalID}}</div>
    </div>
  </div>

  <!-- ── Title ── -->
  <div class="title-band">Calibration Certificate</div>

  <!-- ── Content ── -->
  <div class="content">

    <!-- Reference & Customer -->
    <div class="info-grid section-gap">
      <div class="info-card">
        <div class="card-hdr">Certificate Details</div>
        <table class="kv">
          <tr><td class="lbl">Sales Order</td><td class="val">{{if .SalesNumber}}{{.SalesNumber}}{{else}}&mdash;{{end}}</td></tr>
          <tr><td class="lbl">Flag Number</td><td class="val">{{if .FlagNumber}}{{.FlagNumber}}{{else}}&mdash;{{end}}</td></tr>
          <tr><td class="lbl">Date Performed</td><td class="val">{{.PerformedAt.Format "02 Jan 2006"}}</td></tr>
          <tr><td class="lbl">Recal Date</td><td class="val">{{recalDate .PerformedAt}}</td></tr>
          {{if .ApprovedAt}}<tr><td class="lbl">Approved</td><td class="val">{{.ApprovedAt.Format "02 Jan 2006"}}</td></tr>{{end}}
        </table>
      </div>
      <div class="info-card">
        <div class="card-hdr">Customer Information</div>
        <table class="kv">
          <tr><td class="lbl">Customer</td><td class="val">{{if .CustomerName}}{{.CustomerName}}{{else}}&mdash;{{end}}</td></tr>
          <tr><td class="lbl">Site / Location</td><td class="val">{{if .Location}}{{.Location}}{{else}}&mdash;{{end}}</td></tr>
          <tr><td class="lbl">Device Tag ID</td><td class="val mono">{{.AssetTag}}</td></tr>
        </table>
      </div>
    </div>

    <!-- Instrument Under Test -->
    <div class="info-card-full section-gap">
      <div class="card-hdr">Instrument Under Test</div>
      <div class="instrument-grid">
        <div class="inst-cell"><span class="inst-lbl">Type / Description</span><span class="inst-val">{{.InstrumentType}}</span></div>
        <div class="inst-cell"><span class="inst-lbl">Manufacturer</span><span class="inst-val">{{if .Manufacturer}}{{.Manufacturer}}{{else}}&mdash;{{end}}</span></div>
        <div class="inst-cell"><span class="inst-lbl">Model</span><span class="inst-val">{{if .Model}}{{.Model}}{{else}}&mdash;{{end}}</span></div>
        <div class="inst-cell"><span class="inst-lbl">Serial Number</span><span class="inst-val mono">{{if .SerialNumber}}{{.SerialNumber}}{{else}}&mdash;{{end}}</span></div>
        <div class="inst-cell"><span class="inst-lbl">Range</span><span class="inst-val">{{if and .RangeMin .RangeMax}}{{printf "%.4g" (deref .RangeMin)}} &ndash; {{printf "%.4g" (deref .RangeMax)}} {{.RangeUnit}}{{else}}&mdash;{{end}}</span></div>
        <div class="inst-cell"><span class="inst-lbl">Tag ID</span><span class="inst-val mono">{{.AssetTag}}</span></div>
      </div>
    </div>

    <!-- Traceability Statement -->
    <div class="trace section-gap">
      <strong>Traceability Statement:</strong> {{.TenantName}} certifies that the accuracies of the measuring equipment used in
      effecting this calibration are traceable to nationally recognized measurement standards of the National Research Council of
      Canada (NRC) or the National Institute of Standards and Technology (NIST), or have been derived from accepted values of
      natural physical constants, in accordance with ISO/IEC 17025 principles.
    </div>

    {{if .Standards}}
    <!-- Reference Standards Used -->
    <div class="info-card-full section-gap">
      <div class="card-hdr">Reference Standards Used</div>
      <table class="data">
        <thead>
          <tr>
            <th>Instrument / Standard</th>
            <th>Serial Number</th>
            <th>Certificate Reference</th>
            <th>Next Calibration Due</th>
          </tr>
        </thead>
        <tbody>
          {{range .Standards}}
          <tr>
            <td>{{.Name}}{{if .Model}} ({{.Model}}){{end}}</td>
            <td class="mono">{{.SerialNumber}}</td>
            <td class="mono">{{if .CertificateRef}}{{.CertificateRef}}{{else}}&mdash;{{end}}</td>
            <td>{{if .DueAt}}{{.DueAt.Format "02 Jan 2006"}}{{else}}&mdash;{{end}}</td>
          </tr>
          {{end}}
        </tbody>
      </table>
    </div>
    {{end}}

    <!-- Calibration Results -->
    <div class="info-card-full section-gap">
      <div class="card-hdr">Calibration Results</div>
      <table class="data">
        <thead>
          <tr>
            <th>Test Point</th>
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
            <td class="mono text-center">{{printf "%.6g" .StandardValue}}</td>
            <td class="mono text-center">{{printf "%.6g" .MeasuredValue}}</td>
            <td class="mono text-center">{{printf "%.6g" .MeasuredValue}}</td>
            <td>{{.Unit}}</td>
            <td class="mono text-center">{{printf "%.4f" .ErrorPct}}</td>
            <td class="text-center">
              {{if .Pass}}<span class="pass-badge">PASS</span>{{else}}<span class="fail-badge">FAIL</span>{{end}}
            </td>
          </tr>
          {{end}}
        </tbody>
      </table>
    </div>

    {{if .Notes}}
    <div class="info-card-full section-gap">
      <div class="card-hdr">Notes &amp; Remarks</div>
      <div style="padding: 6px 8px; font-size: 9px; line-height: 1.5; color: #334466;">{{.Notes}}</div>
    </div>
    {{end}}

    <!-- Signature Block -->
    <div class="sig-grid">
      <div class="sig-box">
        <div class="sig-box-hdr">Calibration Technician</div>
        <div class="sig-body">
          <div class="sig-name">{{.TechName}}</div>
          <div class="sig-line"></div>
          <div class="sig-caption">Authorized Signature &amp; Date</div>
        </div>
      </div>
      {{if .SupervisorName}}
      <div class="sig-box">
        <div class="sig-box-hdr">Approved By</div>
        <div class="sig-body">
          <div class="sig-name">{{.SupervisorName}}</div>
          <div class="sig-line"></div>
          <div class="sig-caption">Supervisor Signature &amp; Date</div>
        </div>
      </div>
      {{else}}
      <div class="sig-box">
        <div class="sig-box-hdr">Approved By</div>
        <div class="sig-body">
          <div class="sig-name" style="color:#aaa;">&nbsp;</div>
          <div class="sig-line"></div>
          <div class="sig-caption">Supervisor Signature &amp; Date</div>
        </div>
      </div>
      {{end}}
      <div class="sig-box">
        <div class="sig-box-hdr">For &amp; On Behalf Of</div>
        <div class="sig-body">
          <div class="sig-name">{{.TenantName}}</div>
          <div class="sig-line"></div>
          <div class="sig-caption">Company Stamp / Seal</div>
        </div>
      </div>
    </div>

  </div><!-- /content -->

  <!-- ── Footer ── -->
  <div class="page-footer">
    <div class="footer-legal">
      This certificate shall not be reproduced except in full, without the written approval of the issuing laboratory.
      Results relate only to the item(s) calibrated.
    </div>
    <div class="footer-gen">
      Generated: {{.GeneratedAt.Format "2006-01-02 15:04 UTC"}}
    </div>
  </div>

</div><!-- /page -->
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
		`SELECT id::text, COALESCE(local_id,''), COALESCE(sales_number,''),
		        COALESCE(flag_number,''), performed_at, approved_at, status,
		        COALESCE(tech_signature,''), COALESCE(supervisor_signature,''),
		        COALESCE(notes,''), technician_id::text, COALESCE(supervisor_id::text,'')
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
		slog.Error("Generate: record query failed", "id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusNotFound, "calibration not found")
		return
	}

	// --- Load asset + customer ---
	var assetID string
	err = h.pool.QueryRow(r.Context(),
		`SELECT cr.asset_id::text, a.tag_id, COALESCE(a.serial_number,''),
		        COALESCE(a.manufacturer,''), COALESCE(a.model,''),
		        a.instrument_type, COALESCE(a.location,''),
		        a.range_min, a.range_max, COALESCE(a.range_unit,''),
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
		slog.Error("Generate: asset query failed", "id", id, "error", err)
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
		`SELECT point_label,
		        COALESCE(standard_value, 0), COALESCE(measured_value, 0),
		        COALESCE(unit,''), COALESCE(error_pct, 0),
		        COALESCE(pass, false), COALESCE(notes,'')
		 FROM calibration_measurements WHERE record_id = $1
		 ORDER BY standard_value ASC NULLS LAST`,
		id,
	)
	if err != nil {
		slog.Error("Generate: measurements query failed", "id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load measurements")
		return
	}
	defer mRows.Close()
	for mRows.Next() {
		var m measurementRow
		if err := mRows.Scan(&m.PointLabel, &m.StandardValue, &m.MeasuredValue,
			&m.Unit, &m.ErrorPct, &m.Pass, &m.Notes); err != nil {
			slog.Error("Generate: measurement scan failed", "id", id, "error", err)
			writeError(w, http.StatusInternalServerError, "failed to scan measurement")
			return
		}
		data.Measurements = append(data.Measurements, m)
	}
	mRows.Close()

	// --- Load standards used ---
	sRows, err := h.pool.Query(r.Context(),
		`SELECT ms.name, ms.serial_number, COALESCE(ms.model,''),
		        COALESCE(ms.manufacturer,''), COALESCE(ms.certificate_ref,''), ms.due_at
		 FROM calibration_standards_used csu
		 JOIN master_standards ms ON ms.id = csu.standard_id
		 WHERE csu.record_id = $1`,
		id,
	)
	if err != nil {
		slog.Error("Generate: standards query failed", "id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load standards")
		return
	}
	defer sRows.Close()
	for sRows.Next() {
		var s standardRow
		if err := sRows.Scan(&s.Name, &s.SerialNumber, &s.Model, &s.Manufacturer,
			&s.CertificateRef, &s.DueAt); err != nil {
			slog.Error("Generate: standard scan failed", "id", id, "error", err)
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
		slog.Error("certificates.Generate: template parse failed", "record_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to parse certificate template")
		return
	}

	var htmlBuf bytes.Buffer
	if err := tmpl.Execute(&htmlBuf, data); err != nil {
		slog.Error("certificates.Generate: template execute failed", "record_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to render certificate template")
		return
	}

	// --- Generate PDF (Gotenberg if available, pure-Go fallback otherwise) ---
	pdfBytes, err := generateCertPDF(r.Context(), htmlBuf, data)
	if err != nil {
		slog.Error("certificates.Generate: PDF generation failed", "record_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to generate PDF")
		return
	}

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="certificate-%s.pdf"`, data.LocalID))
	w.WriteHeader(http.StatusOK)
	w.Write(pdfBytes)
}

// SendEmail generates a certificate PDF and emails it to the requested address.
func (h *Handler) SendEmail(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	var body struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}

	data, err := h.loadCertData(r, id, tenantID)
	if err != nil {
		slog.Error("certificates.SendEmail: failed to load cert data", "record_id", id, "tenant_id", tenantID, "error", err)
		writeError(w, http.StatusNotFound, "calibration not found")
		return
	}

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
		slog.Error("certificates.SendEmail: template parse failed", "record_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to parse certificate template")
		return
	}
	var htmlBuf bytes.Buffer
	if err := tmpl.Execute(&htmlBuf, data); err != nil {
		slog.Error("certificates.SendEmail: template execute failed", "record_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to render certificate template")
		return
	}

	pdfBytes, err := generateCertPDF(r.Context(), htmlBuf, data)
	if err != nil {
		slog.Error("certificates.SendEmail: PDF generation failed", "record_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to generate PDF")
		return
	}

	pdfFilename := fmt.Sprintf("certificate-%s.pdf", data.LocalID)
	fromEmail := os.Getenv("RESEND_FROM_EMAIL")
	if fromEmail == "" {
		fromEmail = "onboarding@resend.dev"
	}
	payload := email.EmailPayload{
		From:    fromEmail,
		To:      []string{body.Email},
		Subject: fmt.Sprintf("Calibration Certificate — %s (%s)", data.AssetTag, data.PerformedAt.Format("2006-01-02")),
		Html:    fmt.Sprintf("<p>Please find attached the calibration certificate for <strong>%s</strong>.</p>", data.AssetTag),
		Attachments: []email.Attachment{
			{Filename: pdfFilename, Content: base64.StdEncoding.EncodeToString(pdfBytes)},
		},
	}

	if err := email.Send(payload); err != nil {
		slog.Error("SendEmail: failed to send certificate email", "record_id", id, "to", body.Email, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to send email")
		return
	}

	slog.Info("SendEmail: certificate emailed", "record_id", id, "to", body.Email)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "sent"})
}

// loadCertData fetches all data needed to render a certificate for the given record.
func (h *Handler) loadCertData(r *http.Request, id, tenantID string) (certData, error) {
	var data certData
	var techID, supervisorID string
	err := h.pool.QueryRow(r.Context(),
		`SELECT id::text, COALESCE(local_id,''), COALESCE(sales_number,''),
		        COALESCE(flag_number,''), performed_at, approved_at, status,
		        COALESCE(tech_signature,''), COALESCE(supervisor_signature,''),
		        COALESCE(notes,''), technician_id::text, COALESCE(supervisor_id::text,'')
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
		return data, err
	}

	h.pool.QueryRow(r.Context(),
		`SELECT cr.asset_id::text, a.tag_id, COALESCE(a.serial_number,''),
		        COALESCE(a.manufacturer,''), COALESCE(a.model,''),
		        a.instrument_type, COALESCE(a.location,''), a.range_min, a.range_max, COALESCE(a.range_unit,''),
		        COALESCE(c.name,''), COALESCE(c.contact,'')
		 FROM calibration_records cr
		 JOIN assets a ON a.id = cr.asset_id
		 LEFT JOIN customers c ON c.id = a.customer_id AND c.tenant_id = cr.tenant_id
		 WHERE cr.id = $1 AND cr.tenant_id = $2`,
		id, tenantID,
	).Scan(
		new(string), &data.AssetTag, &data.SerialNumber, &data.Manufacturer,
		&data.Model, &data.InstrumentType, &data.Location,
		&data.RangeMin, &data.RangeMax, &data.RangeUnit,
		&data.CustomerName, &data.CustomerContact,
	)

	h.pool.QueryRow(r.Context(), `SELECT name FROM tenants WHERE id = $1`, tenantID).Scan(&data.TenantName)
	if data.TenantName == "" {
		data.TenantName = "Calibration Services"
	}
	h.pool.QueryRow(r.Context(), `SELECT full_name FROM profiles WHERE id = $1`, techID).Scan(&data.TechName)
	if supervisorID != "" {
		h.pool.QueryRow(r.Context(), `SELECT full_name FROM profiles WHERE id = $1`, supervisorID).Scan(&data.SupervisorName)
	}

	mRows, _ := h.pool.Query(r.Context(),
		`SELECT point_label,
		        COALESCE(standard_value, 0), COALESCE(measured_value, 0),
		        COALESCE(unit,''), COALESCE(error_pct, 0),
		        COALESCE(pass, false), COALESCE(notes,'')
		 FROM calibration_measurements WHERE record_id = $1 ORDER BY standard_value ASC NULLS LAST`, id)
	if mRows != nil {
		defer mRows.Close()
		for mRows.Next() {
			var m measurementRow
			mRows.Scan(&m.PointLabel, &m.StandardValue, &m.MeasuredValue, &m.Unit, &m.ErrorPct, &m.Pass, &m.Notes)
			data.Measurements = append(data.Measurements, m)
		}
	}

	sRows, _ := h.pool.Query(r.Context(),
		`SELECT ms.name, ms.serial_number, COALESCE(ms.model,''), COALESCE(ms.manufacturer,''),
		        COALESCE(ms.certificate_ref,''), ms.due_at
		 FROM calibration_standards_used csu
		 JOIN master_standards ms ON ms.id = csu.standard_id
		 WHERE csu.record_id = $1`, id)
	if sRows != nil {
		defer sRows.Close()
		for sRows.Next() {
			var s standardRow
			sRows.Scan(&s.Name, &s.SerialNumber, &s.Model, &s.Manufacturer, &s.CertificateRef, &s.DueAt)
			data.Standards = append(data.Standards, s)
		}
	}

	data.GeneratedAt = time.Now().UTC()
	return data, nil
}

// generateCertPDF tries Gotenberg if GOTENBERG_URL is set, falls back to a
// pure-Go PDF so certificate download always works without a Gotenberg sidecar.
func generateCertPDF(ctx context.Context, htmlBuf bytes.Buffer, data certData) ([]byte, error) {
	if url := os.Getenv("GOTENBERG_URL"); url != "" {
		if pdf, err := callGotenberg(ctx, url, htmlBuf); err == nil {
			return pdf, nil
		} else {
			slog.Warn("generateCertPDF: Gotenberg unavailable, using built-in PDF", "error", err)
		}
	}
	return buildMinimalCertPDF(data), nil
}

func callGotenberg(ctx context.Context, gotenbergURL string, htmlBuf bytes.Buffer) ([]byte, error) {
	var multipartBuf bytes.Buffer
	mpw := multipart.NewWriter(&multipartBuf)
	filePart, err := mpw.CreateFormFile("files", "index.html")
	if err != nil {
		return nil, err
	}
	filePart.Write(htmlBuf.Bytes())
	mpw.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		gotenbergURL+"/forms/chromium/convert/html", bytes.NewReader(multipartBuf.Bytes()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", mpw.FormDataContentType())

	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gotenberg status %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

func buildMinimalCertPDF(d certData) []byte {
	escape := func(s string) string {
		s = strings.ReplaceAll(s, `\`, `\\`)
		s = strings.ReplaceAll(s, `(`, `\(`)
		s = strings.ReplaceAll(s, `)`, `\)`)
		return s
	}

	var lines []string
	add := func(s string) { lines = append(lines, s) }
	sep := func() { add(strings.Repeat("-", 72)) }

	add(d.TenantName)
	add("CALIBRATION CERTIFICATE")
	sep()
	add(fmt.Sprintf("  Certificate No  : %s", d.LocalID))
	add(fmt.Sprintf("  Sales Order     : %s", d.SalesNumber))
	add(fmt.Sprintf("  Flag Number     : %s", d.FlagNumber))
	add(fmt.Sprintf("  Date Performed  : %s", d.PerformedAt.Format("2006-01-02")))
	if d.ApprovedAt != nil {
		add(fmt.Sprintf("  Date Approved   : %s", d.ApprovedAt.Format("2006-01-02")))
	}
	add(fmt.Sprintf("  Generated       : %s", d.GeneratedAt.Format("2006-01-02 15:04 UTC")))
	sep()
	add("INSTRUMENT UNDER TEST")
	add(fmt.Sprintf("  Tag ID          : %s", d.AssetTag))
	add(fmt.Sprintf("  Serial Number   : %s", d.SerialNumber))
	add(fmt.Sprintf("  Manufacturer    : %s", d.Manufacturer))
	add(fmt.Sprintf("  Model           : %s", d.Model))
	add(fmt.Sprintf("  Instrument Type : %s", d.InstrumentType))
	add(fmt.Sprintf("  Location        : %s", d.Location))
	if d.RangeMin != nil && d.RangeMax != nil {
		add(fmt.Sprintf("  Range           : %.4g - %.4g %s", *d.RangeMin, *d.RangeMax, d.RangeUnit))
	}
	sep()
	add("CALIBRATION MEASUREMENTS")
	add(fmt.Sprintf("  %-20s %12s %12s %6s %8s %6s", "Point", "Standard", "Measured", "Unit", "Error%", "Result"))
	for _, m := range d.Measurements {
		result := "PASS"
		if !m.Pass {
			result = "FAIL"
		}
		add(fmt.Sprintf("  %-20s %12.6g %12.6g %6s %8.4f %6s",
			m.PointLabel, m.StandardValue, m.MeasuredValue, m.Unit, m.ErrorPct, result))
	}
	if len(d.Standards) > 0 {
		sep()
		add("REFERENCE STANDARDS USED")
		for _, s := range d.Standards {
			due := ""
			if s.DueAt != nil {
				due = s.DueAt.Format("2006-01-02")
			}
			add(fmt.Sprintf("  %s  S/N:%s  Cert:%s  Due:%s", s.Name, s.SerialNumber, s.CertificateRef, due))
		}
	}
	sep()
	add("SIGNATURES")
	add(fmt.Sprintf("  Technician : %s", d.TechName))
	if d.SupervisorName != "" {
		add(fmt.Sprintf("  Supervisor : %s", d.SupervisorName))
	}
	sep()
	add("This certificate shall not be reproduced except in full without written")
	add("approval of the issuing laboratory.")

	const (
		leading = 14.0
		marginL = 50.0
		startY  = 800.0
	)

	var cs strings.Builder
	cs.WriteString("BT\n/F1 10 Tf\n")
	y := startY
	for _, line := range lines {
		fmt.Fprintf(&cs, "1 0 0 1 %.2f %.2f Tm\n(%s) Tj\n", marginL, y, escape(line))
		y -= leading
		if y < 50 {
			break
		}
	}
	cs.WriteString("ET\n")

	stream := cs.String()
	var pdf bytes.Buffer
	pdf.WriteString("%PDF-1.4\n")

	offs := make([]int, 6)
	offs[1] = pdf.Len()
	pdf.WriteString("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
	offs[2] = pdf.Len()
	pdf.WriteString("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
	offs[3] = pdf.Len()
	pdf.WriteString("3 0 obj\n<< /Type /Page /Parent 2 0 R\n   /MediaBox [0 0 595.28 841.89]\n   /Contents 5 0 R\n   /Resources << /Font << /F1 4 0 R >> >> >>\nendobj\n")
	offs[4] = pdf.Len()
	pdf.WriteString("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n")
	offs[5] = pdf.Len()
	fmt.Fprintf(&pdf, "5 0 obj\n<< /Length %d >>\nstream\n%sendstream\nendobj\n", len(stream), stream)

	xrefOffset := pdf.Len()
	pdf.WriteString("xref\n")
	fmt.Fprintf(&pdf, "0 6\n0000000000 65535 f \n")
	for i := 1; i <= 5; i++ {
		fmt.Fprintf(&pdf, "%010d 00000 n \n", offs[i])
	}
	fmt.Fprintf(&pdf, "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", xrefOffset)
	return pdf.Bytes()
}
