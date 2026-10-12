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
	if err := SetPreference(marker, fm, Claude); err != nil {
		t.Fatal(err)
	}
	if Read(marker) != Claude {
		t.Fatal(Read(marker))
	}
	if ReadCrewHarness(fm) != Claude {
		t.Fatal(ReadCrewHarness(fm))
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
