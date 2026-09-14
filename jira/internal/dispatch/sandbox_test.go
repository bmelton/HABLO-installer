package dispatch

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/bmelton/HABLO-installer/jira/internal/config"
)

// The profile is only worth anything if the kernel enforces it, so this runs the real sandbox rather than asserting on
// the generated text.
func TestSandboxProfileEnforcesRoot(t *testing.T) {
	if !SandboxAvailable() {
		t.Skip("sandbox-exec unavailable on this platform")
	}
	home, _ := os.UserHomeDir()
	// Not t.TempDir(): that lives under /private/var/folders, which is a writable carve-out, so the sandbox would
	// legitimately permit the "outside" write and the test would prove nothing.
	base, e := os.MkdirTemp(home, ".hablo-sandbox-test-")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { os.RemoveAll(base) })
	root := filepath.Join(base, "root")
	outside := filepath.Join(base, "outside")
	for _, d := range []string{root, outside} {
		if e := os.MkdirAll(d, 0700); e != nil {
			t.Fatal(e)
		}
	}
	profile := filepath.Join(base, "p.sb")
	if e := os.WriteFile(profile, []byte(SandboxProfile(root, home, filepath.Join(base, "jirahome"), "", nil)), 0600); e != nil {
		t.Fatal(e)
	}
	run := func(script string) error {
		return exec.Command("sandbox-exec", "-f", profile, "sh", "-c", script).Run()
	}
	if e := run("echo ok > " + filepath.Join(root, "allowed")); e != nil {
		t.Fatalf("write inside the root was denied: %v", e)
	}
	if e := run("echo no > " + filepath.Join(outside, "denied")); e == nil {
		t.Fatal("write outside the root succeeded; the root is not enforced")
	}
	if _, e := os.Stat(filepath.Join(outside, "denied")); !os.IsNotExist(e) {
		t.Fatal("a file was created outside the root")
	}
	// Deletion is the case that actually motivated this: a captain running rm must not reach past the root.
	victim := filepath.Join(outside, "keepme")
	os.WriteFile(victim, []byte("x"), 0600)
	_ = run("rm -rf " + outside)
	if _, e := os.Stat(victim); e != nil {
		t.Fatal("rm -rf removed a file outside the root")
	}
}

func TestSandboxCommandFallsBackWhenUnconfigured(t *testing.T) {
	argv, e := sandboxCommand(config.Config{}, "", t.TempDir(), "/tmp/x.sh")
	if e != nil {
		t.Fatal(e)
	}
	if strings.Join(argv, " ") != "sh /tmp/x.sh" {
		t.Fatalf("argv = %v, want a bare sh invocation when no root is set", argv)
	}
}
