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
	"sync"
	"time"

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

// jwksMinRefresh is the shortest interval between two JWKS fetches, so a flood
// of tokens with unknown key ids cannot turn into a flood of requests.
const jwksMinRefresh = time.Minute

// ecKeySource resolves the EC public key for a token's kid header.
type ecKeySource interface {
	key(kid string) (*ecdsa.PublicKey, error)
}

// jwksCache holds the Supabase JWKS signing keys by kid. A token whose kid is
// not cached triggers a refetch (key rotation), at most once per minRefresh.
// Safe for concurrent use.
type jwksCache struct {
	url        string
	client     *http.Client
	minRefresh time.Duration
	now        func() time.Time

	fetchMu sync.Mutex // serialises fetches

	mu        sync.RWMutex // guards keys and lastFetch
	keys      map[string]*ecdsa.PublicKey
	lastFetch time.Time
}

func newJWKSCache(supabaseURL string) *jwksCache {
	return &jwksCache{
		url:        strings.TrimRight(supabaseURL, "/") + "/auth/v1/.well-known/jwks.json",
		client:     &http.Client{Timeout: 10 * time.Second},
		minRefresh: jwksMinRefresh,
		now:        time.Now,
	}
}

// lookup returns the cached key for kid. An empty kid matches only when the
// set holds exactly one key, which is what a single-key JWKS without kids means.
func (c *jwksCache) lookup(kid string) *ecdsa.PublicKey {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if kid == "" {
		if len(c.keys) == 1 {
			for _, k := range c.keys {
				return k
			}
		}
		return nil
	}
	return c.keys[kid]
}

func (c *jwksCache) key(kid string) (*ecdsa.PublicKey, error) {
	if k := c.lookup(kid); k != nil {
		return k, nil
	}

	c.fetchMu.Lock()
	defer c.fetchMu.Unlock()
	// Another request may have refreshed while this one waited.
	if k := c.lookup(kid); k != nil {
		return k, nil
	}
	c.mu.RLock()
	last := c.lastFetch
	c.mu.RUnlock()
	if !last.IsZero() && c.now().Sub(last) < c.minRefresh {
		return nil, fmt.Errorf("unknown JWKS key id %q", kid)
	}
	if err := c.refresh(); err != nil {
		return nil, err
	}
	if k := c.lookup(kid); k != nil {
		return k, nil
	}
	return nil, fmt.Errorf("unknown JWKS key id %q", kid)
}

// refresh fetches the JWKS and replaces the cached keys. A failed fetch keeps
// the previous keys but still counts toward the rate limit.
func (c *jwksCache) refresh() error {
	c.mu.Lock()
	c.lastFetch = c.now()
	c.mu.Unlock()

	keys, err := fetchECPublicKeys(c.client, c.url)
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.keys = keys
	c.mu.Unlock()
	return nil
}

// fetchECPublicKeys fetches the P-256 signing keys from a JWKS endpoint, keyed by kid.
func fetchECPublicKeys(client *http.Client, jwksURL string) (map[string]*ecdsa.PublicKey, error) {
	resp, err := client.Get(jwksURL)
	if err != nil {
		return nil, fmt.Errorf("fetching JWKS: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetching JWKS: status %d", resp.StatusCode)
	}

	var body struct {
		Keys []jwksKey `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("decoding JWKS: %w", err)
	}

	keys := make(map[string]*ecdsa.PublicKey)
	for _, k := range body.Keys {
		if k.Kty != "EC" || (k.Use != "" && k.Use != "sig") || (k.Crv != "" && k.Crv != "P-256") {
			continue
		}
		xBytes, err := base64.RawURLEncoding.DecodeString(k.X)
		if err != nil {
			continue
		}
		yBytes, err := base64.RawURLEncoding.DecodeString(k.Y)
		if err != nil {
			continue
		}
		x, y := new(big.Int).SetBytes(xBytes), new(big.Int).SetBytes(yBytes)
		if !elliptic.P256().IsOnCurve(x, y) {
			continue
		}
		keys[k.Kid] = &ecdsa.PublicKey{Curve: elliptic.P256(), X: x, Y: y}
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("no EC signing key found in JWKS response")
	}
	return keys, nil
}

// validateToken parses and validates a raw JWT string using ES256 (preferred,
// key chosen by the token's kid) or HS256 (fallback). Returns the verified
// MapClaims or an error.
func validateToken(tokenString string, ecKeys ecKeySource, hmacSecret []byte) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		switch t.Method.(type) {
		case *jwt.SigningMethodECDSA:
			if ecKeys == nil {
				return nil, fmt.Errorf("ES256 token but no EC public key loaded")
			}
			kid, _ := t.Header["kid"].(string)
			return ecKeys.key(kid)
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
	// Try ES256 first (Supabase now uses asymmetric signing by default). Keys
	// are cached by kid and refetched when a token names an unknown one.
	var ecKeys ecKeySource
	supabaseURL := os.Getenv("SUPABASE_URL")
	if supabaseURL != "" {
		cache := newJWKSCache(supabaseURL)
		if err := cache.refresh(); err != nil {
			slog.Warn("could not fetch JWKS, will retry on first ES256 token; HMAC still accepted", "error", err)
		} else {
			slog.Info("loaded ES256 public keys from Supabase JWKS")
		}
		ecKeys = cache
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

			claims, err := validateToken(tokenString, ecKeys, hmacSecret)
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

			// Look up the profile to get tenant_id and role.
			var tenantID, role string
			err = pool.QueryRow(r.Context(),
				`SELECT tenant_id::text, role::text FROM profiles WHERE id = $1`,
				sub,
			).Scan(&tenantID, &role)
			if err != nil {
				slog.ErrorContext(r.Context(), "profile lookup failed", "sub", sub, "error", err)
				writeAuthError(w, "user profile not found")
				return
			}

			ctx := context.WithValue(r.Context(), ctxKeyUserID, sub)
			ctx = context.WithValue(ctx, ctxKeyTenantID, tenantID)
			ctx = context.WithValue(ctx, ctxKeyRole, role)

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

// WithTenantID returns a context with the given tenant ID set. Used in tests.
func WithTenantID(ctx context.Context, tenantID string) context.Context {
	return context.WithValue(ctx, ctxKeyTenantID, tenantID)
}

// WithUserID returns a context with the given user ID set. Used in tests.
func WithUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, ctxKeyUserID, userID)
}

// WithRole injects a role into the context. Useful in tests.
func WithRole(ctx context.Context, role string) context.Context {
	return context.WithValue(ctx, ctxKeyRole, role)
}
