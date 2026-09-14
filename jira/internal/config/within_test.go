package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWithin(t *testing.T) {
	root := t.TempDir()
	cases := []struct {
		path string
		want bool
		why  string
	}{
		{root, true, "the root itself"},
		{filepath.Join(root, "proj"), true, "direct child"},
		{filepath.Join(root, "a", "b", "c"), true, "deep child"},
		{filepath.Dir(root), false, "the parent"},
		{root + "-sibling", false, "prefix sibling must not match"},
		{filepath.Join(root, "..", "escape"), false, "traversal out of the root"},
		{"/", false, "filesystem root"},
	}
	for _, c := range cases {
		if got := Within(root, c.path); got != c.want {
			t.Errorf("Within(%q, %q) = %v, want %v (%s)", root, c.path, got, c.want, c.why)
		}
	}
}

// A project reached through a symlink whose target sits outside the root must not pass, or the containment check is
// bypassed by a single ln -s.
func TestWithinResolvesSymlinks(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "root")
	outside := filepath.Join(base, "outside")
	for _, d := range []string{root, outside} {
		if e := os.MkdirAll(d, 0700); e != nil {
			t.Fatal(e)
		}
	}
	link := filepath.Join(root, "sneaky")
	if e := os.Symlink(outside, link); e != nil {
		t.Skipf("symlinks unavailable: %v", e)
	}
	if Within(root, link) {
		t.Fatalf("Within(%q, %q) = true; a symlink out of the root must not count as inside", root, link)
	}
}

func TestValidateRejectsProjectOutsideRoot(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "root")
	os.MkdirAll(root, 0700)
	c := Config{
		Home: base, EnvFile: filepath.Join(base, ".env"), Root: root,
		Agent:    Agent{Enabled: true, Labels: Labels{Ready: "r", Running: "u", Done: "d", Failed: "f"}},
		Projects: map[string]Project{"HAB": {Dir: filepath.Join(base, "elsewhere"), BaseBranch: "main", Mode: "direct-PR"}},
	}
	if e := c.Validate(); e == nil {
		t.Fatal("expected Validate to reject a project outside the root")
	}
	c.Projects["HAB"] = Project{Dir: filepath.Join(root, "inside"), BaseBranch: "main", Mode: "direct-PR"}
	if e := c.Validate(); e != nil {
		t.Fatalf("project inside the root was rejected: %v", e)
	}
}

func TestSandboxRequiredDefaults(t *testing.T) {
	if (Config{}).SandboxRequired() {
		t.Error("no root configured must not require a sandbox")
	}
	if !(Config{Root: "/x"}).SandboxRequired() {
		t.Error("a configured root must require a sandbox by default")
	}
	no := false
	if (Config{Root: "/x", RequireSandbox: &no}).SandboxRequired() {
		t.Error("requireSandbox=false must be honoured")
	}
}

func TestEffectiveRootPrecedence(t *testing.T) {
	c := Config{Root: "/a/global"}
	if got := c.EffectiveRoot(Project{}); got != "/a/global" {
		t.Errorf("no project root: got %q, want the global one", got)
	}
	if got := c.EffectiveRoot(Project{Root: "/a/global/narrow"}); got != "/a/global/narrow" {
		t.Errorf("narrower project root: got %q", got)
	}
	// A project root is authoritative even when it is broader than, or unrelated to, the global root.
	if got := c.EffectiveRoot(Project{Root: "/elsewhere"}); got != "/elsewhere" {
		t.Errorf("unrelated project root must win: got %q", got)
	}
	if got := (Config{}).EffectiveRoot(Project{}); got != "" {
		t.Errorf("nothing configured: got %q, want empty", got)
	}
}

func TestPerProjectRootValidation(t *testing.T) {
	base := t.TempDir()
	global := filepath.Join(base, "global")
	other := filepath.Join(base, "other")
	os.MkdirAll(filepath.Join(global, "in"), 0700)
	os.MkdirAll(filepath.Join(other, "in"), 0700)
	mk := func(p Project) Config {
		return Config{
			Home: base, EnvFile: filepath.Join(base, ".env"), Root: global,
			Agent:    Agent{Enabled: true, Labels: Labels{Ready: "r", Running: "u", Done: "d", Failed: "f"}},
			Projects: map[string]Project{"HAB": p},
		}
	}
	// Outside the global root with no project root: refused.
	if e := mk(Project{Dir: filepath.Join(other, "in"), BaseBranch: "main", Mode: "direct-PR"}).Validate(); e == nil {
		t.Fatal("project outside the global root was accepted")
	}
	// Same directory, but the project declares the root it lives in: allowed, even though it is outside the global.
	if e := mk(Project{Dir: filepath.Join(other, "in"), Root: other, BaseBranch: "main", Mode: "direct-PR"}).Validate(); e != nil {
		t.Fatalf("project root should be authoritative: %v", e)
	}
	// A project root that does not contain the project directory is still refused.
	if e := mk(Project{Dir: filepath.Join(other, "in"), Root: global, BaseBranch: "main", Mode: "direct-PR"}).Validate(); e == nil {
		t.Fatal("project dir outside its own declared root was accepted")
	}
}

func TestTooBroadRejectsHomeAndAbove(t *testing.T) {
	home, _ := os.UserHomeDir()
	for _, r := range []string{"/", home, filepath.Dir(home)} {
		if !TooBroad(r) {
			t.Errorf("TooBroad(%q) = false, want true", r)
		}
	}
	if TooBroad(filepath.Join(home, "projects")) {
		t.Error("a directory under home must be an acceptable root")
	}
}

func TestValidateRejectsTooBroadProjectRoot(t *testing.T) {
	base := t.TempDir()
	home, _ := os.UserHomeDir()
	c := Config{
		Home: base, EnvFile: filepath.Join(base, ".env"), Root: filepath.Join(base, "global"),
		Agent:    Agent{Enabled: true, Labels: Labels{Ready: "r", Running: "u", Done: "d", Failed: "f"}},
		Projects: map[string]Project{"HAB": {Dir: filepath.Join(home, "anything"), Root: home, BaseBranch: "main", Mode: "direct-PR"}},
	}
	if e := c.Validate(); e == nil {
		t.Fatal("a project root at the home directory was accepted")
	}
}

// A tilde in a per-project root must expand like every other path, or containment compares a literal "~/work".
func TestLoadExpandsProjectRoot(t *testing.T) {
	home, _ := os.UserHomeDir()
	dir := t.TempDir()
	cfg := filepath.Join(dir, "config.json")
	os.WriteFile(cfg, []byte(`{"enabled":true,"home":"`+dir+`","envFile":"`+filepath.Join(dir, ".env")+`",
	  "projects":{"HAB":{"dir":"~/projects/ai/x","root":"~/projects/ai","baseBranch":"main","mode":"direct-PR"}},
	  "agent":{"enabled":true,"labels":{"ready":"r","running":"u","done":"d","failed":"f"}}}`), 0600)
	c, _, e := Load(cfg)
	if e != nil {
		t.Fatalf("load: %v", e)
	}
	if got := c.Projects["HAB"].Root; got != filepath.Join(home, "projects/ai") {
		t.Fatalf("project root = %q, want it expanded", got)
	}
}
