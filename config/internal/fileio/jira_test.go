package fileio

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/bmelton/HABLO-installer/config/internal/jsonedit"
)

func TestJiraRoundTripPreservesComment(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	home := filepath.Join(dir, "jira-home")
	env := filepath.Join(dir, "env")
	if err := os.MkdirAll(home, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(env, []byte("JIRA_URL=https://x\nJIRA_EMAIL=e\nJIRA_API_TOKEN=t\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	src := `{
  "$comment": "keep me",
  "enabled": true,
  "home": "` + home + `",
  "envFile": "` + env + `",
  "projects": {
    "HAB": {"dir": "` + home + `", "baseBranch": "main", "mode": "direct-PR"}
  },
  "reporting": {"enabled": true, "transitions": true, "stages": ["triage"]},
  "agent": {
    "enabled": false,
    "binName": "hablo-jira-agent",
    "intervalSeconds": 20,
    "labels": {"ready": "a", "running": "b", "done": "c", "failed": "d"},
    "jqlExtra": "",
    "maxConcurrent": 1,
    "maxAttempts": 3,
    "runTimeoutMinutes": 240,
    "commentOnDispatch": false,
    "reporterAllowlist": [],
    "service": {"kind": "auto", "launchdLabel": "x", "systemdUnit": "y"}
  }
}
`
	if err := os.WriteFile(path, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	obj, err := LoadJiraObject(path)
	if err != nil {
		t.Fatal(err)
	}
	if jsonedit.GetString(obj, "$comment") != "keep me" {
		t.Fatal(obj["$comment"])
	}
	jsonedit.SetBool(obj, "enabled", false)
	if err := SaveJiraObject(path, obj); err != nil {
		t.Fatal(err)
	}
	obj2, err := LoadJiraObject(path)
	if err != nil {
		t.Fatal(err)
	}
	if jsonedit.GetString(obj2, "$comment") != "keep me" {
		t.Fatal("comment lost")
	}
	if jsonedit.GetBool(obj2, "enabled", true) {
		t.Fatal("enabled not updated")
	}
}
