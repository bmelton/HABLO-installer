package dispatch

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/bmelton/HABLO-installer/jira/internal/config"
)

func TestRenderAndDryRun(t *testing.T) {
	h := t.TempDir()
	tmpl := filepath.Join(h, "template")
	os.WriteFile(tmpl, []byte("{{.Key}}: {{.Description}}"), 0600)
	p, e := Render(h, tmpl, Brief{Key: "DEMO-1", Description: "work"}, true)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(p); !os.IsNotExist(e) {
		t.Fatal("dry render wrote a file")
	}
	p, e = Render(h, tmpl, Brief{Key: "DEMO-1", Description: "work"}, false)
	if e != nil {
		t.Fatal(e)
	}
	b, e := os.ReadFile(p)
	if e != nil || string(b) != "DEMO-1: work" {
		t.Fatalf("render: %v %q", e, b)
	}
}
func TestPreflightRejectsMissingRepository(t *testing.T) {
	if e := Preflight(config.Project{Dir: filepath.Join(t.TempDir(), "missing"), BaseBranch: "main", Mode: "direct-PR"}, true); e == nil {
		t.Fatal("missing repo accepted")
	}
}
