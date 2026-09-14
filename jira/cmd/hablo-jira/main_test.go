package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func fixtureConfig(t *testing.T, server string) string {
	t.Helper()
	home := t.TempDir()
	env := filepath.Join(home, ".env")
	os.WriteFile(env, []byte(fmt.Sprintf("JIRA_URL=%s\nJIRA_EMAIL=e@example.com\nJIRA_API_TOKEN=token\n", server)), 0600)
	cfg := map[string]any{"enabled": true, "home": home, "envFile": env, "projects": map[string]any{"HABLO": map[string]any{"dir": home, "baseBranch": "main", "mode": "direct-PR", "statuses": map[string]string{"inProgress": "In Progress", "inReview": "In Review"}}}, "reporting": map[string]any{"enabled": true, "transitions": true}, "agent": map[string]any{"enabled": true, "labels": map[string]string{"ready": "agent-ready", "running": "agent-running", "done": "agent-done", "failed": "agent-failed"}}}
	b, _ := json.Marshal(cfg)
	p := filepath.Join(home, "config.json")
	os.WriteFile(p, b, 0600)
	return p
}
func TestCommentDedupe(t *testing.T) {
	var posted any
	posts := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "GET" && r.URL.Path == "/rest/api/3/issue/HABLO-1/comment":
			comments := []any{}
			if posted != nil {
				comments = []any{map[string]any{"body": posted}}
			}
			json.NewEncoder(w).Encode(map[string]any{"comments": comments})
		case r.Method == "POST" && r.URL.Path == "/rest/api/3/issue/HABLO-1/comment":
			var x map[string]any
			json.NewDecoder(r.Body).Decode(&x)
			posted = x["body"]
			posts++
			w.WriteHeader(201)
		default:
			http.NotFound(w, r)
		}
	}))
	defer s.Close()
	cfg := fixtureConfig(t, s.URL)
	body := filepath.Join(t.TempDir(), "body.md")
	os.WriteFile(body, []byte("built it"), 0600)
	t.Setenv("FM_TASK_ID", "crew-1")
	var out bytes.Buffer
	args := []string{"comment", "--config", cfg, "--key", "HABLO-1", "--stage", "spec", "--body", "@" + body}
	if code := run(args, &out, &out); code != 0 {
		t.Fatalf("first code=%d: %s", code, out.String())
	}
	if code := run(args, &out, &out); code != 0 {
		t.Fatalf("second code=%d: %s", code, out.String())
	}
	if posts != 1 {
		t.Fatalf("posts=%d", posts)
	}
}
func TestTransitionRefusesDoneCategory(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := map[string]any{
			"transitions": []any{
				map[string]any{
					"id": "9", "name": "Finish",
					"to": map[string]any{"name": "In Progress", "statusCategory": map[string]any{"key": "done"}},
				},
			},
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer s.Close()
	cfg := fixtureConfig(t, s.URL)
	var out bytes.Buffer
	if code := run([]string{"transition", "--config", cfg, "--key", "HABLO-1", "--to", "in-progress"}, &out, &out); code != 4 {
		t.Fatalf("code=%d: %s", code, out.String())
	}
}

func TestMissingSections(t *testing.T) {
	full := "## Background / Context\n\nwhy\n\n## Acceptance Criteria\n\n- a\n"
	if got := missingSections(full); len(got) != 0 {
		t.Fatalf("complete body reported %v", got)
	}
	if got := missingSections("### background / context\n\nwhy\n"); len(got) != 1 || got[0] != "Acceptance Criteria" {
		t.Fatalf("got %v, want [Acceptance Criteria]", got)
	}
	if got := missingSections("just prose"); len(got) != 2 {
		t.Fatalf("got %v, want both sections", got)
	}
	// The words appearing as body text must not count as a heading.
	if got := missingSections("Acceptance Criteria are listed below.\nBackground / Context too.\n"); len(got) != 2 {
		t.Fatalf("prose mentioning the names reported %v, want both missing", got)
	}
}

func TestCreateAssignsSelfAndSprint(t *testing.T) {
	var created map[string]any
	var movedTo string
	sprintCreated := false
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/rest/api/3/myself":
			json.NewEncoder(w).Encode(map[string]any{"accountId": "acc-1", "emailAddress": "e@example.com"})
		case r.Method == "POST" && r.URL.Path == "/rest/api/3/issue":
			json.NewDecoder(r.Body).Decode(&created)
			json.NewEncoder(w).Encode(map[string]any{"key": "HABLO-7"})
		case r.URL.Path == "/rest/agile/1.0/board":
			json.NewEncoder(w).Encode(map[string]any{"values": []any{
				map[string]any{"id": 9, "name": "kb", "type": "kanban"},
				map[string]any{"id": 3, "name": "sb", "type": "scrum"},
			}})
		case r.URL.Path == "/rest/agile/1.0/board/3/sprint":
			json.NewEncoder(w).Encode(map[string]any{"values": []any{}})
		case r.Method == "POST" && r.URL.Path == "/rest/agile/1.0/sprint":
			sprintCreated = true
			json.NewEncoder(w).Encode(map[string]any{"id": 42, "name": "To Schedule", "state": "future"})
		case r.Method == "POST" && r.URL.Path == "/rest/agile/1.0/sprint/42/issue":
			movedTo = "42"
			w.WriteHeader(204)
		default:
			w.WriteHeader(404)
		}
	}))
	defer s.Close()
	cfg := fixtureConfig(t, s.URL)
	bodyFile := filepath.Join(t.TempDir(), "b.md")
	os.WriteFile(bodyFile, []byte("## Background / Context\n\nwhy\n\n## Acceptance Criteria\n\n- a\n"), 0600)
	var out, errout bytes.Buffer
	if rc := run([]string{"create", "--config", cfg, "--project", "HABLO", "--summary", "s", "--body", "@" + bodyFile}, &out, &errout); rc != 0 {
		t.Fatalf("rc=%d err=%s", rc, errout.String())
	}
	fields := created["fields"].(map[string]any)
	if a, ok := fields["assignee"].(map[string]any); !ok || a["accountId"] != "acc-1" {
		t.Fatalf("assignee not set: %v", fields["assignee"])
	}
	if _, ok := fields["labels"]; ok {
		t.Fatalf("labels set without --ready: %v", fields["labels"])
	}
	if !sprintCreated || movedTo != "42" {
		t.Fatalf("sprint created=%v moved=%q", sprintCreated, movedTo)
	}
	// The description must reach Jira as structured ADF, not one flat paragraph.
	doc := fields["description"].(map[string]any)
	nodes := doc["content"].([]any)
	if nodes[0].(map[string]any)["type"] != "heading" {
		t.Fatalf("first node = %v, want heading", nodes[0])
	}
	if errout.Len() != 0 {
		t.Fatalf("unexpected warning: %s", errout.String())
	}
}

func TestCreateWarnsAndLabelsReady(t *testing.T) {
	var created map[string]any
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/rest/api/3/myself":
			json.NewEncoder(w).Encode(map[string]any{"accountId": "acc-1"})
		case r.Method == "POST" && r.URL.Path == "/rest/api/3/issue":
			json.NewDecoder(r.Body).Decode(&created)
			json.NewEncoder(w).Encode(map[string]any{"key": "HABLO-8"})
		default:
			w.WriteHeader(404) // no board: sprint assignment must degrade to a note
		}
	}))
	defer s.Close()
	cfg := fixtureConfig(t, s.URL)
	bodyFile := filepath.Join(t.TempDir(), "b.md")
	os.WriteFile(bodyFile, []byte("no sections here\n"), 0600)
	var out, errout bytes.Buffer
	rc := run([]string{"create", "--config", cfg, "--project", "HABLO", "--summary", "s", "--body", "@" + bodyFile, "--ready"}, &out, &errout)
	if rc != 0 {
		t.Fatalf("rc=%d err=%s", rc, errout.String())
	}
	if !bytes.Contains(errout.Bytes(), []byte("Background / Context")) {
		t.Fatalf("no guideline warning: %s", errout.String())
	}
	if !bytes.Contains(errout.Bytes(), []byte("backlog")) {
		t.Fatalf("missing sprint fallback note: %s", errout.String())
	}
	labels := created["fields"].(map[string]any)["labels"].([]any)
	if len(labels) != 1 || labels[0] != "agent-ready" {
		t.Fatalf("labels = %v", labels)
	}
}
