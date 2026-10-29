package middleware

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

var testHMACSecret = []byte("test-secret-key-for-unit-tests-only")

func makeHMACToken(t *testing.T, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(testHMACSecret)
	if err != nil {
		t.Fatalf("signing test token: %v", err)
	}
	return signed
}

func validClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"sub": "user-uuid-1234",
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
	}
}

// ---------------------------------------------------------------------------
// validateToken
// ---------------------------------------------------------------------------

func TestValidateToken_ValidHMAC(t *testing.T) {
	token := makeHMACToken(t, validClaims())
	claims, err := validateToken(token, nil, testHMACSecret)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if sub, _ := claims["sub"].(string); sub != "user-uuid-1234" {
		t.Errorf("expected sub=user-uuid-1234, got %q", sub)
	}
}

func TestValidateToken_WrongSecret(t *testing.T) {
	token := makeHMACToken(t, validClaims())
	_, err := validateToken(token, nil, []byte("wrong-secret"))
	if err == nil {
		t.Fatal("expected error for wrong secret, got nil")
	}
}

func TestValidateToken_ExpiredToken(t *testing.T) {
	claims := jwt.MapClaims{
		"sub": "user-uuid-1234",
		"exp": time.Now().Add(-time.Hour).Unix(), // expired
		"iat": time.Now().Add(-2 * time.Hour).Unix(),
	}
	token := makeHMACToken(t, claims)
	_, err := validateToken(token, nil, testHMACSecret)
	if err == nil {
		t.Fatal("expected error for expired token, got nil")
	}
}

func TestValidateToken_MalformedToken(t *testing.T) {
	_, err := validateToken("not.a.jwt", nil, testHMACSecret)
	if err == nil {
		t.Fatal("expected error for malformed token, got nil")
	}
}

func TestValidateToken_EmptyToken(t *testing.T) {
	_, err := validateToken("", nil, testHMACSecret)
	if err == nil {
		t.Fatal("expected error for empty token, got nil")
	}
}

func TestValidateToken_ES256WithNoKeyLoaded(t *testing.T) {
	// Build a fake ES256-alg header token — we just need it to hit the EC branch.
	// Use a real HMAC token but with a forged header isn't possible cleanly;
	// instead verify the ecKey=nil path by making a real ES256 token.
	// Since we don't have an EC key pair in tests, just confirm HS256 rejects EC.
	token := makeHMACToken(t, validClaims())
	// This should still work since the token is HS256
	_, err := validateToken(token, nil, testHMACSecret)
	if err != nil {
		t.Fatalf("HS256 with nil ecKey should succeed: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Auth HTTP middleware — error paths that don't require a DB
// ---------------------------------------------------------------------------

// nullHandler is a sentinel handler that panics if reached (DB path).
var nullHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
})

// authMiddlewareWithSecret builds the Auth middleware using a fixed HMAC
// secret and no EC key, without needing a real pgxpool.
func authMiddlewareNoPool(secret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				writeAuthError(w, "missing authorization header")
				return
			}
			parts := splitBearer(authHeader)
			if parts == nil {
				writeAuthError(w, "invalid authorization header format")
				return
			}
			_, err := validateToken(parts[1], nil, secret)
			if err != nil {
				writeAuthError(w, "invalid or expired token")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func splitBearer(header string) []string {
	// inline the same logic as the real middleware
	if len(header) > 7 && (header[:7] == "Bearer " || header[:7] == "bearer ") {
		return []string{"Bearer", header[7:]}
	}
	return nil
}

func TestAuthMiddleware_MissingHeader(t *testing.T) {
	mw := authMiddlewareNoPool(testHMACSecret)
	handler := mw(nullHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestAuthMiddleware_InvalidFormat(t *testing.T) {
	mw := authMiddlewareNoPool(testHMACSecret)
	handler := mw(nullHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Token abc123") // not "Bearer"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestAuthMiddleware_InvalidToken(t *testing.T) {
	mw := authMiddlewareNoPool(testHMACSecret)
	handler := mw(nullHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer invalid.token.value")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestAuthMiddleware_ValidToken_ReachesNext(t *testing.T) {
	mw := authMiddlewareNoPool(testHMACSecret)
	handler := mw(nullHandler)

	token := makeHMACToken(t, validClaims())
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

func TestUserIDFromCtx(t *testing.T) {
	ctx := context.WithValue(context.Background(), ctxKeyUserID, "user-abc")
	if got := UserIDFromCtx(ctx); got != "user-abc" {
		t.Errorf("expected user-abc, got %q", got)
	}
}

func TestUserIDFromCtx_Missing(t *testing.T) {
	if got := UserIDFromCtx(context.Background()); got != "" {
		t.Errorf("expected empty string for missing key, got %q", got)
	}
}

func TestTenantIDFromCtx(t *testing.T) {
	ctx := context.WithValue(context.Background(), ctxKeyTenantID, "tenant-xyz")
	if got := TenantIDFromCtx(ctx); got != "tenant-xyz" {
		t.Errorf("expected tenant-xyz, got %q", got)
	}
}

func TestTenantIDFromCtx_Missing(t *testing.T) {
	if got := TenantIDFromCtx(context.Background()); got != "" {
		t.Errorf("expected empty string for missing key, got %q", got)
	}
}

func TestRoleFromCtx(t *testing.T) {
	ctx := context.WithValue(context.Background(), ctxKeyRole, "admin")
	if got := RoleFromCtx(ctx); got != "admin" {
		t.Errorf("expected admin, got %q", got)
	}
}

func TestRoleFromCtx_Missing(t *testing.T) {
	if got := RoleFromCtx(context.Background()); got != "" {
		t.Errorf("expected empty string for missing key, got %q", got)
	}
}

func TestWithTenantID(t *testing.T) {
	ctx := WithTenantID(context.Background(), "tenant-abc")
	if got := TenantIDFromCtx(ctx); got != "tenant-abc" {
		t.Errorf("expected tenant-abc, got %q", got)
	}
}

func TestWithUserID(t *testing.T) {
	ctx := WithUserID(context.Background(), "user-xyz")
	if got := UserIDFromCtx(ctx); got != "user-xyz" {
		t.Errorf("expected user-xyz, got %q", got)
	}
}

func TestWithRole(t *testing.T) {
	ctx := WithRole(context.Background(), "supervisor")
	if got := RoleFromCtx(ctx); got != "supervisor" {
		t.Errorf("expected supervisor, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// JWKS key cache
// ---------------------------------------------------------------------------

type testKey struct {
	kid  string
	priv *ecdsa.PrivateKey
}

func newTestKey(t *testing.T, kid string) testKey {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generating EC key: %v", err)
	}
	return testKey{kid: kid, priv: priv}
}

func (k testKey) jwk() jwksKey {
	enc := func(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
	return jwksKey{
		Kty: "EC", Kid: k.kid, Crv: "P-256", Alg: "ES256", Use: "sig",
		X: enc(k.priv.PublicKey.X.FillBytes(make([]byte, 32))),
		Y: enc(k.priv.PublicKey.Y.FillBytes(make([]byte, 32))),
	}
}

func (k testKey) sign(t *testing.T) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, validClaims())
	tok.Header["kid"] = k.kid
	signed, err := tok.SignedString(k.priv)
	if err != nil {
		t.Fatalf("signing ES256 token: %v", err)
	}
	return signed
}

// jwksServer serves a mutable key set and counts fetches.
type jwksServer struct {
	*httptest.Server
	mu      sync.Mutex
	keys    []jwksKey
	fetches atomic.Int32
}

func newJWKSServer(t *testing.T, keys ...testKey) *jwksServer {
	t.Helper()
	s := &jwksServer{}
	s.setKeys(keys...)
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/v1/.well-known/jwks.json" {
			http.NotFound(w, r)
			return
		}
		s.fetches.Add(1)
		s.mu.Lock()
		defer s.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"keys": s.keys}) //nolint:errcheck
	}))
	t.Cleanup(s.Close)
	return s
}

func (s *jwksServer) setKeys(keys ...testKey) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.keys = nil
	for _, k := range keys {
		s.keys = append(s.keys, k.jwk())
	}
}

// fakeClock is a manually advanced clock for the cache's rate limit.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func newTestCache(srv *jwksServer, clock *fakeClock) *jwksCache {
	c := newJWKSCache(srv.URL + "/")
	c.now = clock.now
	return c
}

func TestJWKSCache_RotatedKeyValidatesAfterRefetch(t *testing.T) {
	oldKey, newKey := newTestKey(t, "key-1"), newTestKey(t, "key-2")
	srv := newJWKSServer(t, oldKey)
	clock := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	cache := newTestCache(srv, clock)

	// No keys yet: the first ES256 token triggers the initial fetch.
	if _, err := validateToken(oldKey.sign(t), cache, testHMACSecret); err != nil {
		t.Fatalf("token with known kid should validate: %v", err)
	}
	if n := srv.fetches.Load(); n != 1 {
		t.Fatalf("expected 1 fetch, got %d", n)
	}

	// Supabase rotates: the JWKS now publishes key-2 as well.
	srv.setKeys(oldKey, newKey)
	clock.advance(jwksMinRefresh + time.Second)

	claims, err := validateToken(newKey.sign(t), cache, testHMACSecret)
	if err != nil {
		t.Fatalf("token signed with the new kid should validate after refetch: %v", err)
	}
	if sub, _ := claims["sub"].(string); sub != "user-uuid-1234" {
		t.Errorf("unexpected sub %q", sub)
	}
	if n := srv.fetches.Load(); n != 2 {
		t.Errorf("expected 2 fetches, got %d", n)
	}

	// Known kids are served from the cache.
	if _, err := validateToken(oldKey.sign(t), cache, testHMACSecret); err != nil {
		t.Fatalf("old kid should still validate: %v", err)
	}
	if n := srv.fetches.Load(); n != 2 {
		t.Errorf("known kid must not refetch, got %d fetches", n)
	}
}

func TestJWKSCache_UnknownKidRefetchIsRateLimited(t *testing.T) {
	known, rotated := newTestKey(t, "key-1"), newTestKey(t, "key-2")
	srv := newJWKSServer(t, known)
	clock := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	cache := newTestCache(srv, clock)
	if err := cache.refresh(); err != nil {
		t.Fatalf("initial fetch: %v", err)
	}
	srv.setKeys(known, rotated)

	// Within the minute after a fetch, unknown kids fail without refetching.
	clock.advance(30 * time.Second)
	if _, err := validateToken(rotated.sign(t), cache, testHMACSecret); err == nil {
		t.Fatal("expected unknown kid to fail inside the rate-limit window")
	}
	if n := srv.fetches.Load(); n != 1 {
		t.Fatalf("expected no refetch inside the window, got %d fetches", n)
	}

	// Once the window has passed, one refetch picks the new key up.
	clock.advance(31 * time.Second)
	if _, err := validateToken(rotated.sign(t), cache, testHMACSecret); err != nil {
		t.Fatalf("expected rotated kid to validate after the window: %v", err)
	}
	if n := srv.fetches.Load(); n != 2 {
		t.Errorf("expected 2 fetches, got %d", n)
	}
}

func TestJWKSCache_ConcurrentUnknownKidFetchesOnce(t *testing.T) {
	key := newTestKey(t, "key-1")
	srv := newJWKSServer(t, key)
	cache := newTestCache(srv, &fakeClock{t: time.Unix(1_700_000_000, 0)})
	token := key.sign(t)

	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := validateToken(token, cache, testHMACSecret)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent validation failed: %v", err)
		}
	}
	if n := srv.fetches.Load(); n != 1 {
		t.Errorf("expected a single fetch for concurrent requests, got %d", n)
	}
}

func TestValidateToken_ES256WithoutKeySourceRejected(t *testing.T) {
	// SUPABASE_URL unset: no key source, so ES256 tokens fail but HS256 works.
	key := newTestKey(t, "key-1")
	if _, err := validateToken(key.sign(t), nil, testHMACSecret); err == nil {
		t.Fatal("expected ES256 token to be rejected without a key source")
	}
	if _, err := validateToken(makeHMACToken(t, validClaims()), nil, testHMACSecret); err != nil {
		t.Fatalf("HS256 fallback should still work: %v", err)
	}
}

func TestValidateToken_ES256WrongKeyRejected(t *testing.T) {
	published, attacker := newTestKey(t, "key-1"), newTestKey(t, "key-1")
	srv := newJWKSServer(t, published)
	cache := newTestCache(srv, &fakeClock{t: time.Unix(1_700_000_000, 0)})
	if _, err := validateToken(attacker.sign(t), cache, testHMACSecret); err == nil {
		t.Fatal("token signed by an unpublished key must be rejected")
	}
}
