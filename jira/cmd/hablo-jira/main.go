package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/bmelton/HABLO-installer/jira/internal/adf"
	"github.com/bmelton/HABLO-installer/jira/internal/config"
	japi "github.com/bmelton/HABLO-installer/jira/internal/jira"
)

const version = "0.1.0"

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }
func run(args []string, out, errout io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(errout, "usage: hablo-jira <comment|transition|read|search|doctor|version>")
		return 4
	}
	if args[0] == "version" {
		fmt.Fprintln(out, version)
		return 0
	}
	fs := flag.NewFlagSet(args[0], flag.ContinueOnError)
	fs.SetOutput(errout)
	home, _ := os.UserHomeDir()
	cfgPath := fs.String("config", filepath.Join(home, ".hablo/jira/config.json"), "")
	key := fs.String("key", "", "")
	stage := fs.String("stage", "", "")
	body := fs.String("body", "", "")
	to := fs.String("to", "", "")
	jql := fs.String("jql", "", "")
	limit := fs.Int("limit", 50, "")
	dry := fs.Bool("dry-run", false, "")
	quiet := fs.Bool("quiet", false, "")
	if e := fs.Parse(args[1:]); e != nil {
		return 4
	}
	c, cred, e := config.Load(*cfgPath)
	if e != nil || !c.Enabled || !cred.Complete() {
		if !*quiet {
			fmt.Fprintln(errout, "jira not configured")
		}
		return 3
	}
	if p, ok := c.ProjectFor(*key); *key != "" && !ok {
		_ = p
		if !*quiet {
			fmt.Fprintln(errout, "jira project is not mapped")
		}
		return 3
	}
	client := &japi.Client{BaseURL: cred.URL, Email: cred.Email, Token: cred.Token, DryRun: *dry, Out: out}
	ctx := context.Background()
	fail := func(e error) int { fmt.Fprintln(errout, e); return 4 }
	switch args[0] {
	case "comment":
		if !c.Reporting.Enabled {
			return 3
		}
		if *key == "" || *stage == "" || *body == "" {
			return fail(fmt.Errorf("comment requires --key, --stage, and --body"))
		}
		if len(c.Reporting.Stages) > 0 && !contains(c.Reporting.Stages, *stage) {
			return fail(fmt.Errorf("stage %q is not configured", *stage))
		}
		raw, e := readBody(*body)
		if e != nil {
			return fail(e)
		}
		runID := os.Getenv("FM_TASK_ID")
		if runID == "" {
			runID = os.Getenv("HABLO_JIRA_RUN")
		}
		if runID == "" {
			runID = time.Now().UTC().Format("20060102T150405Z")
		}
		runID = filepath.Base(runID)
		branch := gitBranch()
		marker := fmt.Sprintf("hablo: stage=%s run=%s", *stage, runID)
		recent, e := client.RecentComments(ctx, *key, 50)
		if e != nil {
			return fail(e)
		}
		for _, x := range recent {
			if strings.Contains(adf.Markdown(x.Body), marker) {
				if !*quiet {
					fmt.Fprintln(out, "comment already present")
				}
				return 0
			}
		}
		text := fmt.Sprintf("## HABLO: %s\n\n%s\n\nAgent: %s  \nBranch: %s\n\n%s", *stage, strings.TrimSpace(raw), fallback(os.Getenv("FM_TASK_ID"), "captain"), fallback(branch, "unknown"), marker)
		if e = client.AddComment(ctx, *key, text); e != nil {
			return fail(e)
		}
	case "transition":
		if !c.Reporting.Transitions {
			return 3
		}
		p, _ := c.ProjectFor(*key)
		name := p.Statuses[camel(*to)]
		if name == "" {
			return fail(fmt.Errorf("no mapped transition %q", *to))
		}
		ts, e := client.Transitions(ctx, *key)
		if e != nil {
			return fail(e)
		}
		found := ""
		for _, t := range ts {
			if strings.EqualFold(t.To.Name, name) || strings.EqualFold(t.Name, name) {
				if strings.EqualFold(t.To.StatusCategory.Key, "done") {
					return fail(fmt.Errorf("refusing transition into Done category"))
				}
				found = t.ID
				break
			}
		}
		if found == "" {
			return fail(fmt.Errorf("transition %q is not available", name))
		}
		if e = client.Transition(ctx, *key, found); e != nil {
			return fail(e)
		}
	case "read":
		x, e := client.Read(ctx, *key)
		if e != nil {
			return fail(e)
		}
		fmt.Fprintf(out, "# %s: %s\n\nType: %s  \nPriority: %s  \nStatus: %s\n\n%s\n", x.Key, x.Fields.Summary, x.Fields.IssueType.Name, x.Fields.Priority.Name, x.Fields.Status.Name, adf.Markdown(x.Fields.Description))
	case "search":
		xs, e := client.Search(ctx, *jql, *limit)
		if e != nil {
			return fail(e)
		}
		for _, x := range xs {
			fmt.Fprintf(out, "%s\t%s\t%s\n", x.Key, x.Fields.Status.Name, x.Fields.Summary)
		}
	case "doctor":
		u, e := client.Myself(ctx)
		if e != nil {
			return fail(e)
		}
		fmt.Fprintf(out, "jira: authorized as %s\n", fallback(u.EmailAddress, u.DisplayName))
		for k, p := range c.Projects {
			fmt.Fprintf(out, "  %s -> %s (%s)\n", k, p.Dir, p.BaseBranch)
		}
		if *key != "" {
			ts, e := client.Transitions(ctx, *key)
			if e != nil {
				return fail(e)
			}
			for _, t := range ts {
				fmt.Fprintf(out, "  transition %s -> %s [%s]\n", t.ID, t.To.Name, t.To.StatusCategory.Key)
			}
		}
	default:
		return fail(fmt.Errorf("unknown command %q", args[0]))
	}
	if !*quiet {
		fmt.Fprintln(out, "ok")
	}
	return 0
}
func readBody(v string) (string, error) {
	if v == "-" {
		b, e := io.ReadAll(os.Stdin)
		return string(b), e
	}
	if strings.HasPrefix(v, "@") {
		b, e := os.ReadFile(strings.TrimPrefix(v, "@"))
		return string(b), e
	}
	return "", fmt.Errorf("--body must be @path or -")
}
func gitBranch() string {
	b, e := exec.Command("git", "branch", "--show-current").Output()
	if e != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}
func fallback(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
func camel(s string) string {
	s = strings.ReplaceAll(s, "-", "")
	if strings.EqualFold(s, "inprogress") {
		return "inProgress"
	}
	if strings.EqualFold(s, "inreview") {
		return "inReview"
	}
	return s
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}
