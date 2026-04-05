package calibrations

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jasonreid/probatus/internal/email"
	"github.com/jasonreid/probatus/internal/middleware"
)

// Handler holds the DB pool for the calibrations resource.
type Handler struct {
	pool *pgxpool.Pool
}

// NewHandler creates a new calibrations Handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

// CalibrationRecord represents a calibration_records row.
type CalibrationRecord struct {
	ID                 string       `json:"id"`
	TenantID           string       `json:"tenant_id"`
	AssetID            string       `json:"asset_id"`
	TechnicianID       string       `json:"technician_id"`
	SupervisorID       *string      `json:"supervisor_id,omitempty"`
	Status             string       `json:"status"`
	PerformedAt        time.Time    `json:"performed_at"`
	ApprovedAt         *time.Time   `json:"approved_at,omitempty"`
	SalesNumber        string       `json:"sales_number"`
	FlagNumber         string       `json:"flag_number"`
	TechSignature      string       `json:"tech_signature"`
	SupervisorSig      string       `json:"supervisor_signature"`
	CertificateURL     string       `json:"certificate_url"`
	Notes              string       `json:"notes"`
	LocalID            string       `json:"local_id"`
	Measurements       []Measurement `json:"measurements,omitempty"`
}

// Measurement represents a calibration_measurements row.
type Measurement struct {
	ID           string   `json:"id"`
	RecordID     string   `json:"record_id"`
	PointLabel   string   `json:"point_label"`
	StandardValue float64 `json:"standard_value"`
	MeasuredValue float64 `json:"measured_value"`
	Unit         string   `json:"unit"`
	Pass         bool     `json:"pass"`
	ErrorPct     float64  `json:"error_pct"`
	Notes        string   `json:"notes"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// checkStandardsDueDate validates that none of the provided standard IDs have a due_at in the past.
// Returns an error message if any standard is expired, otherwise returns "".
func (h *Handler) checkStandardsDueDate(r *http.Request, tenantID string, standardIDs []string) string {
	if len(standardIDs) == 0 {
		return ""
	}

	today := time.Now().UTC().Truncate(24 * time.Hour)

	rows, err := h.pool.Query(r.Context(),
		`SELECT name, due_at FROM master_standards
		 WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
		standardIDs, tenantID,
	)
	if err != nil {
		return "failed to validate standards"
	}
	defer rows.Close()

	for rows.Next() {
		var name string
		var dueAt time.Time
		if err := rows.Scan(&name, &dueAt); err != nil {
			return "failed to validate standards"
		}
		if dueAt.Before(today) {
			return fmt.Sprintf("Standard %s is past its calibration due date.", name)
		}
	}
	return ""
}

// List returns calibration records for the authenticated tenant with optional filters.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	assetID := r.URL.Query().Get("asset_id")
	status := r.URL.Query().Get("status")

	query := `SELECT id::text, tenant_id::text, asset_id::text, technician_id::text,
	                 supervisor_id::text, status, performed_at, approved_at,
	                 sales_number, flag_number, tech_signature, supervisor_signature,
	                 certificate_url, notes, local_id
	          FROM calibration_records
	          WHERE tenant_id = $1`
	args := []any{tenantID}

	if assetID != "" {
		args = append(args, assetID)
		query += fmt.Sprintf(" AND asset_id = $%d", len(args))
	}
	if status != "" {
		args = append(args, status)
		query += fmt.Sprintf(" AND status = $%d", len(args))
	}
	query += " ORDER BY performed_at DESC"

	rows, err := h.pool.Query(r.Context(), query, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query calibrations")
		return
	}
	defer rows.Close()

	records := []*CalibrationRecord{}
	for rows.Next() {
		rec := &CalibrationRecord{}
		err := rows.Scan(
			&rec.ID, &rec.TenantID, &rec.AssetID, &rec.TechnicianID,
			&rec.SupervisorID, &rec.Status, &rec.PerformedAt, &rec.ApprovedAt,
			&rec.SalesNumber, &rec.FlagNumber, &rec.TechSignature, &rec.SupervisorSig,
			&rec.CertificateURL, &rec.Notes, &rec.LocalID,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to scan calibration")
			return
		}
		records = append(records, rec)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "error iterating calibrations")
		return
	}

	writeJSON(w, http.StatusOK, records)
}

// Get returns a single calibration record including its measurements.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	row := h.pool.QueryRow(r.Context(),
		`SELECT id::text, tenant_id::text, asset_id::text, technician_id::text,
		        supervisor_id::text, status, performed_at, approved_at,
		        sales_number, flag_number, tech_signature, supervisor_signature,
		        certificate_url, notes, local_id
		 FROM calibration_records
		 WHERE id = $1 AND tenant_id = $2`,
		id, tenantID,
	)

	rec := &CalibrationRecord{}
	err := row.Scan(
		&rec.ID, &rec.TenantID, &rec.AssetID, &rec.TechnicianID,
		&rec.SupervisorID, &rec.Status, &rec.PerformedAt, &rec.ApprovedAt,
		&rec.SalesNumber, &rec.FlagNumber, &rec.TechSignature, &rec.SupervisorSig,
		&rec.CertificateURL, &rec.Notes, &rec.LocalID,
	)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "calibration not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query calibration")
		return
	}

	// Load measurements.
	mRows, err := h.pool.Query(r.Context(),
		`SELECT id::text, record_id::text, point_label, standard_value, measured_value,
		        unit, pass, error_pct, notes
		 FROM calibration_measurements
		 WHERE record_id = $1
		 ORDER BY id`,
		id,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query measurements")
		return
	}
	defer mRows.Close()

	rec.Measurements = []Measurement{}
	for mRows.Next() {
		var m Measurement
		if err := mRows.Scan(&m.ID, &m.RecordID, &m.PointLabel, &m.StandardValue,
			&m.MeasuredValue, &m.Unit, &m.Pass, &m.ErrorPct, &m.Notes); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to scan measurement")
			return
		}
		rec.Measurements = append(rec.Measurements, m)
	}
	if err := mRows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "error iterating measurements")
		return
	}

	writeJSON(w, http.StatusOK, rec)
}

// Create inserts a new calibration record and its measurements.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	userID := middleware.UserIDFromCtx(r.Context())

	var body struct {
		AssetID      string `json:"asset_id"`
		PerformedAt  string `json:"performed_at"`
		SalesNumber  string `json:"sales_number"`
		FlagNumber   string `json:"flag_number"`
		TechSignature string `json:"tech_signature"`
		Notes        string `json:"notes"`
		LocalID      string `json:"local_id"`
		StandardIDs  []string `json:"standard_ids"`
		Measurements []struct {
			PointLabel    string  `json:"point_label"`
			StandardValue float64 `json:"standard_value"`
			MeasuredValue float64 `json:"measured_value"`
			Unit          string  `json:"unit"`
			Pass          bool    `json:"pass"`
			ErrorPct      float64 `json:"error_pct"`
			Notes         string  `json:"notes"`
		} `json:"measurements"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate standards due dates.
	if errMsg := h.checkStandardsDueDate(r, tenantID, body.StandardIDs); errMsg != "" {
		writeError(w, http.StatusUnprocessableEntity, errMsg)
		return
	}

	var performedAt time.Time
	if body.PerformedAt != "" {
		var err error
		performedAt, err = time.Parse(time.RFC3339, body.PerformedAt)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid performed_at format, use RFC3339")
			return
		}
	} else {
		performedAt = time.Now().UTC()
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to begin transaction")
		return
	}
	defer tx.Rollback(r.Context())

	var recID string
	err = tx.QueryRow(r.Context(),
		`INSERT INTO calibration_records
			(tenant_id, asset_id, technician_id, status, performed_at,
			 sales_number, flag_number, tech_signature, notes, local_id)
		 VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9)
		 RETURNING id::text`,
		tenantID, body.AssetID, userID, performedAt,
		body.SalesNumber, body.FlagNumber, body.TechSignature, body.Notes, body.LocalID,
	).Scan(&recID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create calibration record")
		return
	}

	// Insert measurements.
	for _, m := range body.Measurements {
		_, err := tx.Exec(r.Context(),
			`INSERT INTO calibration_measurements
				(record_id, point_label, standard_value, measured_value, unit, pass, error_pct, notes)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			recID, m.PointLabel, m.StandardValue, m.MeasuredValue, m.Unit, m.Pass, m.ErrorPct, m.Notes,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to insert measurement")
			return
		}
	}

	// Link standards used.
	for _, stdID := range body.StandardIDs {
		_, err := tx.Exec(r.Context(),
			`INSERT INTO calibration_standards_used (record_id, standard_id) VALUES ($1,$2)`,
			recID, stdID,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to link standard")
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit transaction")
		return
	}

	// Return the created record.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"id": recID})
}

// Update modifies an existing calibration record (status, signatures, etc.).
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	var body struct {
		Status        string   `json:"status"`
		TechSignature string   `json:"tech_signature"`
		SalesNumber   string   `json:"sales_number"`
		FlagNumber    string   `json:"flag_number"`
		Notes         string   `json:"notes"`
		LocalID       string   `json:"local_id"`
		StandardIDs   []string `json:"standard_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate standards due dates.
	if errMsg := h.checkStandardsDueDate(r, tenantID, body.StandardIDs); errMsg != "" {
		writeError(w, http.StatusUnprocessableEntity, errMsg)
		return
	}

	tag, err := h.pool.Exec(r.Context(),
		`UPDATE calibration_records
		 SET status = COALESCE(NULLIF($3,''), status),
		     tech_signature = COALESCE(NULLIF($4,''), tech_signature),
		     sales_number = COALESCE(NULLIF($5,''), sales_number),
		     flag_number = COALESCE(NULLIF($6,''), flag_number),
		     notes = COALESCE(NULLIF($7,''), notes),
		     local_id = COALESCE(NULLIF($8,''), local_id)
		 WHERE id = $1 AND tenant_id = $2`,
		id, tenantID, body.Status, body.TechSignature,
		body.SalesNumber, body.FlagNumber, body.Notes, body.LocalID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update calibration")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "calibration not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"id": id})
}

// Approve sets a calibration's status to "approved" and records the supervisor.
func (h *Handler) Approve(w http.ResponseWriter, r *http.Request) {
	tenantID := middleware.TenantIDFromCtx(r.Context())
	userID := middleware.UserIDFromCtx(r.Context())
	id := chi.URLParam(r, "id")

	var body struct {
		SupervisorSignature string `json:"supervisor_signature"`
	}
	// Decode is best-effort; body may be empty.
	json.NewDecoder(r.Body).Decode(&body)

	now := time.Now().UTC()
	tag, err := h.pool.Exec(r.Context(),
		`UPDATE calibration_records
		 SET status = 'approved',
		     supervisor_id = $3,
		     approved_at = $4,
		     supervisor_signature = COALESCE(NULLIF($5,''), supervisor_signature)
		 WHERE id = $1 AND tenant_id = $2`,
		id, tenantID, userID, now, body.SupervisorSignature,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to approve calibration")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "calibration not found")
		return
	}

	// Fire off the certificate email in the background so the HTTP response is
	// never delayed or failed due to email delivery issues.
	go sendCertificateEmail(h.pool, r.Context(), id, tenantID)

	writeJSON(w, http.StatusOK, map[string]string{"id": id, "status": "approved"})
}

func sendCertificateEmail(pool *pgxpool.Pool, ctx context.Context, recordID, tenantID string) {
	// Use a detached context so the goroutine is not cancelled when the HTTP
	// handler's context is done.
	ctx = context.Background()

	// -------------------------------------------------------------------------
	// 1. Load calibration record.
	// -------------------------------------------------------------------------
	var rec struct {
		localID        string
		performedAt    time.Time
		technicianID   string
		supervisorID   string
		assetID        string
		techSignature  string
		supervisorSig  string
		salesNumber    string
		flagNumber     string
		notes          string
	}
	err := pool.QueryRow(ctx,
		`SELECT local_id, performed_at, technician_id::text,
		        COALESCE(supervisor_id::text,''), asset_id::text,
		        tech_signature, supervisor_signature, sales_number, flag_number, notes
		 FROM calibration_records
		 WHERE id = $1 AND tenant_id = $2`,
		recordID, tenantID,
	).Scan(
		&rec.localID, &rec.performedAt, &rec.technicianID, &rec.supervisorID, &rec.assetID,
		&rec.techSignature, &rec.supervisorSig, &rec.salesNumber, &rec.flagNumber, &rec.notes,
	)
	if err != nil {
		slog.Error("sendCertificateEmail: failed to load record", "record_id", recordID, "error", err)
		return
	}

	// -------------------------------------------------------------------------
	// 2. Load asset + customer contact.
	// -------------------------------------------------------------------------
	var asset struct {
		tagID          string
		serialNumber   string
		manufacturer   string
		model          string
		instrumentType string
		location       string
		rangeMin       *float64
		rangeMax       *float64
		rangeUnit      string
	}
	var customerName, customerContact string
	var tenantName string

	err = pool.QueryRow(ctx,
		`SELECT a.tag_id, a.serial_number, a.manufacturer, a.model,
		        a.instrument_type, a.location, a.range_min, a.range_max, a.range_unit,
		        COALESCE(c.name,''), COALESCE(c.contact,'')
		 FROM assets a
		 LEFT JOIN customers c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
		 WHERE a.id = $1 AND a.tenant_id = $2`,
		rec.assetID, tenantID,
	).Scan(
		&asset.tagID, &asset.serialNumber, &asset.manufacturer, &asset.model,
		&asset.instrumentType, &asset.location, &asset.rangeMin, &asset.rangeMax, &asset.rangeUnit,
		&customerName, &customerContact,
	)
	if err != nil {
		slog.Error("sendCertificateEmail: failed to load asset/customer", "record_id", recordID, "error", err)
		return
	}

	// Validate the contact email before doing any further work.
	customerContact = strings.TrimSpace(customerContact)
	if customerContact == "" || !strings.Contains(customerContact, "@") {
		slog.Info("sendCertificateEmail: skipping — no valid customer contact email",
			"record_id", recordID, "asset_tag", asset.tagID)
		return
	}

	// -------------------------------------------------------------------------
	// 3. Load tenant name (for the email footer).
	// -------------------------------------------------------------------------
	pool.QueryRow(ctx,
		`SELECT name FROM tenants WHERE id = $1`,
		tenantID,
	).Scan(&tenantName)
	if tenantName == "" {
		tenantName = "your calibration laboratory"
	}

	// -------------------------------------------------------------------------
	// 4. Load technician and supervisor names.
	// -------------------------------------------------------------------------
	var techName, supervisorName string
	pool.QueryRow(ctx,
		`SELECT full_name FROM profiles WHERE id = $1`,
		rec.technicianID,
	).Scan(&techName)
	if rec.supervisorID != "" {
		pool.QueryRow(ctx,
			`SELECT full_name FROM profiles WHERE id = $1`,
			rec.supervisorID,
		).Scan(&supervisorName)
	}

	// -------------------------------------------------------------------------
	// 5. Load measurements.
	// -------------------------------------------------------------------------
	mRows, err := pool.Query(ctx,
		`SELECT point_label, standard_value, measured_value, unit, error_pct, pass, notes
		 FROM calibration_measurements WHERE record_id = $1 ORDER BY id`,
		recordID,
	)
	if err != nil {
		slog.Error("sendCertificateEmail: failed to load measurements", "record_id", recordID, "error", err)
		return
	}
	var measurements []certMeasRow
	overallPass := true
	for mRows.Next() {
		var m certMeasRow
		if err := mRows.Scan(&m.PointLabel, &m.StandardValue, &m.MeasuredValue,
			&m.Unit, &m.ErrorPct, &m.Pass, &m.Notes); err != nil {
			mRows.Close()
			slog.Error("sendCertificateEmail: failed to scan measurement", "record_id", recordID, "error", err)
			return
		}
		if !m.Pass {
			overallPass = false
		}
		measurements = append(measurements, m)
	}
	mRows.Close()

	overallResult := "PASS"
	if !overallPass {
		overallResult = "FAIL"
	}

	// -------------------------------------------------------------------------
	// 6. Load standards used.
	// -------------------------------------------------------------------------
	sRows, err := pool.Query(ctx,
		`SELECT ms.name, ms.serial_number, ms.model, ms.manufacturer, ms.certificate_ref, ms.due_at
		 FROM calibration_standards_used csu
		 JOIN master_standards ms ON ms.id = csu.standard_id
		 WHERE csu.record_id = $1`,
		recordID,
	)
	if err != nil {
		slog.Error("sendCertificateEmail: failed to load standards", "record_id", recordID, "error", err)
		return
	}
	var standards []certStdRow
	for sRows.Next() {
		var s certStdRow
		if err := sRows.Scan(&s.Name, &s.SerialNumber, &s.Model, &s.Manufacturer,
			&s.CertificateRef, &s.DueAt); err != nil {
			sRows.Close()
			slog.Error("sendCertificateEmail: failed to scan standard", "record_id", recordID, "error", err)
			return
		}
		standards = append(standards, s)
	}
	sRows.Close()

	// -------------------------------------------------------------------------
	// 7. Render the certificate HTML and call Gotenberg for a PDF.
	// -------------------------------------------------------------------------
	approvedNow := time.Now().UTC()
	htmlBody := buildCertHTML(buildCertHTMLParams{
		recordID:       recordID,
		localID:        rec.localID,
		tenantName:     tenantName,
		salesNumber:    rec.salesNumber,
		flagNumber:     rec.flagNumber,
		performedAt:    rec.performedAt,
		approvedAt:     &approvedNow,
		status:         "approved",
		notes:          rec.notes,
		techName:       techName,
		techSignature:  rec.techSignature,
		supervisorName: supervisorName,
		supervisorSig:  rec.supervisorSig,
		assetTag:       asset.tagID,
		serialNumber:   asset.serialNumber,
		manufacturer:   asset.manufacturer,
		model:          asset.model,
		instrumentType: asset.instrumentType,
		location:       asset.location,
		rangeMin:       asset.rangeMin,
		rangeMax:       asset.rangeMax,
		rangeUnit:      asset.rangeUnit,
		measurements:   measurements,
		standards:      standards,
	})

	pdfBytes, err := generatePDFViaGotenberg(ctx, htmlBody)
	if err != nil {
		slog.Error("sendCertificateEmail: failed to generate PDF", "record_id", recordID, "error", err)
		return
	}

	// -------------------------------------------------------------------------
	// 8. Build and send the email.
	// -------------------------------------------------------------------------
	certShortID := recordID
	if len(certShortID) > 8 {
		certShortID = certShortID[:8]
	}
	assetDescription := fmt.Sprintf("%s %s", asset.manufacturer, asset.model)

	htmlEmail := email.CertificateEmailHTML(email.CertificateEmailParams{
		CustomerName:     customerName,
		AssetTagID:       asset.tagID,
		AssetDescription: assetDescription,
		PerformedAt:      rec.performedAt.Format("2006-01-02"),
		TechnicianName:   techName,
		OverallResult:    overallResult,
		CertificateID:    certShortID,
		TenantName:       tenantName,
	})

	pdfFilename := fmt.Sprintf("certificate-%s.pdf", rec.localID)

	payload := email.EmailPayload{
		From:    "certificates@probatus.app",
		To:      []string{customerContact},
		Subject: fmt.Sprintf("Calibration Certificate — %s (%s)", asset.tagID, rec.performedAt.Format("2006-01-02")),
		Html:    htmlEmail,
		Attachments: []email.Attachment{
			{
				Filename: pdfFilename,
				Content:  base64.StdEncoding.EncodeToString(pdfBytes),
			},
		},
	}

	if err := email.Send(payload); err != nil {
		slog.Error("sendCertificateEmail: failed to send email",
			"record_id", recordID, "customer_email", customerContact, "error", err)
		return
	}

	slog.Info("sendCertificateEmail: certificate emailed successfully",
		"record_id", recordID, "customer_email", customerContact, "asset_tag", asset.tagID)
}

// generatePDFViaGotenberg posts the rendered HTML to Gotenberg and returns the PDF bytes.
func generatePDFViaGotenberg(ctx context.Context, htmlContent string) ([]byte, error) {
	gotenbergURL := os.Getenv("GOTENBERG_URL")
	if gotenbergURL == "" {
		gotenbergURL = "http://localhost:3000"
	}
	endpoint := gotenbergURL + "/forms/chromium/convert/html"

	var buf bytes.Buffer
	mpw := multipart.NewWriter(&buf)

	filePart, err := mpw.CreateFormFile("files", "index.html")
	if err != nil {
		return nil, fmt.Errorf("gotenberg: failed to create form file: %w", err)
	}
	if _, err := filePart.Write([]byte(htmlContent)); err != nil {
		return nil, fmt.Errorf("gotenberg: failed to write HTML: %w", err)
	}
	mpw.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(buf.Bytes()))
	if err != nil {
		return nil, fmt.Errorf("gotenberg: failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", mpw.FormDataContentType())

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gotenberg: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gotenberg: returned status %d", resp.StatusCode)
	}

	var pdfBuf bytes.Buffer
	if _, err := pdfBuf.ReadFrom(resp.Body); err != nil {
		return nil, fmt.Errorf("gotenberg: failed to read response body: %w", err)
	}
	return pdfBuf.Bytes(), nil
}

// certMeasRow holds a single calibration measurement for certificate rendering.
type certMeasRow struct {
	PointLabel    string
	StandardValue float64
	MeasuredValue float64
	Unit          string
	ErrorPct      float64
	Pass          bool
	Notes         string
}

// certStdRow holds a single reference standard for certificate rendering.
type certStdRow struct {
	Name           string
	SerialNumber   string
	Model          string
	Manufacturer   string
	CertificateRef string
	DueAt          *time.Time
}

// buildCertHTMLParams bundles all the data needed to render the certificate HTML.
type buildCertHTMLParams struct {
	recordID       string
	localID        string
	tenantName     string
	salesNumber    string
	flagNumber     string
	performedAt    time.Time
	approvedAt     *time.Time
	status         string
	notes          string
	techName       string
	techSignature  string
	supervisorName string
	supervisorSig  string
	assetTag       string
	serialNumber   string
	manufacturer   string
	model          string
	instrumentType string
	location       string
	rangeMin       *float64
	rangeMax       *float64
	rangeUnit      string
	measurements   []certMeasRow
	standards      []certStdRow
}

// buildCertHTML renders the same certificate HTML template used by the certificates package
// so that the emailed PDF matches what the supervisor sees.
func buildCertHTML(p buildCertHTMLParams) string {
	var sb strings.Builder

	derefF := func(f *float64) float64 {
		if f == nil {
			return 0
		}
		return *f
	}

	fmtDate := func(t time.Time) string { return t.Format("2006-01-02") }
	fmtPtr := func(t *time.Time) string {
		if t == nil {
			return ""
		}
		return t.Format("2006-01-02")
	}

	fmt.Fprintf(&sb, `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; margin: 30px; color: #222; }
  h1 { font-size: 18px; text-align: center; margin-bottom: 2px; }
  h2 { font-size: 13px; text-align: center; margin-top: 0; color: #555; }
  .company { text-align: center; font-weight: bold; font-size: 14px; }
  .section { margin-top: 16px; }
  .section-title { font-weight: bold; border-bottom: 1px solid #aaa; margin-bottom: 6px; padding-bottom: 2px; }
  table { width: 100%%; border-collapse: collapse; margin-top: 4px; }
  th { background: #2c3e50; color: #fff; padding: 5px 8px; text-align: left; font-size: 10px; }
  td { padding: 4px 8px; border-bottom: 1px solid #ddd; font-size: 10px; }
  tr:nth-child(even) { background: #f7f7f7; }
  .pass  { color: #27ae60; font-weight: bold; }
  .fail  { color: #c0392b; font-weight: bold; }
  .kv { display: flex; flex-wrap: wrap; gap: 4px 24px; }
  .kv-item { min-width: 200px; }
  .kv-label { font-weight: bold; }
  .signatures { display: flex; gap: 60px; margin-top: 20px; }
  .sig-block { flex: 1; border-top: 1px solid #333; padding-top: 4px; font-size: 10px; }
  .footer { margin-top: 24px; font-size: 9px; color: #888; text-align: center; }
</style>
</head>
<body>
<div class="company">%s</div>
<h1>Calibration Certificate</h1>
<h2>ISO/IEC 17025 Compliant Calibration Record</h2>

<div class="section">
  <div class="section-title">Certificate Information</div>
  <div class="kv">`, p.tenantName)

	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Certificate No:</span> %s</div>`, p.localID)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Sales Order:</span> %s</div>`, p.salesNumber)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Flag Number:</span> %s</div>`, p.flagNumber)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Date Performed:</span> %s</div>`, fmtDate(p.performedAt))
	if p.approvedAt != nil {
		fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Date Approved:</span> %s</div>`, fmtPtr(p.approvedAt))
	}
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Status:</span> %s</div>`, p.status)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Generated:</span> %s</div>`, time.Now().UTC().Format("2006-01-02 15:04 UTC"))

	sb.WriteString(`</div></div>

<div class="section">
  <div class="section-title">Instrument Under Test</div>
  <div class="kv">`)

	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Tag ID:</span> %s</div>`, p.assetTag)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Serial Number:</span> %s</div>`, p.serialNumber)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Manufacturer:</span> %s</div>`, p.manufacturer)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Model:</span> %s</div>`, p.model)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Instrument Type:</span> %s</div>`, p.instrumentType)
	fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Location:</span> %s</div>`, p.location)
	if p.rangeMin != nil && p.rangeMax != nil {
		fmt.Fprintf(&sb, `<div class="kv-item"><span class="kv-label">Range:</span> %.4g &ndash; %.4g %s</div>`,
			derefF(p.rangeMin), derefF(p.rangeMax), p.rangeUnit)
	}

	sb.WriteString(`</div></div>

<div class="section">
  <div class="section-title">Calibration Measurements</div>
  <table>
    <thead>
      <tr>
        <th>Point</th><th>Standard Value</th><th>Measured Value</th>
        <th>Unit</th><th>Error %</th><th>Result</th><th>Notes</th>
      </tr>
    </thead>
    <tbody>`)

	for _, m := range p.measurements {
		resultClass := "pass"
		resultText := "PASS"
		if !m.Pass {
			resultClass = "fail"
			resultText = "FAIL"
		}
		fmt.Fprintf(&sb,
			`<tr><td>%s</td><td>%.6g</td><td>%.6g</td><td>%s</td><td>%.4f</td>`+
				`<td><span class="%s">%s</span></td><td>%s</td></tr>`,
			m.PointLabel, m.StandardValue, m.MeasuredValue, m.Unit, m.ErrorPct,
			resultClass, resultText, m.Notes,
		)
	}

	sb.WriteString(`</tbody></table></div>`)

	if len(p.standards) > 0 {
		sb.WriteString(`
<div class="section">
  <div class="section-title">Reference Standards Used</div>
  <table>
    <thead>
      <tr>
        <th>Name</th><th>Serial Number</th><th>Model</th>
        <th>Manufacturer</th><th>Certificate Ref</th><th>Due At</th>
      </tr>
    </thead>
    <tbody>`)
		for _, s := range p.standards {
			dueAt := ""
			if s.DueAt != nil {
				dueAt = s.DueAt.Format("2006-01-02")
			}
			fmt.Fprintf(&sb,
				`<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>`,
				s.Name, s.SerialNumber, s.Model, s.Manufacturer, s.CertificateRef, dueAt,
			)
		}
		sb.WriteString(`</tbody></table></div>`)
	}

	if p.notes != "" {
		fmt.Fprintf(&sb, `<div class="section"><div class="section-title">Notes</div><p>%s</p></div>`, p.notes)
	}

	sb.WriteString(`<div class="signatures">`)
	fmt.Fprintf(&sb,
		`<div class="sig-block"><strong>Technician</strong><br/>%s<br/>`, p.techName)
	if p.techSignature != "" {
		sb.WriteString(`<em>Signature on file</em>`)
	}
	sb.WriteString(`</div>`)

	if p.supervisorName != "" {
		fmt.Fprintf(&sb,
			`<div class="sig-block"><strong>Supervisor / Approver</strong><br/>%s<br/>`, p.supervisorName)
		if p.supervisorSig != "" {
			sb.WriteString(`<em>Signature on file</em>`)
		}
		sb.WriteString(`</div>`)
	}
	sb.WriteString(`</div>`)

	fmt.Fprintf(&sb, `
<div class="footer">
  %s &bull; Calibration Services &bull; This certificate shall not be reproduced
  except in full without written approval of the issuing laboratory.
</div>
</body>
</html>`, p.tenantName)

	return sb.String()
}
