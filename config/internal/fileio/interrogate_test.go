package fileio

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInterrogateToggleCaptainBlock(t *testing.T) {
	dir := t.TempDir()
	hablo := filepath.Join(dir, ".hablo")
	fm := filepath.Join(dir, "firstmate")
	policyDir := filepath.Join(hablo, "interrogate")
	if err := os.MkdirAll(policyDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(fm, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	policy := "<!-- HABLO:INTERROGATE-POLICY:START -->\n## Interrogate\nskip interrogate\n<!-- HABLO:INTERROGATE-POLICY:END -->\n"
	if err := os.WriteFile(filepath.Join(policyDir, "policy.md"), []byte(policy), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := WriteInterrogateEnabled(hablo, true); err != nil {
		t.Fatal(err)
	}
	if !ReadInterrogate(hablo).Enabled {
		t.Fatal("expected enabled")
	}
	if err := SetInterrogateCaptainBlock(fm, InterrogatePolicyPath(hablo), true); err != nil {
		t.Fatal(err)
	}
	body, _ := os.ReadFile(filepath.Join(fm, "data", "captain.md"))
	if !strings.Contains(string(body), "HABLO:INTERROGATE-POLICY:START") {
		t.Fatalf("%s", body)
	}
	if err := SetInterrogateCaptainBlock(fm, InterrogatePolicyPath(hablo), false); err != nil {
		t.Fatal(err)
	}
	body, _ = os.ReadFile(filepath.Join(fm, "data", "captain.md"))
	if strings.Contains(string(body), "INTERROGATE-POLICY") {
		t.Fatalf("still present: %s", body)
	}
}
