package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestDryRunShowsClaimAndLaunchWithoutWrites(t *testing.T) {
	var jql string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rest/api/3/search/jql" {
			http.NotFound(w, r)
			return
		}
		var request map[string]any
		json.NewDecoder(r.Body).Decode(&request)
		jql, _ = request["jql"].(string)
		description := map[string]any{"type": "doc", "version": 1, "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": "Build it"}}}}}
		fields := map[string]any{"summary": "Demo", "description": description, "issuetype": map[string]any{"name": "Task"}, "priority": map[string]any{"name": "High"}, "labels": []string{"agent-ready"}, "reporter": map[string]any{"accountId": "a", "displayName": "Demo"}}
		json.NewEncoder(w).Encode(map[string]any{"isLast": true, "issues": []any{map[string]any{"key": "HABLO-7", "fields": fields}}})
	}))
	defer srv.Close()
	home := t.TempDir()
	repo := filepath.Join(home, "repo")
	os.MkdirAll(repo, 0700)
	exec.Command("git", "init", "--quiet", repo).Run()
	bin := filepath.Join(home, "bin")
	os.MkdirAll(bin, 0700)
	for _, name := range []string{"tmux", "pi", "hablo", "gh"} {
		os.WriteFile(filepath.Join(bin, name), []byte("#!/bin/sh\nexit 0\n"), 0700)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	env := filepath.Join(home, ".env")
	os.WriteFile(env, []byte(fmt.Sprintf("JIRA_URL=%s\nJIRA_EMAIL=e\nJIRA_API_TOKEN=t\n", srv.URL)), 0600)
	tmpl := filepath.Join(home, "brief.tmpl.md")
	os.WriteFile(tmpl, []byte("{{.Key}} {{.Description}}"), 0600)
	cfg := map[string]any{"enabled": true, "home": home, "envFile": env, "projects": map[string]any{"HABLO": map[string]any{"dir": repo, "baseBranch": "main", "mode": "direct-PR"}}, "agent": map[string]any{"enabled": true, "maxConcurrent": 1, "labels": map[string]any{"ready": "agent-ready", "running": "agent-running", "done": "agent-done", "failed": "agent-failed"}}}
	raw, _ := json.Marshal(cfg)
	cp := filepath.Join(home, "config.json")
	os.WriteFile(cp, raw, 0600)
	var out bytes.Buffer
	if code := run([]string{"tick", "--config", cp, "--dry-run"}, &out, &out); code != 0 {
		t.Fatalf("code=%d: %s", code, out.String())
	}
	if !strings.Contains(out.String(), "PUT /rest/api/3/issue/HABLO-7") || !strings.Contains(out.String(), "tmux new-session") {
		t.Fatalf("output: %s", out.String())
	}
	if !strings.Contains(jql, `labels = "agent-ready"`) {
		t.Fatalf("jql=%s", jql)
	}
	if _, e := os.Stat(filepath.Join(home, "runs")); !os.IsNotExist(e) {
		t.Fatalf("dry run wrote runs directory")
	}
	if _, e := os.Stat(filepath.Join(home, "run.lock")); !os.IsNotExist(e) {
		t.Fatalf("dry run wrote a lock file")
	}
}
