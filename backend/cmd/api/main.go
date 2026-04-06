package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"

	"github.com/getsentry/sentry-go"
	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"

	"github.com/jasonreid/probatus/internal/assets"
	"github.com/jasonreid/probatus/internal/audit"
	"github.com/jasonreid/probatus/internal/calibrations"
	"github.com/jasonreid/probatus/internal/certificates"
	"github.com/jasonreid/probatus/internal/db"
	"github.com/jasonreid/probatus/internal/middleware"
	"github.com/jasonreid/probatus/internal/standards"
	"github.com/jasonreid/probatus/internal/stats"
	"github.com/jasonreid/probatus/internal/templates"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Initialise Sentry — no-op when SENTRY_DSN is unset.
	if dsn := os.Getenv("SENTRY_DSN"); dsn != "" {
		if err := sentry.Init(sentry.ClientOptions{
			Dsn:              dsn,
			Environment:      os.Getenv("RAILWAY_ENVIRONMENT"), // "production" on Railway
			TracesSampleRate: 0.1,
		}); err != nil {
			slog.Warn("Sentry init failed", "error", err)
		} else {
			slog.Info("Sentry initialised")
		}
	}

	ctx := context.Background()

	pool, err := db.NewPool(ctx)
	if err != nil {
		sentry.CaptureException(err)
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	// Instantiate handlers.
	assetsHandler := assets.NewHandler(pool)
	calibrationsHandler := calibrations.NewHandler(pool)
	standardsHandler := standards.NewHandler(pool)
	certificatesHandler := certificates.NewHandler(pool)
	statsHandler := stats.NewHandler(pool)
	templatesHandler := templates.NewHandler(pool)
	auditHandler := audit.NewHandler(pool)

	r := chi.NewRouter()

	// Global middleware — order matters.
	r.Use(chimiddleware.RequestID)  // attach X-Request-Id early so logger picks it up
	r.Use(middleware.RequestLogger) // structured slog request logging
	r.Use(middleware.Recoverer)     // Sentry-aware panic recovery (replaces chimiddleware.Recoverer)
	r.Use(middleware.RateLimit)     // per-IP token bucket (100 req/min, burst 20)
	r.Use(middleware.CORS)

	// Public routes.
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Authenticated routes.
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(pool))

		// Assets
		r.Get("/assets", assetsHandler.List)
		r.Post("/assets", assetsHandler.Create)
		r.Get("/assets/tag/{tagId}", assetsHandler.GetByTagID)
		r.Get("/assets/{id}", assetsHandler.Get)
		r.Put("/assets/{id}", assetsHandler.Update)
		r.Delete("/assets/{id}", assetsHandler.Delete)

		// Calibrations
		r.Get("/calibrations", calibrationsHandler.List)
		r.Post("/calibrations", calibrationsHandler.Create)
		r.Get("/calibrations/{id}", calibrationsHandler.Get)
		r.Put("/calibrations/{id}", calibrationsHandler.Update)
		r.Post("/calibrations/{id}/approve", calibrationsHandler.Approve)
		r.Post("/calibrations/{id}/certificate", certificatesHandler.Generate)

		// Master Standards
		r.Get("/standards", standardsHandler.List)
		r.Post("/standards", standardsHandler.Create)
		r.Get("/standards/{id}", standardsHandler.Get)
		r.Put("/standards/{id}", standardsHandler.Update)
		r.Delete("/standards/{id}", standardsHandler.Delete)

		// Stats
		r.Get("/stats/dashboard", statsHandler.Dashboard)

		// Audit
		r.Post("/audit/package", auditHandler.Generate)

		// Calibration Templates
		r.Get("/templates", templatesHandler.List)
		r.Post("/templates", templatesHandler.Create)
		r.Get("/templates/{id}", templatesHandler.Get)
		r.Put("/templates/{id}", templatesHandler.Update)
		r.Delete("/templates/{id}", templatesHandler.Delete)
	})

	if os.Getenv("CORS_ORIGINS") == "" {
		slog.Warn("CORS_ORIGINS is not set — all origins are allowed (fine for dev, not for production)")
	}

	slog.Info("Probatus API starting", "port", port)
	if err := http.ListenAndServe(fmt.Sprintf(":%s", port), r); err != nil {
		sentry.CaptureException(err)
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}
