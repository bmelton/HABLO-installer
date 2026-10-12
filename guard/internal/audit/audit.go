package audit

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

type Line struct {
	TS      string `json:"ts"`
	Kind    string `json:"kind,omitempty"`
	Task    string `json:"task,omitempty"`
	Project string `json:"project,omitempty"`
	Tool    string `json:"tool,omitempty"`
	Rule    string `json:"rule,omitempty"`
	Verdict string `json:"verdict,omitempty"`
	Target  string `json:"target,omitempty"`
	Match   string `json:"match,omitempty"`
	Reason  string `json:"reason,omitempty"`
	Level   string `json:"level,omitempty"`
	Note    string `json:"note,omitempty"`
}

func Append(path string, line Line) error {
	if path == "" {
		return nil
	}
	if line.TS == "" {
		line.TS = time.Now().UTC().Format(time.RFC3339)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	b, err := json.Marshal(line)
	if err != nil {
		return err
	}
	_, err = f.Write(append(b, '\n'))
	return err
}
