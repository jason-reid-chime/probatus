package middleware

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// RateLimit is a per-IP token-bucket rate limiter.
// Each IP gets 100 requests/minute with a burst of 20.
// Stale buckets (no traffic for 3 minutes) are evicted every minute.
const (
	rateLimitPerMinute = 100
	burstSize          = 20
	cleanupInterval    = time.Minute
	staleAfter         = 3 * time.Minute
)

type bucket struct {
	mu         sync.Mutex
	tokens     float64
	lastRefill time.Time
	lastSeen   time.Time
}

// allow returns true if the request should proceed.
// Refills tokens proportional to elapsed time (continuous token bucket).
func (b *bucket) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(b.lastRefill).Seconds()
	b.tokens = min(float64(burstSize), b.tokens+elapsed*(rateLimitPerMinute/60.0))
	b.lastRefill = now
	b.lastSeen = now

	if b.tokens >= 1 {
		b.tokens--
		return true
	}
	return false
}

type ipLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
}

var globalLimiter = &ipLimiter{
	buckets: make(map[string]*bucket),
}

func init() {
	go globalLimiter.cleanup()
}

func (l *ipLimiter) get(ip string) *bucket {
	l.mu.Lock()
	defer l.mu.Unlock()

	b, ok := l.buckets[ip]
	if !ok {
		b = &bucket{
			tokens:     float64(burstSize),
			lastRefill: time.Now(),
			lastSeen:   time.Now(),
		}
		l.buckets[ip] = b
	}
	return b
}

func (l *ipLimiter) cleanup() {
	for {
		time.Sleep(cleanupInterval)
		l.mu.Lock()
		for ip, b := range l.buckets {
			b.mu.Lock()
			stale := time.Since(b.lastSeen) > staleAfter
			b.mu.Unlock()
			if stale {
				delete(l.buckets, ip)
			}
		}
		l.mu.Unlock()
	}
}

// RateLimit is chi-compatible middleware that enforces per-IP rate limits.
func RateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if !globalLimiter.get(ip).allow() {
			w.Header().Set("Retry-After", "60")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error":"rate limit exceeded"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// clientIP extracts the real client IP.
// Railway (and most proxies) set X-Forwarded-For; we take the first entry.
// Spoofing X-Forwarded-For is possible but acceptable for this use case —
// a determined attacker with many IPs can bypass any IP-based limiter.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		ip := strings.TrimSpace(strings.SplitN(xff, ",", 2)[0])
		if ip != "" {
			return ip
		}
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}
