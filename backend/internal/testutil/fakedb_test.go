package testutil

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestFakeDB(t *testing.T) {
	ctx := context.Background()
	f := New(
		Rule{Match: "once", Rows: [][]any{{"first"}}, Once: true},
		Rule{Match: "once", Rows: [][]any{{"second"}}},
		Rule{Match: "fail", Err: errors.New("boom")},
		Rule{Match: "rows", Rows: [][]any{{1, "a"}, {2, nil}}},
		Rule{Match: "del", Tag: "DELETE 0"},
	)
	var s string
	f.QueryRow(ctx, "once").Scan(&s)
	if s != "first" {
		t.Errorf("once rule: %s", s)
	}
	f.QueryRow(ctx, "once").Scan(&s)
	if s != "second" {
		t.Errorf("after once: %s", s)
	}
	if err := f.QueryRow(ctx, "nothing").Scan(&s); err != pgx.ErrNoRows {
		t.Errorf("unmatched should be ErrNoRows: %v", err)
	}
	if err := f.QueryRow(ctx, "fail").Scan(&s); err == nil {
		t.Error("error rule")
	}
	if _, err := f.Query(ctx, "fail"); err == nil {
		t.Error("query error rule")
	}
	if _, err := f.Exec(ctx, "fail"); err == nil {
		t.Error("exec error rule")
	}
	rows, _ := f.Query(ctx, "rows")
	var n int64
	var p *string
	count := 0
	for rows.Next() {
		if err := rows.Scan(&n, &p); err != nil {
			t.Fatal(err)
		}
		count++
	}
	if count != 2 || n != 2 || p != nil {
		t.Errorf("rows: count=%d n=%d p=%v", count, n, p)
	}
	tag, _ := f.Exec(ctx, "del")
	if tag.RowsAffected() != 0 {
		t.Errorf("tag: %v", tag)
	}
	tag, _ = f.Exec(ctx, "other")
	if tag.RowsAffected() != 1 {
		t.Errorf("default tag: %v", tag)
	}
	tx, _ := f.Begin(ctx)
	tx.Exec(ctx, "x")
	tx.QueryRow(ctx, "rows").Scan(&n, &p)
	tx.Query(ctx, "rows")
	tx.Commit(ctx)
	tx.Rollback(ctx)
	if f.Committed != 1 || f.Ran("rows") != 3 {
		t.Errorf("tx: committed=%d ran=%d", f.Committed, f.Ran("rows"))
	}
	if err := assign([]any{1}, []any{&s, &s}); err == nil {
		t.Error("length mismatch should error")
	}
	if err := assign([]any{struct{}{}}, []any{&s}); err == nil {
		t.Error("type mismatch should error")
	}
	f.BeginErr = errors.New("no")
	if _, err := f.Begin(ctx); err == nil {
		t.Error("BeginErr")
	}
}
