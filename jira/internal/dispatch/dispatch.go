package dispatch

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"text/template"

	"github.com/bmelton/HABLO-installer/jira/internal/config"
	"github.com/bmelton/HABLO-installer/jira/internal/jira"
	"github.com/bmelton/HABLO-installer/jira/internal/state"
)

type Brief struct {
	Key, Summary, IssueType, Priority, Reporter, Dir, BaseBranch, Mode, Description string
	Comments                                                                        []BriefComment
}
type BriefComment struct{ Author, Created, Body string }

func Preflight(p config.Project, dry bool) error {
	st, e := os.Stat(p.Dir)
	if e != nil || !st.IsDir() {
		return fmt.Errorf("repository does not exist: %s", p.Dir)
	}
	cmd := exec.Command("git", "-C", p.Dir, "rev-parse", "--show-toplevel")
	b, e := cmd.Output()
	want, _ := filepath.EvalSymlinks(filepath.Clean(p.Dir))
	got, _ := filepath.EvalSymlinks(filepath.Clean(strings.TrimSpace(string(b))))
	if e != nil || got != want {
		return fmt.Errorf("mapped directory is not its git root")
	}
	for _, x := range []string{"tmux", "pi", "hablo", "git", "gh"} {
		if _, e := exec.LookPath(x); e != nil {
			// Naming the PATH matters: under launchd or systemd this fails on a machine where the interactive shell
			// finds the tool, and the scheduler's minimal PATH is the only clue to why.
			return fmt.Errorf("%s is not on PATH (PATH=%s)", x, os.Getenv("PATH"))
		}
	}
	if e := exec.Command("gh", "auth", "status").Run(); e != nil {
		return fmt.Errorf("gh is not authenticated")
	}
	if dry {
		return nil
	}
	if e := exec.Command("git", "-C", p.Dir, "fetch", "origin", p.BaseBranch).Run(); e != nil {
		return fmt.Errorf("cannot fetch origin/%s", p.BaseBranch)
	}
	return nil
}
func Render(home, templatePath string, b Brief, dry bool) (string, error) {
	raw, e := os.ReadFile(templatePath)
	if e != nil {
		return "", e
	}
	t, e := template.New("brief").Parse(string(raw))
	if e != nil {
		return "", e
	}
	var out bytes.Buffer
	if e = t.Execute(&out, b); e != nil {
		return "", e
	}
	d := state.RunDir(home, b.Key)
	if dry {
		return filepath.Join(d, "brief.md"), nil
	}
	if e = os.MkdirAll(d, 0700); e != nil {
		return "", e
	}
	p := filepath.Join(d, "brief.md")
	return p, os.WriteFile(p, out.Bytes(), 0600)
}
func Launch(home string, p config.Project, key, brief string, dry bool) (string, error) {
	d := state.RunDir(home, key)
	script := filepath.Join(d, "launch.sh")
	log := filepath.Join(d, "console.log")
	session := "hablo-" + key
	text := fmt.Sprintf("#!/bin/sh\n# managed by HABLO\nexport HABLO_JIRA_KEY=%q\nexport HABLO_JIRA_RUN=%q\nexport HABLO_PROJECT_MODE=%q\ncd %q || exit 1\nexec hablo -- @%q\n", key, d, p.Mode, p.Dir, brief)
	if dry {
		return fmt.Sprintf("tmux new-session -d -s %q -c %q sh %q", session, p.Dir, script), nil
	}
	if e := os.WriteFile(script, []byte(text), 0700); e != nil {
		return "", e
	}
	if e := exec.Command("tmux", "new-session", "-d", "-s", session, "-c", p.Dir, "sh", script).Run(); e != nil {
		return "", e
	}
	_ = exec.Command("tmux", "pipe-pane", "-o", "-t", session, fmt.Sprintf("cat >> %q", log)).Run()
	return session, nil
}
func Alive(key string) bool {
	return exec.Command("tmux", "has-session", "-t", "hablo-"+key).Run() == nil
}
func Kill(key string) { _ = exec.Command("tmux", "kill-session", "-t", "hablo-"+key).Run() }
func FromIssue(x jira.Issue, p config.Project, description string) Brief {
	return Brief{Key: x.Key, Summary: x.Fields.Summary, IssueType: x.Fields.IssueType.Name, Priority: x.Fields.Priority.Name, Reporter: x.Fields.Reporter.DisplayName, Dir: p.Dir, BaseBranch: p.BaseBranch, Mode: p.Mode, Description: description}
}

// tmux records what a terminal emulator would have consumed, so a captured pane or a piped log is mostly escape
// sequences. This matches OSC strings (hyperlinks and titles, terminated by BEL or ST), CSI sequences (colour, cursor
// motion, the synchronised-update pairs Pi emits), two-byte escapes, and stray control bytes.
var terminalNoise = regexp.MustCompile(`\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-Z\\-_]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]`)

// StripTerminal reduces recorded terminal output to the text a human would have read on screen.
func StripTerminal(s string) string { return terminalNoise.ReplaceAllString(s, "") }

// Readable strips escape sequences, treats a carriage return as a line break so in-place redraws become separate
// lines, then drops blanks and collapses consecutive duplicates. A spinner that redrew a thousand times becomes one
// line instead of a thousand.
func Readable(s string) []string {
	s = StripTerminal(strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n"))
	var out []string
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimRight(line, " \t")
		if strings.TrimSpace(line) == "" {
			continue
		}
		if len(out) > 0 && out[len(out)-1] == line {
			continue
		}
		out = append(out, line)
	}
	return out
}

// Capture returns the live pane contents for a key. scrollback asks tmux for that many lines of history above the
// visible screen; zero captures only what is on screen now.
func Capture(key string, scrollback int) (string, error) {
	if !Alive(key) {
		return "", fmt.Errorf("no live tmux session for %s", key)
	}
	args := []string{"capture-pane", "-p", "-t", "hablo-" + key}
	if scrollback > 0 {
		args = append(args, "-S", "-"+strconv.Itoa(scrollback))
	}
	b, e := exec.Command("tmux", args...).Output()
	if e != nil {
		return "", fmt.Errorf("capture-pane: %w", e)
	}
	return b2s(b), nil
}
func b2s(b []byte) string { return strings.Join(Readable(string(b)), "\n") }

// ConsoleLog is the full recording tmux pipe-pane writes for a run, which outlives the session.
func ConsoleLog(home, key string) string {
	return filepath.Join(state.RunDir(home, key), "console.log")
}
