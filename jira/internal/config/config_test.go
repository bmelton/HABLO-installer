package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadExpandsAndLoadsCredentials(t *testing.T) {
	h := t.TempDir()
	env := filepath.Join(h, ".env")
	os.WriteFile(env, []byte("JIRA_URL=https://x.atlassian.net\nJIRA_EMAIL=e\nJIRA_API_TOKEN=t\n"), 0600)
	c := Config{Enabled: true, Home: h, EnvFile: env, Projects: map[string]Project{"DEMO": {Dir: h, BaseBranch: "main", Mode: "direct-PR"}}, Agent: Agent{Enabled: true, Labels: Labels{Ready: "r", Running: "x", Done: "d", Failed: "f"}}}
	raw, _ := json.Marshal(c)
	p := filepath.Join(h, "config.json")
	os.WriteFile(p, raw, 0600)
	got, cred, e := Load(p)
	if e != nil {
		t.Fatal(e)
	}
	if !cred.Complete() || got.Projects["DEMO"].Dir != h {
		t.Fatalf("bad load: %#v %#v", got, cred)
	}
}

func TestLoadEnvAcceptsExportPrefix(t *testing.T) {
	h := t.TempDir()
	env := filepath.Join(h, ".env")
	// Same shape as a secrets file sourced from bashrc.
	os.WriteFile(env, []byte("export JIRA_URL=https://x.atlassian.net\nexport JIRA_EMAIL=e\nexport JIRA_API_TOKEN=t\n"), 0600)
	got, err := loadEnv(env)
	if err != nil {
		t.Fatal(err)
	}
	if got["JIRA_URL"] != "https://x.atlassian.net" || got["JIRA_EMAIL"] != "e" || got["JIRA_API_TOKEN"] != "t" {
		t.Fatalf("export-prefixed env not loaded: %#v", got)
	}
	if _, bad := got["export JIRA_URL"]; bad {
		t.Fatal("kept export as part of the key")
	}
}
func TestRejectsLocalOnly(t *testing.T) {
	h := t.TempDir()
	c := Config{Home: h, EnvFile: filepath.Join(h, ".env"), Projects: map[string]Project{"DEMO": {Dir: h, BaseBranch: "main", Mode: "local-only"}}}
	if e := c.Validate(); e == nil {
		t.Fatal("accepted local-only")
	}
}

func TestIssueKeyCannotEscapeRunDirectory(t *testing.T) {
	c := Config{Projects: map[string]Project{"DEMO": {Dir: "/tmp", BaseBranch: "main", Mode: "direct-PR"}}}
	if _, ok := c.ProjectFor("DEMO-7"); !ok {
		t.Fatal("valid key rejected")
	}
	if _, ok := c.ProjectFor("DEMO-../../escape"); ok {
		t.Fatal("unsafe key accepted")
	}
}
