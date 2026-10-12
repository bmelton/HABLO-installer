package agent

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	Pi     = "pi"
	Claude = "claude"
)

// Read returns the preferred agent from the marker file (default pi).
func Read(markerPath string) string {
	b, err := os.ReadFile(markerPath)
	if err != nil {
		return Pi
	}
	v := strings.TrimSpace(string(b))
	switch v {
	case Pi, Claude:
		return v
	default:
		return Pi
	}
}

// Write saves the agent preference (pi or claude) to the marker.
func Write(markerPath, name string) error {
	name = strings.TrimSpace(name)
	if name != Pi && name != Claude {
		return fmt.Errorf("agent must be %q or %q", Pi, Claude)
	}
	if err := os.MkdirAll(filepath.Dir(markerPath), 0o755); err != nil {
		return err
	}
	tmp := markerPath + ".tmp"
	if err := os.WriteFile(tmp, []byte(name+"\n"), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, markerPath)
}

// WriteCrewHarness writes firstmate config/crew-harness.
func WriteCrewHarness(firstmateDir, name string) error {
	name = strings.TrimSpace(name)
	if name != Pi && name != Claude {
		return fmt.Errorf("crew-harness must be %q or %q", Pi, Claude)
	}
	path := filepath.Join(firstmateDir, "config", "crew-harness")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(name+"\n"), 0o644)
}

// ReadCrewHarness reads firstmate config/crew-harness (default pi).
func ReadCrewHarness(firstmateDir string) string {
	b, err := os.ReadFile(filepath.Join(firstmateDir, "config", "crew-harness"))
	if err != nil {
		return Pi
	}
	v := strings.TrimSpace(string(b))
	if v == Claude {
		return Claude
	}
	return Pi
}

// WriteClaudePermissionMode writes firstmate config/claude-permission-mode (auto for HABLO).
func WriteClaudePermissionMode(firstmateDir, mode string) error {
	path := filepath.Join(firstmateDir, "config", "claude-permission-mode")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(mode+"\n"), 0o644)
}

// ApplyCrewDispatch copies ~/.hablo/crew-dispatch-<name>.json over firstmate config/crew-dispatch.json
// when the destination is missing or HABLO-managed. Returns nil if the template is absent (older install).
func ApplyCrewDispatch(habloHome, firstmateDir, name string) error {
	name = strings.TrimSpace(name)
	if name != Pi && name != Claude {
		return fmt.Errorf("dispatch agent must be %q or %q", Pi, Claude)
	}
	src := filepath.Join(habloHome, "crew-dispatch-"+name+".json")
	body, err := os.ReadFile(src)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	dst := filepath.Join(firstmateDir, "config", "crew-dispatch.json")
	if cur, err := os.ReadFile(dst); err == nil {
		if len(cur) > 0 && !strings.Contains(string(cur), "HABLO-installer") {
			return nil // operator-owned
		}
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.WriteFile(dst, body, 0o644)
}

// ClaudeOnPATH reports whether a `claude` binary is findable.
func ClaudeOnPATH() bool {
	_, err := exec.LookPath("claude")
	return err == nil
}

// SetPreference writes marker + crew-harness + matching crew-dispatch (+ claude permission mode).
func SetPreference(markerPath, firstmateDir, name string) error {
	if err := Write(markerPath, name); err != nil {
		return err
	}
	if firstmateDir == "" {
		return nil
	}
	if _, err := os.Stat(filepath.Join(firstmateDir, "config")); err != nil {
		// firstmate not installed yet; marker alone is enough
		return nil
	}
	if err := WriteCrewHarness(firstmateDir, name); err != nil {
		return err
	}
	habloHome := filepath.Dir(markerPath)
	if err := ApplyCrewDispatch(habloHome, firstmateDir, name); err != nil {
		return err
	}
	if name == Claude {
		if err := WriteClaudePermissionMode(firstmateDir, "auto"); err != nil {
			return err
		}
	}
	return nil
}

// WarnClaudeMissing returns a user-facing warning when Claude is selected but missing.
func WarnClaudeMissing(selected string) string {
	if selected != Claude {
		return ""
	}
	if ClaudeOnPATH() {
		return ""
	}
	return "Claude Code is not installed (or not on PATH). Preference saved; `hablo` will prompt to install or exit when launched."
}
