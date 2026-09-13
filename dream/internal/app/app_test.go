package app

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bmelton/hablo-installer/dream/internal/cluster"
	"github.com/bmelton/hablo-installer/dream/internal/config"
	"github.com/bmelton/hablo-installer/dream/internal/model"
	"github.com/bmelton/hablo-installer/dream/internal/pisession"
	"github.com/bmelton/hablo-installer/dream/internal/redact"
	"github.com/bmelton/hablo-installer/dream/internal/signal"
)

func TestGoldenDigest(t *testing.T) {
	root := filepath.Join("..", "..", "testdata")
	turns, err := pisession.ReadFile(filepath.Join(root, "pi", "correction.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if len(turns) != 2 {
		t.Fatalf("compaction should leave 2 active turns, got %d", len(turns))
	}
	in := make([]signal.Turn, len(turns))
	for i, x := range turns {
		in[i] = signal.Turn{ID: x.ID, Role: x.Role, Text: x.Text, Source: "testdata/pi/correction.jsonl", Project: x.Project, Timestamp: x.Timestamp}
	}
	evidence := signal.Corrections(in, []string{"no"})
	clusters, overflow := cluster.Group(evidence, 40, 5)
	d := model.Digest{Version: 1, Generated: time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC), Since: time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC), Clusters: clusters, Overflow: overflow}
	got, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	got = append(got, '\n')
	want, err := os.ReadFile(filepath.Join(root, "golden", "digest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatalf("digest mismatch\n--- got ---\n%s\n--- want ---\n%s", got, want)
	}
}

func TestProposalRequiresCitation(t *testing.T) {
	d := model.Digest{Version: 1, Clusters: []model.Cluster{{Evidence: []model.Evidence{{ID: "e-1"}}}}}
	_, err := parseProposals(`{"version":1,"proposals":[{"id":1,"title":"x","problem":"repeat","target":{"repo":"/tmp/r","file":"A.md","kind":"instruction"},"change":{"kind":"append-section","heading":"h","body":"b"},"evidence":[],"confidence":"high","alreadyCovered":null}]}`, d)
	if err == nil || !strings.Contains(err.Error(), "no citation") {
		t.Fatalf("expected missing citation rejection, got %v", err)
	}
}

func TestUnknownSessionVersionFails(t *testing.T) {
	p := filepath.Join(t.TempDir(), "bad.jsonl")
	if err := os.WriteFile(p, []byte(`{"type":"session","version":4,"id":"x"}`+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := pisession.ReadFile(p); err == nil {
		t.Fatal("expected unknown version failure")
	}
}

func TestFallbackRedaction(t *testing.T) {
	r, err := redact.Load(filepath.Join(t.TempDir(), "missing-guard.json"))
	if err != nil {
		t.Fatal(err)
	}
	got := r.Text("API_KEY=super-secret-value token: abcdef ghp_abcdefghijklmnopqrstuvwxyz")
	if got != "[REDACTED] [REDACTED] [REDACTED]" {
		t.Fatalf("secret leaked: %q", got)
	}
}

func TestApplyCreatesReviewedGitChange(t *testing.T) {
	repo := filepath.Join(t.TempDir(), "repo")
	if err := os.MkdirAll(repo, 0700); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"init", "-q"}, {"config", "user.name", "Dream Test"}, {"config", "user.email", "dream@example.invalid"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = repo
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
	}
	file := filepath.Join(repo, "AGENTS.md")
	if err := os.WriteFile(file, []byte("# Rules\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("git", "add", "AGENTS.md")
	cmd.Dir = repo
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	cmd = exec.Command("git", "commit", "-qm", "initial")
	cmd.Dir = repo
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	fakeBin := t.TempDir()
	gh := filepath.Join(fakeBin, "gh")
	if err := os.WriteFile(gh, []byte("#!/bin/sh\necho https://example.invalid/pr/1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", fakeBin+string(os.PathListSeparator)+os.Getenv("PATH"))
	home := t.TempDir()
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	proposals := model.Proposals{Version: 1, Generated: now, Items: []model.Proposal{{ID: 1, Title: "Generated files", Target: model.Target{Repo: repo, File: "AGENTS.md", Kind: "instruction"}, Change: model.Change{Kind: "append-section", Heading: "Generated code", Body: "Never edit generated files."}, Evidence: []string{"e-1"}, Confidence: "high"}}}
	if err := writeJSON(filepath.Join(home, "proposals-2026-09-13.json"), proposals); err != nil {
		t.Fatal(err)
	}
	a := &App{Config: config.Config{Home: home}, Now: func() time.Time { return now }}
	urls, err := a.Apply([]int{1})
	if err != nil {
		t.Fatal(err)
	}
	if len(urls) != 1 || urls[0] != "https://example.invalid/pr/1" {
		t.Fatalf("urls = %#v", urls)
	}
	body, _ := os.ReadFile(file)
	if !strings.Contains(string(body), "Never edit generated files.") {
		t.Fatalf("change not applied: %s", body)
	}
}
