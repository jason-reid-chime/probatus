package middleware

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"net/http"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type contextKey string

const (
	ctxKeyUserID   contextKey = "userID"
	ctxKeyTenantID contextKey = "tenantID"
	ctxKeyRole     contextKey = "role"
)

func writeAuthError(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

type jwksKey struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
	Alg string `json:"alg"`
	Use string `json:"use"`
}

// fetchECPublicKey fetches the first EC signing key from a Supabase JWKS endpoint.
func fetchECPublicKey(supabaseURL string) (*ecdsa.PublicKey, error) {
	jwksURL := strings.TrimRight(supabaseURL, "/") + "/auth/v1/.well-known/jwks.json"
	resp, err := http.Get(jwksURL)
	if err != nil {
		return nil, fmt.Errorf("fetching JWKS: %w", err)
	}
	defer resp.Body.Close()

	var body struct {
		Keys []jwksKey `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("decoding JWKS: %w", err)
	}

	for _, k := range body.Keys {
		if k.Kty == "EC" && k.Use == "sig" {
			xBytes, err := base64.RawURLEncoding.DecodeString(k.X)
			if err != nil {
				continue
			}
			yBytes, err := base64.RawURLEncoding.DecodeString(k.Y)
			if err != nil {
				continue
			}
			return &ecdsa.PublicKey{
				Curve: elliptic.P256(),
				X:     new(big.Int).SetBytes(xBytes),
				Y:     new(big.Int).SetBytes(yBytes),
			}, nil
		}
	}
	return nil, fmt.Errorf("no EC signing key found in JWKS response")
}

// validateToken parses and validates a raw JWT string using ES256 (preferred)
// or HS256 (fallback). Returns the verified MapClaims or an error.
func validateToken(tokenString string, ecKey *ecdsa.PublicKey, hmacSecret []byte) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		switch t.Method.(type) {
		case *jwt.SigningMethodECDSA:
			if ecKey == nil {
				return nil, fmt.Errorf("ES256 token but no EC public key loaded")
			}
			return ecKey, nil
		case *jwt.SigningMethodHMAC:
			return hmacSecret, nil
		default:
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
	}, jwt.WithValidMethods([]string{"ES256", "HS256"}))
	if err != nil || !token.Valid {
		return nil, fmt.Errorf("invalid or expired token: %w", err)
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fmt.Errorf("invalid token claims")
	}
	return claims, nil
}

// Auth returns a Chi middleware that validates Supabase-issued JWTs and injects
// userID, tenantID, and role into the request context.
func Auth(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	// Try ES256 first (Supabase now uses asymmetric signing by default).
	var ecKey *ecdsa.PublicKey
	supabaseURL := os.Getenv("SUPABASE_URL")
	if supabaseURL != "" {
		var err error
		ecKey, err = fetchECPublicKey(supabaseURL)
		if err != nil {
			slog.Warn("could not fetch JWKS, falling back to HMAC", "error", err)
		} else {
			slog.Info("loaded ES256 public key from Supabase JWKS")
		}
	}

	// HS256 fallback — raw secret string (not base64-decoded).
	hmacSecret := []byte(os.Getenv("SUPABASE_JWT_SECRET"))

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				writeAuthError(w, "missing authorization header")
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
				writeAuthError(w, "invalid authorization header format")
				return
			}

			tokenString := parts[1]

			claims, err := validateToken(tokenString, ecKey, hmacSecret)
			if err != nil {
				slog.Warn("JWT validation failed", "error", err)
				writeAuthError(w, "invalid or expired token")
				return
			}

			sub, ok := claims["sub"].(string)
			if !ok || sub == "" {
				writeAuthError(w, "missing sub claim in token")
				return
			}

			// Look up the profile to get tenant_id.
			var tenantID string
			err = pool.QueryRow(r.Context(),
				`SELECT tenant_id::text FROM profiles WHERE id = $1`,
				sub,
			).Scan(&tenantID)
			if err != nil {
				slog.Error("profile lookup failed", "sub", sub, "error", err)
				writeAuthError(w, "user profile not found")
				return
			}

			ctx := context.WithValue(r.Context(), ctxKeyUserID, sub)
			ctx = context.WithValue(ctx, ctxKeyTenantID, tenantID)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// UserIDFromCtx extracts the authenticated user's UUID from the context.
func UserIDFromCtx(ctx context.Context) string {
	v, _ := ctx.Value(ctxKeyUserID).(string)
	return v
}

// TenantIDFromCtx extracts the authenticated user's tenant UUID from the context.
func TenantIDFromCtx(ctx context.Context) string {
	v, _ := ctx.Value(ctxKeyTenantID).(string)
	return v
}

// RoleFromCtx extracts the authenticated user's role from the context.
func RoleFromCtx(ctx context.Context) string {
	v, _ := ctx.Value(ctxKeyRole).(string)
	return v
}

// WithTenantID injects a tenant ID into the context. Useful in tests.
func WithTenantID(ctx context.Context, tenantID string) context.Context {
	return context.WithValue(ctx, ctxKeyTenantID, tenantID)
}

// WithUserID injects a user ID into the context. Useful in tests.
func WithUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, ctxKeyUserID, userID)
}
