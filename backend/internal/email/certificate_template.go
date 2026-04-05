package email

import "fmt"

// CertificateEmailParams holds the data used to render the certificate delivery email.
type CertificateEmailParams struct {
	CustomerName     string // e.g. "City of London"
	AssetTagID       string // e.g. "SHD-PRES-001"
	AssetDescription string // e.g. "Ashcroft Type 1009 Pressure Gauge"
	PerformedAt      string // formatted date, e.g. "2024-03-15"
	TechnicianName   string
	OverallResult    string // "PASS" or "FAIL"
	CertificateID    string // record UUID truncated to 8 chars
	TenantName       string // calibration company name
}

// CertificateEmailHTML returns the HTML body for a certificate delivery email.
func CertificateEmailHTML(p CertificateEmailParams) string {
	resultColor := "#27ae60" // green for PASS
	if p.OverallResult != "PASS" {
		resultColor = "#c0392b" // red for FAIL
	}

	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Calibration Certificate — %s</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#222222;">
  <table width="100%%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Outer card -->
        <table width="600" cellpadding="0" cellspacing="0" border="0"
               style="background-color:#ffffff;border-radius:6px;overflow:hidden;
                      box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:600px;width:100%%;">

          <!-- Header -->
          <tr>
            <td style="background-color:#2c3e50;padding:24px 32px;">
              <p style="margin:0;font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">
                Calibration Certificate Ready
              </p>
              <p style="margin:6px 0 0;font-size:13px;color:#bdc3c7;">
                Certificate ID: %s
              </p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:28px 32px 8px;">
              <p style="margin:0;font-size:14px;line-height:1.6;">
                Dear <strong>%s</strong>,
              </p>
              <p style="margin:12px 0 0;font-size:14px;line-height:1.6;">
                Please find attached the calibration certificate for the instrument detailed below.
                The certificate PDF is attached to this email for your records.
              </p>
            </td>
          </tr>

          <!-- Summary table -->
          <tr>
            <td style="padding:20px 32px;">
              <table width="100%%" cellpadding="0" cellspacing="0" border="0"
                     style="border:1px solid #e0e0e0;border-radius:4px;overflow:hidden;">
                <tr style="background-color:#f8f9fa;">
                  <td style="padding:10px 16px;font-size:12px;font-weight:bold;
                             color:#555555;text-transform:uppercase;letter-spacing:0.4px;
                             border-bottom:1px solid #e0e0e0;width:40%%;">
                    Field
                  </td>
                  <td style="padding:10px 16px;font-size:12px;font-weight:bold;
                             color:#555555;text-transform:uppercase;letter-spacing:0.4px;
                             border-bottom:1px solid #e0e0e0;">
                    Detail
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:13px;color:#555555;
                             border-bottom:1px solid #f0f0f0;">Asset Tag</td>
                  <td style="padding:10px 16px;font-size:13px;color:#222222;
                             border-bottom:1px solid #f0f0f0;font-weight:bold;">%s</td>
                </tr>
                <tr style="background-color:#fafafa;">
                  <td style="padding:10px 16px;font-size:13px;color:#555555;
                             border-bottom:1px solid #f0f0f0;">Instrument</td>
                  <td style="padding:10px 16px;font-size:13px;color:#222222;
                             border-bottom:1px solid #f0f0f0;">%s</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:13px;color:#555555;
                             border-bottom:1px solid #f0f0f0;">Calibration Date</td>
                  <td style="padding:10px 16px;font-size:13px;color:#222222;
                             border-bottom:1px solid #f0f0f0;">%s</td>
                </tr>
                <tr style="background-color:#fafafa;">
                  <td style="padding:10px 16px;font-size:13px;color:#555555;
                             border-bottom:1px solid #f0f0f0;">Technician</td>
                  <td style="padding:10px 16px;font-size:13px;color:#222222;
                             border-bottom:1px solid #f0f0f0;">%s</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;font-size:13px;color:#555555;">Overall Result</td>
                  <td style="padding:10px 16px;font-size:14px;font-weight:bold;color:%s;">
                    %s
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body copy -->
          <tr>
            <td style="padding:0 32px 24px;">
              <p style="margin:0;font-size:13px;line-height:1.7;color:#444444;">
                If you have any questions about this certificate or the calibration results,
                please contact us and reference certificate ID <strong>%s</strong>.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <hr style="border:none;border-top:1px solid #e8e8e8;margin:0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px;">
              <p style="margin:0;font-size:11px;color:#999999;line-height:1.6;">
                This certificate was generated by Probatus on behalf of <strong>%s</strong>.<br/>
                This email was sent automatically — please do not reply directly to this message.
              </p>
            </td>
          </tr>

        </table>
        <!-- /Outer card -->

      </td>
    </tr>
  </table>
</body>
</html>`,
		p.AssetTagID,    // title tag
		p.CertificateID, // header cert ID
		p.CustomerName,  // greeting
		p.AssetTagID,    // table: asset tag
		p.AssetDescription, // table: instrument
		p.PerformedAt,   // table: date
		p.TechnicianName, // table: technician
		resultColor,     // result colour
		p.OverallResult, // result text
		p.CertificateID, // body copy cert ID
		p.TenantName,    // footer tenant name
	)
}
