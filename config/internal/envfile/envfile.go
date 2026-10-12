package envfile

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Vars are the Jira credential keys hablo-config edits.
var Vars = []string{"JIRA_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"}

// Load reads KEY=VALUE pairs (optional export prefix); missing file → empty map.
func Load(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]string{}, nil
		}
		return nil, err
	}
	defer f.Close()
	out := map[string]string{}
	s := bufio.NewScanner(f)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if rest, ok := strings.CutPrefix(line, "export"); ok && len(rest) > 0 && (rest[0] == ' ' || rest[0] == '\t') {
			line = strings.TrimSpace(rest)
		}
		k, v, ok := strings.Cut(line, "=")
		if ok {
			out[strings.TrimSpace(k)] = strings.Trim(strings.TrimSpace(v), "\"'")
		}
	}
	return out, s.Err()
}

// Write0600 writes vars in Vars order (plus any extras preserved from previous load order).
// Follows a symlink to its target; always chmods the written file to 0600.
func Write0600(path string, values map[string]string) error {
	target, err := resolveWriteTarget(path)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	var b strings.Builder
	b.WriteString("# Managed by hablo-config. Mode 0600.\n")
	seen := map[string]bool{}
	for _, k := range Vars {
		fmt.Fprintf(&b, "%s=%s\n", k, values[k])
		seen[k] = true
	}
	for k, v := range values {
		if seen[k] {
			continue
		}
		fmt.Fprintf(&b, "%s=%s\n", k, v)
	}
	tmp := target + ".tmp"
	if err := os.WriteFile(tmp, []byte(b.String()), 0o600); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, target); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Chmod(target, 0o600)
}

func resolveWriteTarget(path string) (string, error) {
	fi, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return path, nil
		}
		return "", err
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		return path, nil
	}
	target, err := os.Readlink(path)
	if err != nil {
		return "", err
	}
	if !filepath.IsAbs(target) {
		target = filepath.Join(filepath.Dir(path), target)
	}
	return target, nil
}

// ModeString returns the permission bits of path (following symlinks for the target mode).
func ModeString(path string) string {
	fi, err := os.Stat(path)
	if err != nil {
		return "(missing)"
	}
	return fmt.Sprintf("%04o", fi.Mode().Perm())
}

// IsSymlink reports whether path is a symlink.
func IsSymlink(path string) bool {
	fi, err := os.Lstat(path)
	return err == nil && fi.Mode()&os.ModeSymlink != 0
}

// LinkSource returns the symlink target string, or "".
func LinkSource(path string) string {
	t, err := os.Readlink(path)
	if err != nil {
		return ""
	}
	return t
}

// TooOpen reports whether the file is readable beyond the owner.
func TooOpen(path string) bool {
	fi, err := os.Stat(path)
	if err != nil {
		return false
	}
	return fi.Mode().Perm()&0o077 != 0
}
