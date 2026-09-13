package dispatch

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
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
			return fmt.Errorf("%s is not on PATH", x)
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
