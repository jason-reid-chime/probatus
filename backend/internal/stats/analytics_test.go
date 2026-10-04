package stats

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jasonreid/probatus/internal/middleware"
	"github.com/jasonreid/probatus/internal/testutil"
)

func analyticsReq(query, role string) *http.Request {
	r := httptest.NewRequest("GET", "/stats/analytics?"+query, nil)
	ctx := middleware.WithTenantID(r.Context(), "t1")
	ctx = middleware.WithRole(ctx, role)
	return r.WithContext(ctx)
}

func analyticsDB() *testutil.FakeDB {
	return testutil.New(
		testutil.Rule{Match: "GROUP BY 1, 2, 3", Rows: [][]any{
			{"Ashcroft", "1009", "pressure", 4, 10, 3},
			{"Unknown", "—", "temperature", 1, 0, 0},
		}},
		testutil.Rule{Match: "date_trunc('month'", Rows: [][]any{{"2026-09", 6, 2}, {"2026-10", 4, 1}}},
		testutil.Rule{Match: "LEFT JOIN billed", Rows: [][]any{
			{"a1", "PT-1", "Ashcroft", "1009", "pressure", 3, 2, 360.0},
			{"a2", "PT-2", "Ashcroft", "1009", "pressure", 2, 1, 0.0},
		}},
	)
}

func TestAnalytics(t *testing.T) {
	db := analyticsDB()
	w := httptest.NewRecorder()
	(&Handler{pool: db}).Analytics(w, analyticsReq("months=24", "admin"))
	if w.Code != 200 {
		t.Fatalf("got %d %s", w.Code, w.Body)
	}
	var resp AnalyticsResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Months != 24 || resp.Calibrations != 10 || resp.Failures != 3 || resp.FailRate != 30 {
		t.Errorf("totals: %+v", resp)
	}
	if resp.ByMakeModel[0].FailRate != 30 || resp.ByMakeModel[1].FailRate != 0 {
		t.Errorf("make/model rates: %+v", resp.ByMakeModel)
	}
	if len(resp.Monthly) != 2 || resp.TotalBilled != 360 {
		t.Errorf("monthly/billed: %+v", resp)
	}
	// 360 over a 24-month window = 180/year; only billed assets listed; 2+ failures = repeat
	if len(resp.CostByAsset) != 1 || resp.CostByAsset[0].CostPerYear != 180 {
		t.Errorf("cost: %+v", resp.CostByAsset)
	}
	if len(resp.RepeatFailures) != 1 || resp.RepeatFailures[0].TagID != "PT-1" {
		t.Errorf("repeat failures: %+v", resp.RepeatFailures)
	}
	if db.Calls[0].Args[1] != 24 {
		t.Errorf("months arg %v", db.Calls[0].Args[1])
	}
}

func TestAnalyticsDefaultsAndForbidden(t *testing.T) {
	db := testutil.New()
	w := httptest.NewRecorder()
	(&Handler{pool: db}).Analytics(w, analyticsReq("months=999", "supervisor"))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"months":12`) || !strings.Contains(w.Body.String(), `"by_make_model":[]`) {
		t.Errorf("defaults/empty: %s", w.Body)
	}
	w = httptest.NewRecorder()
	(&Handler{pool: db}).Analytics(w, analyticsReq("", "technician"))
	if w.Code != 403 {
		t.Errorf("technician: %d", w.Code)
	}
}

func TestAnalyticsQueryErrors(t *testing.T) {
	for _, match := range []string{"GROUP BY 1, 2, 3", "date_trunc('month'", "LEFT JOIN billed"} {
		db := analyticsDB()
		db.Rules = append([]testutil.Rule{{Match: match, Err: errors.New("boom")}}, db.Rules...)
		w := httptest.NewRecorder()
		(&Handler{pool: db}).Analytics(w, analyticsReq("", "admin"))
		if w.Code != 500 {
			t.Errorf("%s error: got %d", match, w.Code)
		}
	}
}

func TestRound2(t *testing.T) {
	if round2(1.005) != 1.01 && round2(1.005) != 1 { // float edge; just exercise
		t.Error("round2")
	}
	if round2(-2.345) != -2.35 {
		t.Errorf("negative: %v", round2(-2.345))
	}
	if pct(1, 3) != 33.33 {
		t.Errorf("pct: %v", pct(1, 3))
	}
}
