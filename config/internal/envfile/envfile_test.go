package envfile

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWrite0600(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "jira.env")
	if err := Write0600(path, map[string]string{
		"JIRA_URL":       "https://example.atlassian.net",
		"JIRA_EMAIL":     "a@b.c",
		"JIRA_API_TOKEN": "tok",
	}); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("mode %04o", fi.Mode().Perm())
	}
	vals, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if vals["JIRA_API_TOKEN"] != "tok" {
		t.Fatalf("%v", vals)
	}
}

func TestWrite0600ThroughSymlink(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "secret")
	link := filepath.Join(dir, "link")
	if err := os.WriteFile(target, []byte("JIRA_URL=old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if err := Write0600(link, map[string]string{"JIRA_URL": "https://x", "JIRA_EMAIL": "e", "JIRA_API_TOKEN": "t"}); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("target mode %04o", fi.Mode().Perm())
	}
	if !IsSymlink(link) {
		t.Fatal("link should remain a symlink")
	}
}
