package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/bmelton/HABLO-installer/jira/internal/adf"
	"github.com/bmelton/HABLO-installer/jira/internal/config"
	"github.com/bmelton/HABLO-installer/jira/internal/dispatch"
	japi "github.com/bmelton/HABLO-installer/jira/internal/jira"
	"github.com/bmelton/HABLO-installer/jira/internal/state"
)

const version = "0.1.0"

type app struct {
	cfg      config.Config
	client   *japi.Client
	out      io.Writer
	dry      bool
	template string
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }
func run(args []string, out, errout io.Writer) int {
	cmd := "tick"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		cmd = args[0]
		args = args[1:]
	}
	if cmd == "version" {
		fmt.Fprintln(out, version)
		return 0
	}
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	fs.SetOutput(errout)
	home, _ := os.UserHomeDir()
	cp := fs.String("config", filepath.Join(home, ".hablo/jira/config.json"), "")
	dry := fs.Bool("dry-run", false, "")
	verbose := fs.Bool("verbose", false, "")
	key := fs.String("key", "", "")
	outcome := fs.String("outcome", "", "")
	pr := fs.String("pr", "", "")
	summary := fs.String("summary", "", "")
	follow := fs.Bool("follow", false, "")
	lines := fs.Int("lines", 0, "")
	if e := fs.Parse(args); e != nil {
		return 2
	}
	cfg, cred, e := config.Load(*cp)
	if e != nil {
		fmt.Fprintln(errout, e)
		return 2
	}
	if cmd == "report" {
		if *key == "" || (*outcome != "done" && *outcome != "failed") {
			fmt.Fprintln(errout, "report requires --key and --outcome done|failed")
			return 2
		}
		if !config.ValidIssueKey(*key) {
			fmt.Fprintln(errout, "invalid Jira key")
			return 2
		}
		if e = state.WriteReport(cfg.Home, state.Report{Key: *key, Outcome: *outcome, PR: *pr, Summary: *summary}); e != nil {
			fmt.Fprintln(errout, e)
			return 1
		}
		fmt.Fprintln(out, "report recorded")
		return 0
	}
	if cmd == "status" {
		a := app{cfg: cfg, out: out, dry: *dry, template: filepath.Join(cfg.Home, "brief.tmpl.md")}
		if e := a.status(); e != nil {
			fmt.Fprintln(errout, e)
			return 1
		}
		return 0
	}
	// Before the enabled and credential checks: spy only reads tmux and the run directory, and explaining a run that is
	// already underway must keep working even when the agent has been turned off.
	if cmd == "spy" {
		if e := spy(cfg.Home, *key, *lines, *follow, out); e != nil {
			fmt.Fprintln(errout, e)
			return 1
		}
		return 0
	}
	if !cfg.Enabled || !cfg.Agent.Enabled {
		fmt.Fprintln(out, "jira agent disabled")
		return 0
	}
	if !cred.Complete() {
		fmt.Fprintln(errout, "jira credentials are not configured")
		return 2
	}
	a := app{cfg: cfg, client: &japi.Client{BaseURL: cred.URL, Email: cred.Email, Token: cred.Token, Out: out, DryRun: *dry}, out: out, dry: *dry, template: filepath.Join(cfg.Home, "brief.tmpl.md")}
	_ = verbose
	switch cmd {
	case "tick":
		e = a.tick(context.Background())
	case "watch":
		for {
			if e = a.tick(context.Background()); e != nil {
				break
			}
			time.Sleep(time.Duration(cfg.Agent.IntervalSeconds) * time.Second)
		}
	case "doctor":
		e = a.doctor(context.Background())
	default:
		e = fmt.Errorf("unknown command %q", cmd)
	}
	if e != nil {
		fmt.Fprintln(errout, e)
		return 1
	}
	return 0
}
func (a app) jql() string {
	keys := make([]string, 0, len(a.cfg.Projects))
	for k := range a.cfg.Projects {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for i := range keys {
		keys[i] = `"` + strings.ReplaceAll(keys[i], `"`, `\"`) + `"`
	}
	extra := strings.TrimSpace(a.cfg.Agent.JQLExtra)
	if extra != "" {
		extra = " AND " + extra
	}
	return fmt.Sprintf("project IN (%s) AND assignee = currentUser() AND labels = %q%s ORDER BY created ASC", strings.Join(keys, ","), a.cfg.Agent.Labels.Ready, extra)
}
func (a app) tick(ctx context.Context) error {
	if !a.dry {
		lock, ok, e := state.Lock(a.cfg.Home)
		if e != nil {
			return e
		}
		if !ok {
			return nil
		}
		defer lock.Close()
	}
	s, e := state.Load(a.cfg.Home)
	if e != nil {
		return e
	}
	if e = a.reap(ctx, &s); e != nil {
		return e
	}
	active := 0
	for _, x := range s.Issues {
		if x.Status == "running" {
			active++
		}
	}
	max := a.cfg.Agent.MaxConcurrent
	if max < 1 {
		max = 1
	}
	if active >= max {
		return state.Save(a.cfg.Home, s)
	}
	xs, e := a.client.Search(ctx, a.jql(), max-active)
	if e != nil {
		return e
	}
	for _, x := range xs {
		if prior, exists := s.Issues[x.Key]; exists && (prior.Status == "running" || time.Now().Before(prior.BackoffUntil)) {
			continue
		}
		if e = a.dispatch(ctx, &s, x); e != nil {
			fmt.Fprintf(a.out, "%s: %v\n", x.Key, e)
			if s.Issues[x.Key].Status != "failed" {
				a.backoff(ctx, &s, x.Key, e)
			}
		}
	}
	if a.dry {
		return nil
	}
	return state.Save(a.cfg.Home, s)
}
func (a app) dispatch(ctx context.Context, s *state.State, x japi.Issue) error {
	p, ok := a.cfg.ProjectFor(x.Key)
	if !ok {
		return a.failIssue(ctx, s, x.Key, "unmapped project")
	}
	description := adf.Markdown(x.Fields.Description)
	if strings.TrimSpace(description) == "" {
		return a.failIssue(ctx, s, x.Key, "empty description")
	}
	if len(a.cfg.Agent.ReporterAllowlist) > 0 && !contains(a.cfg.Agent.ReporterAllowlist, x.Fields.Reporter.AccountID) {
		return a.failIssue(ctx, s, x.Key, "reporter is not allowlisted")
	}
	if e := dispatch.Preflight(p, a.dry); e != nil {
		return e
	}
	b := dispatch.FromIssue(x, p, description)
	comments := x.Fields.Comments.Comments
	if len(comments) > 20 {
		comments = comments[len(comments)-20:]
	}
	used := 0
	for _, c := range comments {
		body := adf.Markdown(c.Body)
		if used+len(body) > 50_000 {
			break
		}
		used += len(body)
		b.Comments = append(b.Comments, dispatch.BriefComment{Author: c.Author.DisplayName, Created: c.Created, Body: body})
	}
	brief, e := dispatch.Render(a.cfg.Home, a.template, b, a.dry)
	if e != nil {
		return e
	}
	if e := a.client.UpdateLabels(ctx, x.Key, []string{a.cfg.Agent.Labels.Ready}, []string{a.cfg.Agent.Labels.Running}); e != nil {
		return e
	}
	if !a.dry {
		claimed, e := a.client.Read(ctx, x.Key)
		if e != nil {
			return e
		}
		if !contains(claimed.Fields.Labels, a.cfg.Agent.Labels.Running) || contains(claimed.Fields.Labels, a.cfg.Agent.Labels.Ready) {
			return fmt.Errorf("claim verification failed")
		}
		s.Issues[x.Key] = state.Entry{Status: "running", StartedAt: time.Now().UTC()}
	}
	postClaimFail := func(cause error) error {
		if !a.dry {
			_ = a.failIssue(ctx, s, x.Key, "post-claim failure: "+cause.Error())
		}
		return cause
	}
	if a.cfg.Agent.CommentOnDispatch {
		if e := a.client.AddComment(ctx, x.Key, "HABLO claimed this ticket and is starting a captain."); e != nil {
			return postClaimFail(e)
		}
	}
	session, e := dispatch.Launch(a.cfg.Home, p, x.Key, brief, a.dry)
	if e != nil {
		return postClaimFail(e)
	}
	fmt.Fprintf(a.out, "%s: dispatched %s\n", x.Key, session)
	return nil
}
func (a app) backoff(ctx context.Context, s *state.State, key string, cause error) {
	e := s.Issues[key]
	e.Attempts++
	max := a.cfg.Agent.MaxAttempts
	if max < 1 {
		max = 3
	}
	if e.Attempts >= max {
		_ = a.failIssue(ctx, s, key, fmt.Sprintf("failed after %d attempts: %v", e.Attempts, cause))
		return
	}
	mins := 1 << (e.Attempts - 1)
	if mins > 15 {
		mins = 15
	}
	e.Status = "backoff"
	e.BackoffUntil = time.Now().Add(time.Duration(mins) * time.Minute)
	e.LastOutcome = cause.Error()
	s.Issues[key] = e
}
func (a app) failIssue(ctx context.Context, s *state.State, key, msg string) error {
	if e := a.client.UpdateLabels(ctx, key, []string{a.cfg.Agent.Labels.Ready, a.cfg.Agent.Labels.Running}, []string{a.cfg.Agent.Labels.Failed}); e != nil {
		return e
	}
	if e := a.client.AddComment(ctx, key, "HABLO could not dispatch this ticket: "+msg); e != nil {
		return e
	}
	if !a.dry {
		s.Issues[key] = state.Entry{Status: "failed", LastOutcome: msg}
	}
	return fmt.Errorf("%s", msg)
}
func (a app) reap(ctx context.Context, s *state.State) error {
	for key, e := range s.Issues {
		if e.Status != "running" {
			continue
		}
		r, reportErr := state.ReadReport(a.cfg.Home, key)
		reason := ""
		outcome := ""
		if reportErr == nil {
			outcome = r.Outcome
			reason = r.Summary
			if r.PR != "" {
				reason += "\n\n" + r.PR
			}
		} else if !dispatch.Alive(key) {
			outcome = "failed"
			reason = "the session ended without a report"
		} else if a.cfg.Agent.RunTimeoutMinutes > 0 && time.Since(e.StartedAt) > time.Duration(a.cfg.Agent.RunTimeoutMinutes)*time.Minute {
			dispatch.Kill(key)
			outcome = "failed"
			reason = "the session exceeded its run timeout"
		} else {
			continue
		}
		label := a.cfg.Agent.Labels.Failed
		if outcome == "done" {
			label = a.cfg.Agent.Labels.Done
		}
		if x := a.client.UpdateLabels(ctx, key, []string{a.cfg.Agent.Labels.Running}, []string{label}); x != nil {
			return x
		}
		if x := a.client.AddComment(ctx, key, "HABLO run "+outcome+": "+reason); x != nil {
			return x
		}
		e.Status = outcome
		e.LastOutcome = reason
		s.Issues[key] = e
	}
	return nil
}
func (a app) status() error {
	s, e := state.Load(a.cfg.Home)
	if e != nil {
		return e
	}
	keys := make([]string, 0, len(s.Issues))
	for k := range s.Issues {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		x := s.Issues[k]
		fmt.Fprintf(a.out, "%s\t%s\ttmux=%t\t%s\n", k, x.Status, dispatch.Alive(k), x.LastOutcome)
	}
	return nil
}
func (a app) doctor(ctx context.Context) error {
	u, e := a.client.Myself(ctx)
	if e != nil {
		return e
	}
	fmt.Fprintf(a.out, "jira: authorized as %s\n", u.DisplayName)
	for _, bin := range []string{"tmux", "pi", "hablo", "git", "gh"} {
		p, e := exec.LookPath(bin)
		if e != nil {
			fmt.Fprintf(a.out, "  %s MISSING\n", bin)
		} else {
			fmt.Fprintf(a.out, "  %s %s\n", bin, p)
		}
	}
	for k, p := range a.cfg.Projects {
		if e := dispatch.Preflight(p, true); e != nil {
			fmt.Fprintf(a.out, "  %s WARNING: %v\n", k, e)
		} else {
			fmt.Fprintf(a.out, "  %s ok\n", k)
		}
	}
	return nil
}
func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

// spy shows what a dispatched captain is doing. With no key it lists runs; with a key it prints the live pane, or
// follows the console log. It needs neither Jira credentials nor the agent to be enabled, because its whole job is to
// explain a run that is already underway.
func spy(home, key string, lines int, follow bool, out io.Writer) error {
	if key == "" {
		return spyList(home, out)
	}
	if !config.ValidIssueKey(key) {
		return fmt.Errorf("invalid Jira key %q", key)
	}
	if follow {
		return spyFollow(dispatch.ConsoleLog(home, key), key, out)
	}
	if text, e := dispatch.Capture(key, lines); e == nil {
		fmt.Fprintln(out, text)
		return nil
	}
	// The session is gone, but pipe-pane wrote everything to disk, so a finished run is still readable.
	b, e := os.ReadFile(dispatch.ConsoleLog(home, key))
	if e != nil {
		return fmt.Errorf("no live session for %s and no console log: %w", key, e)
	}
	all := dispatch.Readable(string(b))
	if lines > 0 && len(all) > lines {
		all = all[len(all)-lines:]
	}
	fmt.Fprintf(out, "%s is not running; last %d lines of its recording:\n\n", key, len(all))
	fmt.Fprintln(out, strings.Join(all, "\n"))
	return nil
}

func spyList(home string, out io.Writer) error {
	entries, e := os.ReadDir(filepath.Join(home, "runs"))
	if e != nil {
		return e
	}
	found := 0
	for _, d := range entries {
		if !d.IsDir() {
			continue
		}
		k := d.Name()
		status, idle := "exited", "-"
		if dispatch.Alive(k) {
			status = "running"
		}
		if fi, e := os.Stat(dispatch.ConsoleLog(home, k)); e == nil {
			idle = time.Since(fi.ModTime()).Round(time.Second).String()
		}
		fmt.Fprintf(out, "%-12s %-8s quiet for %s\n", k, status, idle)
		found++
	}
	if found == 0 {
		fmt.Fprintln(out, "no runs recorded")
	}
	return nil
}

func spyFollow(path, key string, out io.Writer) error {
	f, e := os.Open(path)
	if e != nil {
		return fmt.Errorf("no recording for %s: %w", key, e)
	}
	defer f.Close()
	var last string
	emit := func(chunk string) {
		for _, line := range dispatch.Readable(chunk) {
			if line == last {
				continue
			}
			last = line
			fmt.Fprintln(out, line)
		}
	}
	b, _ := io.ReadAll(f)
	emit(string(b))
	// Poll rather than watch: a run is minutes long, the file only ever grows, and this keeps the command free of a
	// filesystem-notification dependency.
	for {
		time.Sleep(500 * time.Millisecond)
		b, e := io.ReadAll(f)
		if e != nil {
			return e
		}
		if len(b) > 0 {
			emit(string(b))
			continue
		}
		if !dispatch.Alive(key) {
			fmt.Fprintf(out, "\n-- %s is no longer running --\n", key)
			return nil
		}
	}
}
