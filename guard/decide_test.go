package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/bmelton/HABLO-installer/guard/internal/decide"
	"github.com/bmelton/HABLO-installer/guard/internal/policy"
)

func writePolicy(t *testing.T, dir string) string {
	t.Helper()
	p := policy.Policy{
		Mode: "enforce",
		Engine: policy.Engine{
			TimeoutMs: 3000,
			AuditLog:  filepath.Join(dir, "guard-log.jsonl"),
			CacheDir:  filepath.Join(dir, "cache"),
		},
		Secrets: policy.Secrets{
			MaxScanBytes:  1 << 20,
			Paths:         []string{"**/.env", "**/.env.*", "**/id_rsa"},
			Patterns:      []string{`AKIA[0-9A-Z]{16}`, `ghp_[A-Za-z0-9]{36}`},
			ExfilCommands: []string{"curl", "scp"},
			ExfilHosts:    []string{"pastebin.com"},
		},
		ProtectedPaths: []policy.ProtectedPath{
			{Rule: "paths.vendored", Glob: "**/node_modules/**", Interactive: boolPtr(true)},
			{Rule: "paths.agentState", Glob: filepath.Join(dir, "hablo") + "/**", Interactive: boolPtr(false)},
			{Rule: "paths.foreign", OutsideProject: true, Interactive: boolPtr(true)},
		},
		Shell: policy.Shell{
			Interactive: boolPtr(true),
			Deny:        []string{`\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive\s+--force)`, `\bsudo\b`},
		},
	}
	falseVal := false
	p.Secrets.Interactive = &falseVal
	b, _ := json.MarshalIndent(p, "", "  ")
	path := filepath.Join(dir, "guard.json")
	if err := os.WriteFile(path, b, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func boolPtr(b bool) *bool { return &b }

func eng(t *testing.T) (*decide.Engine, string) {
	t.Helper()
	dir := t.TempDir()
	path := writePolicy(t, dir)
	home := dir
	return &decide.Engine{Loader: policy.NewLoader(path, home), Home: home}, dir
}

func TestDecideSecretsRead(t *testing.T) {
	e, dir := eng(t)
	proj := filepath.Join(dir, "proj")
	_ = os.MkdirAll(proj, 0o755)
	v, code := e.Decide(decide.Request{
		V: 1, Event: "tool_call", Agent: "pi", Tool: "read",
		Input:   map[string]any{"path": filepath.Join(proj, ".env")},
		Session: decide.Session{Kind: "crewmate", Attended: false, Project: proj, Cwd: proj},
	})
	if code != 0 || v.Verdict != "deny" || v.Rule != "secrets.read" {
		t.Fatalf("got %+v code=%d", v, code)
	}
}

func TestDecideSecretsContent(t *testing.T) {
	e, dir := eng(t)
	proj := filepath.Join(dir, "proj")
	_ = os.MkdirAll(proj, 0o755)
	v, code := e.Decide(decide.Request{
		V: 1, Event: "tool_call", Agent: "claude-code", Tool: "Write",
		Input: map[string]any{
			"file_path": filepath.Join(proj, "src/auth.go"),
			"content":   "key := \"AKIAIOSFODNN7EXAMPLE\"",
		},
		Session: decide.Session{Kind: "captain", Attended: true, Project: proj, Cwd: proj},
	})
	// interactive=false on secrets → deny even when attended
	if code != 0 || v.Verdict != "deny" || v.Rule != "secrets.content" {
		t.Fatalf("got %+v code=%d", v, code)
	}
}

func TestDecideShellDestructiveAskWhenAttended(t *testing.T) {
	e, dir := eng(t)
	proj := filepath.Join(dir, "proj")
	_ = os.MkdirAll(proj, 0o755)
	v, _ := e.Decide(decide.Request{
		V: 1, Event: "tool_call", Agent: "pi", Tool: "bash",
		Input:   map[string]any{"command": "rm -rf /tmp/x"},
		Session: decide.Session{Kind: "captain", Attended: true, Project: proj, Cwd: proj},
	})
	if v.Verdict != "ask" || v.Rule != "shell.destructive" {
		t.Fatalf("got %+v", v)
	}
	v2, _ := e.Decide(decide.Request{
		V: 1, Event: "tool_call", Agent: "pi", Tool: "bash",
		Input:   map[string]any{"command": "rm -rf /tmp/x"},
		Session: decide.Session{Kind: "crewmate", Attended: false, Project: proj, Cwd: proj},
	})
	if v2.Verdict != "deny" {
		t.Fatalf("crewmate got %+v", v2)
	}
}

func TestDecideForeignPath(t *testing.T) {
	e, dir := eng(t)
	proj := filepath.Join(dir, "proj")
	_ = os.MkdirAll(proj, 0o755)
	v, _ := e.Decide(decide.Request{
		V: 1, Event: "tool_call", Agent: "pi", Tool: "write",
		Input:   map[string]any{"path": filepath.Join(dir, "other", "x.go"), "content": "package x"},
		Session: decide.Session{Kind: "captain", Attended: false, Project: proj, Cwd: proj},
	})
	if v.Verdict != "deny" || v.Rule != "paths.foreign" {
		t.Fatalf("got %+v", v)
	}
}

func TestDecideAllowOrdinaryEdit(t *testing.T) {
	e, dir := eng(t)
	proj := filepath.Join(dir, "proj")
	_ = os.MkdirAll(filepath.Join(proj, "src"), 0o755)
	v, code := e.Decide(decide.Request{
		V: 1, Event: "tool_call", Agent: "pi", Tool: "edit",
		Input:   map[string]any{"path": filepath.Join(proj, "src/main.go"), "content": "package main\n"},
		Session: decide.Session{Kind: "solo", Attended: true, Project: proj, Cwd: proj},
	})
	if code != 0 || v.Verdict != "allow" {
		t.Fatalf("got %+v code=%d", v, code)
	}
}
