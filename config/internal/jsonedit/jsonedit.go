package jsonedit

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// Load reads a JSON object, preserving unknown keys (including $comment*).
func Load(path string) (map[string]any, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	if err := dec.Decode(&m); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	if m == nil {
		m = map[string]any{}
	}
	return m, nil
}

// Write marshals obj with indent and writes atomically at mode (default 0644).
func Write(path string, obj map[string]any, mode os.FileMode) error {
	if mode == 0 {
		mode = 0o644
	}
	b, err := json.MarshalIndent(obj, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	return writeAtomic(path, b, mode)
}

func writeAtomic(path string, b []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, mode); err != nil {
		return err
	}
	if err := os.Chmod(tmp, mode); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

// GetString returns a string field or "".
func GetString(m map[string]any, key string) string {
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case json.Number:
		return t.String()
	default:
		return fmt.Sprint(t)
	}
}

// GetBool returns a bool field or def when absent.
func GetBool(m map[string]any, key string, def bool) bool {
	v, ok := m[key]
	if !ok || v == nil {
		return def
	}
	b, ok := v.(bool)
	if !ok {
		return def
	}
	return b
}

// GetMap returns an object field or empty map.
func GetMap(m map[string]any, key string) map[string]any {
	v, ok := m[key]
	if !ok || v == nil {
		return map[string]any{}
	}
	child, ok := v.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return child
}

// GetNumberString returns a numeric or string field as string.
func GetNumberString(m map[string]any, key string) string {
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case json.Number:
		return t.String()
	case float64:
		if t == float64(int64(t)) {
			return fmt.Sprintf("%d", int64(t))
		}
		return fmt.Sprint(t)
	default:
		return fmt.Sprint(t)
	}
}

// SetString sets key to s (empty string is still written).
func SetString(m map[string]any, key, s string) { m[key] = s }

// SetBool sets a boolean field.
func SetBool(m map[string]any, key string, v bool) { m[key] = v }

// SetIntString parses s as int and stores as json number-friendly float64, or deletes when empty.
func SetIntString(m map[string]any, key, s string) error {
	s = trim(s)
	if s == "" {
		delete(m, key)
		return nil
	}
	var n json.Number = json.Number(s)
	if _, err := n.Int64(); err != nil {
		return fmt.Errorf("%s: %w", key, err)
	}
	m[key] = n
	return nil
}

func trim(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	return s
}

// MarshalTemp writes obj to a temp file and returns its path (caller must remove).
func MarshalTemp(obj map[string]any) (string, error) {
	b, err := json.MarshalIndent(obj, "", "  ")
	if err != nil {
		return "", err
	}
	f, err := os.CreateTemp("", "hablo-config-*.json")
	if err != nil {
		return "", err
	}
	name := f.Name()
	if _, err := f.Write(append(b, '\n')); err != nil {
		f.Close()
		os.Remove(name)
		return "", err
	}
	if err := f.Close(); err != nil {
		os.Remove(name)
		return "", err
	}
	return name, nil
}
