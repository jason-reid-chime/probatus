// Package testutil provides a scripted fake database for handler unit tests.
//
// Rules are matched in order by SQL substring; the first match supplies the
// rows, command tag or error. A rule with Once is used a single time, which
// lets a test script a sequence (e.g. first lookup misses, second hits).
package testutil

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Rule scripts the response to statements containing Match.
type Rule struct {
	Match string
	Rows  [][]any // QueryRow uses Rows[0]; no rows means pgx.ErrNoRows
	Tag   string  // Exec command tag, default "UPDATE 1"
	Err   error
	Once  bool
}

// Call records one statement the code under test ran.
type Call struct {
	SQL  string
	Args []any
}

// FakeDB implements Query, QueryRow, Exec and Begin.
type FakeDB struct {
	mu        sync.Mutex
	Rules     []Rule
	Calls     []Call
	Committed int
	BeginErr  error
}

// New returns a FakeDB with the given rules.
func New(rules ...Rule) *FakeDB { return &FakeDB{Rules: rules} }

func (f *FakeDB) match(sql string, args []any) *Rule {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Calls = append(f.Calls, Call{SQL: sql, Args: args})
	for i := range f.Rules {
		if strings.Contains(sql, f.Rules[i].Match) {
			r := f.Rules[i]
			if r.Once {
				f.Rules = append(f.Rules[:i:i], f.Rules[i+1:]...)
			}
			return &r
		}
	}
	return nil
}

// Ran reports how many statements contained substr.
func (f *FakeDB) Ran(substr string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.Calls {
		if strings.Contains(c.SQL, substr) {
			n++
		}
	}
	return n
}

// Exec runs a statement.
func (f *FakeDB) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	r := f.match(sql, args)
	if r == nil {
		return pgconn.NewCommandTag("UPDATE 1"), nil
	}
	if r.Err != nil {
		return pgconn.CommandTag{}, r.Err
	}
	tag := r.Tag
	if tag == "" {
		tag = "UPDATE 1"
	}
	return pgconn.NewCommandTag(tag), nil
}

// QueryRow returns the first scripted row.
func (f *FakeDB) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	r := f.match(sql, args)
	if r == nil || (r.Err == nil && len(r.Rows) == 0) {
		return row{err: pgx.ErrNoRows}
	}
	if r.Err != nil {
		return row{err: r.Err}
	}
	return row{vals: r.Rows[0]}
}

// Query returns the scripted rows.
func (f *FakeDB) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	r := f.match(sql, args)
	if r == nil {
		return &rows{}, nil
	}
	if r.Err != nil {
		return nil, r.Err
	}
	return &rows{data: r.Rows}, nil
}

// Begin returns a transaction backed by the same rules.
func (f *FakeDB) Begin(context.Context) (pgx.Tx, error) {
	if f.BeginErr != nil {
		return nil, f.BeginErr
	}
	return &tx{f: f}, nil
}

type row struct {
	vals []any
	err  error
}

func (r row) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	return assign(r.vals, dest)
}

type rows struct {
	data [][]any
	i    int
}

func (r *rows) Close()                                       {}
func (r *rows) Err() error                                   { return nil }
func (r *rows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *rows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *rows) Next() bool                                   { r.i++; return r.i <= len(r.data) }
func (r *rows) Scan(dest ...any) error                       { return assign(r.data[r.i-1], dest) }
func (r *rows) Values() ([]any, error)                       { return r.data[r.i-1], nil }
func (r *rows) RawValues() [][]byte                          { return nil }
func (r *rows) Conn() *pgx.Conn                              { return nil }

// assign copies vals into dest pointers, converting compatible types and
// allocating for pointer destinations (e.g. **string).
func assign(vals []any, dest []any) error {
	if len(vals) != len(dest) {
		return fmt.Errorf("testutil: row has %d values, scan wants %d", len(vals), len(dest))
	}
	for i, d := range dest {
		dv := reflect.ValueOf(d)
		if dv.Kind() != reflect.Ptr || dv.IsNil() {
			return fmt.Errorf("testutil: dest %d is not a pointer", i)
		}
		target := dv.Elem()
		if vals[i] == nil {
			target.Set(reflect.Zero(target.Type()))
			continue
		}
		v := reflect.ValueOf(vals[i])
		if target.Kind() == reflect.Ptr && v.Kind() != reflect.Ptr {
			p := reflect.New(target.Type().Elem())
			if err := set(p.Elem(), v, i); err != nil {
				return err
			}
			target.Set(p)
			continue
		}
		if err := set(target, v, i); err != nil {
			return err
		}
	}
	return nil
}

func set(target, v reflect.Value, i int) error {
	switch {
	case v.Type().AssignableTo(target.Type()):
		target.Set(v)
	case v.Type().ConvertibleTo(target.Type()):
		target.Set(v.Convert(target.Type()))
	default:
		return fmt.Errorf("testutil: value %d (%s) can't scan into %s", i, v.Type(), target.Type())
	}
	return nil
}

type tx struct{ f *FakeDB }

func (t *tx) Begin(ctx context.Context) (pgx.Tx, error) { return t, nil }
func (t *tx) Commit(context.Context) error {
	t.f.mu.Lock()
	t.f.Committed++
	t.f.mu.Unlock()
	return nil
}
func (t *tx) Rollback(context.Context) error { return nil }
func (t *tx) CopyFrom(context.Context, pgx.Identifier, []string, pgx.CopyFromSource) (int64, error) {
	return 0, nil
}
func (t *tx) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults { return nil }
func (t *tx) LargeObjects() pgx.LargeObjects                         { return pgx.LargeObjects{} }
func (t *tx) Prepare(context.Context, string, string) (*pgconn.StatementDescription, error) {
	return nil, nil
}
func (t *tx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return t.f.Exec(ctx, sql, args...)
}
func (t *tx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return t.f.Query(ctx, sql, args...)
}
func (t *tx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return t.f.QueryRow(ctx, sql, args...)
}
func (t *tx) Conn() *pgx.Conn { return nil }
