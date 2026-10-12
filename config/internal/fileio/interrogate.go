package fileio

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// InterrogateRuntime is ~/.hablo/interrogate.json.
type InterrogateRuntime struct {
	Enabled bool `json:"enabled"`
}

// ReadInterrogate loads runtime interrogate.json (missing → enabled false).
func ReadInterrogate(habloHome string) InterrogateRuntime {
	b, err := os.ReadFile(filepath.Join(habloHome, "interrogate.json"))
	if err != nil {
		return InterrogateRuntime{}
	}
	var r InterrogateRuntime
	_ = json.Unmarshal(b, &r)
	return r
}

// WriteInterrogateEnabled updates enabled while preserving other JSON keys.
func WriteInterrogateEnabled(habloHome string, enabled bool) error {
	path := filepath.Join(habloHome, "interrogate.json")
	var obj map[string]any
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &obj)
	}
	if obj == nil {
		obj = map[string]any{}
	}
	obj["enabled"] = enabled
	body, err := json.MarshalIndent(obj, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	if err := os.MkdirAll(habloHome, 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, body, 0o644)
}

// SetInterrogateCaptainBlock inserts or removes HABLO:INTERROGATE-POLICY in captain.md.
func SetInterrogateCaptainBlock(firstmateDir, policyPath string, enabled bool) error {
	capPath := filepath.Join(firstmateDir, "data", "captain.md")
	blockRe := regexp.MustCompile(`(?s)<!-- HABLO:INTERROGATE-POLICY:START -->.*?<!-- HABLO:INTERROGATE-POLICY:END -->\n?`)
	cur := ""
	if b, err := os.ReadFile(capPath); err == nil {
		cur = string(b)
	}
	if !enabled {
		if !blockRe.MatchString(cur) {
			return nil
		}
		next := blockRe.ReplaceAllString(cur, "")
		next = regexp.MustCompile(`\n{3,}`).ReplaceAllString(next, "\n\n")
		if err := os.MkdirAll(filepath.Dir(capPath), 0o755); err != nil {
			return err
		}
		return os.WriteFile(capPath, []byte(next), 0o644)
	}
	policy, err := os.ReadFile(policyPath)
	if err != nil {
		return fmt.Errorf("interrogate policy: %w", err)
	}
	text := strings.TrimSpace(string(policy)) + "\n"
	var next string
	if blockRe.MatchString(cur) {
		next = blockRe.ReplaceAllString(cur, text)
	} else if cur == "" {
		next = "# Captain preferences\n\n" + text
	} else {
		next = strings.TrimRight(cur, "\n") + "\n\n" + text
	}
	if err := os.MkdirAll(filepath.Dir(capPath), 0o755); err != nil {
		return err
	}
	return os.WriteFile(capPath, []byte(next), 0o644)
}

// InterrogatePolicyPath prefers ~/.hablo/interrogate/policy.md.
func InterrogatePolicyPath(habloHome string) string {
	return filepath.Join(habloHome, "interrogate", "policy.md")
}
