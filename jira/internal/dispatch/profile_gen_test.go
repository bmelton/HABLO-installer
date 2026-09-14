package dispatch

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/bmelton/HABLO-installer/jira/internal/config"
)

// Regression for the failure that killed HAB-1: firstmate's own Pi extensions write under the harness directory,
// which sits outside the project root, so the sandbox denied them and the captain exited before doing any work.
func TestLiveProfileAllowsHarnessWrites(t *testing.T) {
	if !SandboxAvailable() {
		t.Skip("sandbox-exec unavailable")
	}
	home, _ := os.UserHomeDir()
	cfgPath := filepath.Join(home, ".hablo/jira/config.json")
	if _, e := os.Stat(cfgPath); e != nil {
		t.Skip("no installed config to check against")
	}
	c, _, e := config.Load(cfgPath)
	if e != nil {
		t.Skipf("installed config not loadable: %v", e)
	}
	if c.HarnessDir == "" {
		t.Skip("no harness configured")
	}
	p := c.Projects["HAB"]
	profile := filepath.Join(t.TempDir(), "p.sb")
	if e := os.WriteFile(profile, []byte(SandboxProfile(c.EffectiveRoot(p), home, c.Home, c.HarnessDir, c.SandboxWritable)), 0600); e != nil {
		t.Fatal(e)
	}
	for _, probe := range []string{"state", "data", "projects"} {
		target := filepath.Join(c.HarnessDir, probe, ".hablo-sandbox-probe")
		if e := exec.Command("sandbox-exec", "-f", profile, "sh", "-c", "touch "+target).Run(); e != nil {
			t.Errorf("harness %s/ is not writable under the profile: %v", probe, e)
		}
		os.Remove(target)
	}
	// The three paths that killed a captain in turn: firstmate extension markers, and bedrouter's server log when
	// pi-bedrouter has to start its own server.
	for _, probe := range []string{
		filepath.Join(home, ".bedrouter", ".hablo-sandbox-probe"),
		filepath.Join(home, ".pi", ".hablo-sandbox-probe"),
		filepath.Join(c.Home, ".hablo-sandbox-probe"),
	} {
		if e := exec.Command("sandbox-exec", "-f", profile, "sh", "-c", "touch "+probe).Run(); e != nil {
			t.Errorf("%s is not writable under the profile: %v", probe, e)
		}
		os.Remove(probe)
	}
	// bin/ stays read-only: a captain must not rewrite the scripts that run on the next voyage.
	bin := filepath.Join(c.HarnessDir, "bin", ".hablo-sandbox-probe")
	if e := exec.Command("sandbox-exec", "-f", profile, "sh", "-c", "touch "+bin).Run(); e == nil {
		os.Remove(bin)
		t.Error("harness bin/ is writable; captain could rewrite its own scripts")
	}
}
