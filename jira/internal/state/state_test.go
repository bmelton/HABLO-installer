package state

import "testing"

func TestStateAndReport(t *testing.T) {
	h := t.TempDir()
	s := State{Issues: map[string]Entry{"H-1": {Status: "running"}}}
	if e := Save(h, s); e != nil {
		t.Fatal(e)
	}
	got, e := Load(h)
	if e != nil || got.Issues["H-1"].Status != "running" {
		t.Fatalf("load: %v %#v", e, got)
	}
	if e := WriteReport(h, Report{Key: "H-1", Outcome: "done"}); e == nil {
		t.Fatal("report accepted without live run directory")
	}
}
