package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"

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
	// Required environment variables:
	//   DATABASE_URL        — PostgreSQL connection string
	//   SUPABASE_JWT_SECRET — JWT secret for verifying Supabase-issued tokens
	//   GOTENBERG_URL       — Gotenberg HTML-to-PDF service base URL (default: http://localhost:3000)
	//   RESEND_API_KEY      — Resend API key for automated certificate email delivery

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	ctx := context.Background()

	// Connect to PostgreSQL.
	pool, err := db.NewPool(ctx)
	if err != nil {
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

	// Global middleware.
	r.Use(chimiddleware.Logger)
	r.Use(chimiddleware.Recoverer)
	r.Use(chimiddleware.RequestID)
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

	slog.Info("Probatus API starting", "port", port)
	if err := http.ListenAndServe(fmt.Sprintf(":%s", port), r); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}
