package fileio

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Valid backends for firstmate config/backend. Empty means auto-detect (file absent).
var BackendOptions = []string{"", "tmux", "herdr"}

// ReadBackend returns firstmate config/backend contents (empty if absent / auto).
func ReadBackend(fmDir string) string {
	b, err := os.ReadFile(filepath.Join(fmDir, "config", "backend"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// WriteBackend writes or removes config/backend. Empty value removes the file (auto-detect).
// Only "", "tmux", and "herdr" are accepted.
func WriteBackend(fmDir, value string) error {
	value = strings.TrimSpace(value)
	if !ValidBackend(value) {
		return fmt.Errorf("backend must be empty (auto), tmux, or herdr (got %q)", value)
	}
	path := filepath.Join(fmDir, "config", "backend")
	if value == "" {
		err := os.Remove(path)
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(value+"\n"), 0o644)
}

// ValidBackend reports whether value is an allowed backend setting.
func ValidBackend(value string) bool {
	for _, o := range BackendOptions {
		if o == value {
			return true
		}
	}
	return false
}

// ReadBriefInclude reads config/brief-include.md.
func ReadBriefInclude(fmDir string) (string, error) {
	b, err := os.ReadFile(filepath.Join(fmDir, "config", "brief-include.md"))
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// WriteBriefInclude writes config/brief-include.md.
func WriteBriefInclude(fmDir, body string) error {
	path := filepath.Join(fmDir, "config", "brief-include.md")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(body), 0o644)
}
