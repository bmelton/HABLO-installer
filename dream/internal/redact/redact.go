package redact

import (
	"encoding/json"
	"os"
	"regexp"
)

var fallback = []string{
	`(?i)(api[_-]?key|token|password|secret)\s*[:=]\s*["']?[^\s"']+`,
	`AKIA[0-9A-Z]{16}`,
	`gh[opsu]_[A-Za-z0-9_]{20,}`,
	`sk-[A-Za-z0-9_-]{20,}`,
}

type Redactor struct{ patterns []*regexp.Regexp }

func Load(guardPath string) (*Redactor, error) {
	patterns := append([]string(nil), fallback...)
	if b, err := os.ReadFile(guardPath); err == nil {
		var raw struct {
			Secrets struct {
				Patterns []string `json:"patterns"`
			} `json:"secrets"`
		}
		if err := json.Unmarshal(b, &raw); err != nil {
			return nil, err
		}
		if len(raw.Secrets.Patterns) > 0 {
			patterns = raw.Secrets.Patterns
		}
	}
	r := &Redactor{}
	for _, p := range patterns {
		re, err := regexp.Compile(p)
		if err != nil {
			return nil, err
		}
		r.patterns = append(r.patterns, re)
	}
	return r, nil
}

func (r *Redactor) Text(s string) string {
	for _, p := range r.patterns {
		s = p.ReplaceAllString(s, "[REDACTED]")
	}
	return s
}
