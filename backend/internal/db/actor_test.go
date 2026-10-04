package db

import "testing"

func TestIsWrite(t *testing.T) {
	writes := []string{
		"INSERT INTO assets VALUES (1)",
		"  update assets set x = 1",
		"\n\tDELETE FROM invoices WHERE id = $1",
		"WITH x AS (SELECT 1) UPDATE assets SET y = 2",
		"with moved as (delete from a returning *) insert into b select * from moved",
	}
	reads := []string{
		"SELECT * FROM assets",
		"SELECT set_config('app.user_id', $1, true)",
		"WITH t AS (SELECT 1) SELECT * FROM t",
		"SELECT 'insert into' AS text",
	}
	for _, s := range writes {
		if !isWrite(s) {
			t.Errorf("expected write: %q", s)
		}
	}
	for _, s := range reads {
		if isWrite(s) {
			t.Errorf("expected read: %q", s)
		}
	}
}

func TestErrRow(t *testing.T) {
	want := errRow{err: errTest}
	if want.Scan() != errTest {
		t.Error("errRow should return its error")
	}
}

var errTest = &testErr{}

type testErr struct{}

func (*testErr) Error() string { return "test" }
