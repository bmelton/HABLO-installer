package dispatch

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/bmelton/HABLO-installer/jira/internal/config"
)

// A dispatched captain runs as the invoking user with a shell tool and takes its instructions from a Jira description,
// which is untrusted input. Confining it to the configured root means a hostile or confused ticket can damage the tree
// you pointed it at and nothing else on the machine.
//
// This denies writes, not reads. A captain inside the sandbox can still read credentials anywhere the user can and
// send them over the network; stopping that needs a container with no network, not a filesystem profile.
//
// macOS only. sandbox-exec is deprecated by Apple but still enforced, and it needs no third-party dependency.
// SandboxAvailable reports whether this platform can confine a captain.
func SandboxAvailable() bool {
	if runtime.GOOS != "darwin" {
		return false
	}
	_, e := exec.LookPath("sandbox-exec")
	return e == nil
}

// writableCarveouts are the paths outside the root that a captain genuinely needs. Each one is a hole in the boundary,
// so the list stays as short as the harness allows: Pi's own state, the run directory this dispatch writes, and the
// temp directories tmux and Go's toolchain use for sockets and scratch files.
func writableCarveouts(home, jiraHome, harnessDir string, configured []string) []string {
	// Always present: the temp directories tmux sockets, Go builds and Pi scratch files need.
	out := []string{"/private/tmp", "/private/var/folders", "/private/var/tmp"}
	out = append(out, configured...)
	if len(configured) > 0 {
		return out
	}
	// Fallback for a config rendered before sandboxWritable existed. Keeps an upgrade from silently breaking every
	// captain, at the cost of being a guess rather than the installer's own list.
	out = append(out, filepath.Join(home, ".pi"), filepath.Join(home, ".bedrouter"), jiraHome)
	for _, sub := range []string{"state", "data", "projects"} {
		if harnessDir != "" {
			out = append(out, filepath.Join(harnessDir, sub))
		}
	}
	return out
}

// SandboxProfile renders a Seatbelt profile confining writes to root plus the carve-outs. Reads stay unrestricted:
// git, gh, Pi and the toolchain read from all over the filesystem, and denying that breaks the captain without
// closing the exfiltration path that matters.
func SandboxProfile(root, home, jiraHome, harnessDir string, configured []string) string {
	var b strings.Builder
	b.WriteString("(version 1)\n(allow default)\n(deny file-write*)\n")
	for _, p := range append([]string{root}, writableCarveouts(home, jiraHome, harnessDir, configured)...) {
		if r, e := filepath.EvalSymlinks(p); e == nil {
			p = r
		}
		fmt.Fprintf(&b, "(allow file-write* (subpath %q))\n", p)
	}
	b.WriteString("(allow file-write* (literal \"/dev/null\") (literal \"/dev/dtracehelper\") (literal \"/dev/tty\"))\n")
	b.WriteString("(allow file-write* (regex #\"^/dev/ttys[0-9]+$\"))\n")
	return b.String()
}

// sandboxCommand writes the profile next to the run's other artifacts and returns the argv that runs script inside it.
// An empty root, or a platform without sandbox-exec, returns the bare command; Preflight decides whether that is
// allowed, so the decision to run unconfined is never made silently here.
func sandboxCommand(cfg config.Config, root, runDir, script string) ([]string, error) {
	if root == "" || !SandboxAvailable() {
		return []string{"sh", script}, nil
	}
	home, e := os.UserHomeDir()
	if e != nil {
		return nil, e
	}
	profile := filepath.Join(runDir, "sandbox.sb")
	if e := os.WriteFile(profile, []byte(SandboxProfile(root, home, cfg.Home, cfg.HarnessDir, cfg.SandboxWritable)), 0600); e != nil {
		return nil, e
	}
	return []string{"sandbox-exec", "-f", profile, "sh", script}, nil
}
