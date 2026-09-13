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
	cfg := map[string]any{"enabled": true, "home": home, "envFile": env, "projects": map[string]any{"HABLO": map[string]any{"dir": home, "baseBranch": "main", "mode": "direct-PR", "statuses": map[string]string{"inProgress": "In Progress", "inReview": "In Review"}}}, "reporting": map[string]any{"enabled": true, "transitions": true}}
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
