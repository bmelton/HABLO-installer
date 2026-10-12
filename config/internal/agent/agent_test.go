package agent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSetPreference(t *testing.T) {
	dir := t.TempDir()
	marker := filepath.Join(dir, ".hablo", "agent")
	fm := filepath.Join(dir, "firstmate")
	if err := os.MkdirAll(filepath.Join(fm, "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	hablo := filepath.Dir(marker)
	if err := os.MkdirAll(hablo, 0o755); err != nil {
		t.Fatal(err)
	}
	piDispatch := "{\"$comment\":\"HABLO-installer pi\",\"default\":{\"harness\":\"pi\"}}\n"
	claudeDispatch := "{\"$comment\":\"HABLO-installer claude\",\"default\":{\"harness\":\"claude\",\"model\":\"auto\"}}\n"
	if err := os.WriteFile(filepath.Join(hablo, "crew-dispatch-pi.json"), []byte(piDispatch), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hablo, "crew-dispatch-claude.json"), []byte(claudeDispatch), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := SetPreference(marker, fm, Claude); err != nil {
		t.Fatal(err)
	}
	if Read(marker) != Claude {
		t.Fatal(Read(marker))
	}
	if ReadCrewHarness(fm) != Claude {
		t.Fatal(ReadCrewHarness(fm))
	}
	got, err := os.ReadFile(filepath.Join(fm, "config", "crew-dispatch.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != claudeDispatch {
		t.Fatalf("dispatch: %s", got)
	}
	perm, err := os.ReadFile(filepath.Join(fm, "config", "claude-permission-mode"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(perm)) != "auto" {
		t.Fatalf("permission mode: %s", perm)
	}
	if err := SetPreference(marker, fm, Pi); err != nil {
		t.Fatal(err)
	}
	got, err = os.ReadFile(filepath.Join(fm, "config", "crew-dispatch.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != piDispatch {
		t.Fatalf("pi dispatch: %s", got)
	}
	w := WarnClaudeMissing(Claude)
	// May or may not be installed; just ensure the helper returns something coherent.
	if ClaudeOnPATH() {
		if w != "" {
			t.Fatalf("unexpected warn: %s", w)
		}
	} else if !strings.Contains(w, "not installed") {
		t.Fatalf("want missing warning, got %q", w)
	}
}
