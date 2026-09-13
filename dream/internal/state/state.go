package state

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

type Dismissal struct {
	Reason string    `json:"reason"`
	At     time.Time `json:"at"`
}
type State struct {
	Version    int                  `json:"version"`
	Dismissals map[string]Dismissal `json:"dismissals"`
	Proposed   map[string]time.Time `json:"proposed"`
	LastRun    time.Time            `json:"lastRun,omitempty"`
}

func New() State {
	return State{Version: 1, Dismissals: map[string]Dismissal{}, Proposed: map[string]time.Time{}}
}
func Load(path string) (State, error) {
	b, e := os.ReadFile(path)
	if os.IsNotExist(e) {
		return New(), nil
	}
	if e != nil {
		return State{}, e
	}
	s := New()
	if e = json.Unmarshal(b, &s); e != nil {
		return s, e
	}
	if s.Version != 1 {
		return s, &versionError{s.Version}
	}
	if s.Dismissals == nil {
		s.Dismissals = map[string]Dismissal{}
	}
	if s.Proposed == nil {
		s.Proposed = map[string]time.Time{}
	}
	return s, nil
}

type versionError struct{ v int }

func (e *versionError) Error() string { return "unsupported state version" }
func Save(path string, s State) error {
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	b, e := json.MarshalIndent(s, "", "  ")
	if e != nil {
		return e
	}
	tmp := path + ".tmp"
	if e = os.WriteFile(tmp, append(b, '\n'), 0600); e != nil {
		return e
	}
	return os.Rename(tmp, path)
}
