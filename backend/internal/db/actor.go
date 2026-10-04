package db

import (
	"context"
	"regexp"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jasonreid/probatus/internal/middleware"
)

// Pool is the database interface handlers depend on. *ActorPool implements it;
// tests substitute mocks.
type Pool interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Begin(ctx context.Context) (pgx.Tx, error)
}

// ActorPool wraps a pgxpool so the audit-log trigger (migration 017) knows who
// made each change. The API connects to Postgres as a service role, so
// auth.uid() is empty; instead every write runs inside a transaction that
// first sets app.user_id / app.tenant_id from the request context.
//
// The settings are transaction-local (set_config(..., true)). That matters:
// Supabase's pooler runs in transaction mode, so a session-level setting could
// leak onto another request's connection.
//
// Reads pass straight through. A statement counts as a write when it starts
// with INSERT, UPDATE or DELETE (optionally after a WITH clause).
type ActorPool struct {
	*pgxpool.Pool
}

// NewActorPool wraps pool.
func NewActorPool(pool *pgxpool.Pool) *ActorPool {
	return &ActorPool{Pool: pool}
}

var writeStmt = regexp.MustCompile(`(?is)^\s*(with\b.*\b)?(insert|update|delete)\b`)

func isWrite(sql string) bool { return writeStmt.MatchString(sql) }

// setActor records the requesting user and tenant for the current transaction.
func setActor(ctx context.Context, tx pgx.Tx) error {
	userID := middleware.UserIDFromCtx(ctx)
	tenantID := middleware.TenantIDFromCtx(ctx)
	if userID == "" && tenantID == "" {
		return nil // background jobs: no request user
	}
	_, err := tx.Exec(ctx,
		`SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`,
		userID, tenantID)
	return err
}

// Begin starts a transaction with the request's actor recorded.
func (p *ActorPool) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	if err := setActor(ctx, tx); err != nil {
		tx.Rollback(ctx) //nolint:errcheck
		return nil, err
	}
	return tx, nil
}

// Exec runs sql; writes are wrapped in an actor-tagged transaction.
func (p *ActorPool) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if !isWrite(sql) {
		return p.Pool.Exec(ctx, sql, args...)
	}
	tx, err := p.Begin(ctx)
	if err != nil {
		return pgconn.CommandTag{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	tag, err := tx.Exec(ctx, sql, args...)
	if err != nil {
		return tag, err
	}
	return tag, tx.Commit(ctx)
}

// QueryRow runs sql; writes (e.g. INSERT ... RETURNING) are wrapped in an
// actor-tagged transaction that commits when the row is scanned.
func (p *ActorPool) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if !isWrite(sql) {
		return p.Pool.QueryRow(ctx, sql, args...)
	}
	tx, err := p.Begin(ctx)
	if err != nil {
		return errRow{err}
	}
	return &txRow{ctx: ctx, tx: tx, row: tx.QueryRow(ctx, sql, args...)}
}

// Query runs sql; writes are wrapped in an actor-tagged transaction that
// commits when the rows are closed.
func (p *ActorPool) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	if !isWrite(sql) {
		return p.Pool.Query(ctx, sql, args...)
	}
	tx, err := p.Begin(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		tx.Rollback(ctx) //nolint:errcheck
		return nil, err
	}
	return &txRows{Rows: rows, ctx: ctx, tx: tx}, nil
}

type errRow struct{ err error }

func (r errRow) Scan(...any) error { return r.err }

// txRow commits its transaction after Scan. A failed scan rolls back, except
// pgx.ErrNoRows: the statement ran (it just matched nothing), so commit.
type txRow struct {
	ctx context.Context
	tx  pgx.Tx
	row pgx.Row
}

func (r *txRow) Scan(dest ...any) error {
	err := r.row.Scan(dest...)
	if err != nil && err != pgx.ErrNoRows {
		r.tx.Rollback(r.ctx) //nolint:errcheck
		return err
	}
	if cerr := r.tx.Commit(r.ctx); cerr != nil {
		return cerr
	}
	return err
}

// txRows commits its transaction when closed, or rolls back if iteration failed.
type txRows struct {
	pgx.Rows
	ctx  context.Context
	tx   pgx.Tx
	done bool
}

func (r *txRows) Close() {
	r.Rows.Close()
	if r.done {
		return
	}
	r.done = true
	if r.Rows.Err() != nil {
		r.tx.Rollback(r.ctx) //nolint:errcheck
		return
	}
	r.tx.Commit(r.ctx) //nolint:errcheck
}
