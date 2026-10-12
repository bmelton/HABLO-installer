package resolve

import (
	"os"
	"path/filepath"
	"strings"
)

// Path expands ~, joins relative paths against cwd, and cleans. Missing
// targets resolve as if created under an existing parent (symlink-aware Abs).
func Path(p, cwd, home string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	if strings.HasPrefix(p, "~/") || p == "~" {
		home = strings.TrimRight(home, string(filepath.Separator))
		if home == "" {
			home, _ = os.UserHomeDir()
		}
		if p == "~" {
			p = home
		} else {
			p = filepath.Join(home, p[2:])
		}
	}
	if !filepath.IsAbs(p) {
		base := cwd
		if base == "" {
			base, _ = os.Getwd()
		}
		p = filepath.Join(base, p)
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return filepath.Clean(p)
	}
	// Resolve existing symlinks; for non-existent files, resolve the parent.
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		return resolved
	}
	dir := filepath.Dir(abs)
	base := filepath.Base(abs)
	if resolved, err := filepath.EvalSymlinks(dir); err == nil {
		return filepath.Join(resolved, base)
	}
	return abs
}
