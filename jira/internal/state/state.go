package state

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

type Entry struct {
	Status       string    `json:"status"`
	Attempts     int       `json:"attempts"`
	BackoffUntil time.Time `json:"backoffUntil,omitempty"`
	StartedAt    time.Time `json:"startedAt,omitempty"`
	LastOutcome  string    `json:"lastOutcome,omitempty"`
}
type State struct {
	Issues map[string]Entry `json:"issues"`
}
type Report struct {
	Key     string    `json:"key"`
	Outcome string    `json:"outcome"`
	PR      string    `json:"pr,omitempty"`
	Summary string    `json:"summary"`
	At      time.Time `json:"at"`
}

func Load(home string) (State, error) {
	b, e := os.ReadFile(filepath.Join(home, "state.json"))
	if errors.Is(e, os.ErrNotExist) {
		return State{Issues: map[string]Entry{}}, nil
	}
	if e != nil {
		return State{}, e
	}
	var s State
	e = json.Unmarshal(b, &s)
	if s.Issues == nil {
		s.Issues = map[string]Entry{}
	}
	return s, e
}
func Save(home string, s State) error {
	if e := os.MkdirAll(home, 0700); e != nil {
		return e
	}
	b, _ := json.MarshalIndent(s, "", "  ")
	tmp := filepath.Join(home, "state.json.tmp")
	if e := os.WriteFile(tmp, append(b, '\n'), 0600); e != nil {
		return e
	}
	return os.Rename(tmp, filepath.Join(home, "state.json"))
}
func Lock(home string) (*os.File, bool, error) {
	if e := os.MkdirAll(home, 0700); e != nil {
		return nil, false, e
	}
	f, e := os.OpenFile(filepath.Join(home, "run.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, false, e
	}
	if e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		f.Close()
		return nil, false, nil
	}
	return f, true, nil
}
func RunDir(home, key string) string { return filepath.Join(home, "runs", key) }
func WriteReport(home string, r Report) error {
	d := RunDir(home, r.Key)
	if _, e := os.Stat(d); e != nil {
		return e
	}
	r.At = time.Now().UTC()
	b, _ := json.MarshalIndent(r, "", "  ")
	return os.WriteFile(filepath.Join(d, "report.json"), append(b, '\n'), 0600)
}
func ReadReport(home, key string) (Report, error) {
	var r Report
	b, e := os.ReadFile(filepath.Join(RunDir(home, key), "report.json"))
	if e != nil {
		return r, e
	}
	e = json.Unmarshal(b, &r)
	return r, e
}
