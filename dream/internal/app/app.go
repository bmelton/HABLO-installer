package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/bmelton/HABLO-installer/dream/internal/ccsession"
	"github.com/bmelton/HABLO-installer/dream/internal/cluster"
	"github.com/bmelton/HABLO-installer/dream/internal/config"
	ghsignal "github.com/bmelton/HABLO-installer/dream/internal/github"
	"github.com/bmelton/HABLO-installer/dream/internal/model"
	"github.com/bmelton/HABLO-installer/dream/internal/pisession"
	"github.com/bmelton/HABLO-installer/dream/internal/redact"
	"github.com/bmelton/HABLO-installer/dream/internal/signal"
	"github.com/bmelton/HABLO-installer/dream/internal/state"
)

type App struct {
	Config config.Config
	Now    func() time.Time
	Pi     func(context.Context, string, string) (string, error)
}

func New(c config.Config) *App { return &App{Config: c, Now: time.Now, Pi: runPi} }
func date(t time.Time) string  { return t.Format("2006-01-02") }
func (a *App) path(kind string, t time.Time) string {
	return filepath.Join(a.Config.Home, kind+"-"+date(t)+map[string]string{"digest": ".json", "proposals": ".json", "report": ".md", "raw-reply": ".txt"}[kind])
}
func writeJSON(path string, v any) error {
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	b, e := json.MarshalIndent(v, "", "  ")
	if e != nil {
		return e
	}
	return os.WriteFile(path, append(b, '\n'), 0600)
}

func readRules(projects []string) (map[string][]string, []string) {
	rules := map[string][]string{}
	names := map[string]bool{"CLAUDE.md": true, "AGENTS.md": true, "Taskfile.yml": true, "hablo.json": true}
	for _, root := range projects {
		filepath.WalkDir(root, func(p string, d os.DirEntry, e error) error {
			if e != nil || d.IsDir() {
				return nil
			}
			rel, _ := filepath.Rel(root, p)
			top := strings.Split(rel, string(filepath.Separator))[0]
			if !names[d.Name()] && top != "TODO" && top != "features" && top != "bugs" && !strings.HasPrefix(rel, "firstmate/captain-") {
				return nil
			}
			if !strings.HasSuffix(p, ".md") && !strings.HasSuffix(p, ".yml") && !strings.HasSuffix(p, ".json") {
				return nil
			}
			b, e := os.ReadFile(p)
			if e != nil {
				return nil
			}
			lines := strings.Split(string(b), "\n")
			rules[p] = lines
			return nil
		})
	}
	paths := make([]string, 0, len(rules))
	for p := range rules {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	candidates := map[string][]string{}
	maxLines := 0
	for _, p := range paths {
		for _, raw := range rules[p] {
			line := strings.TrimSpace(raw)
			low := strings.ToLower(line)
			if line != "" && (strings.HasPrefix(line, "#") || strings.Contains(low, "must") || strings.Contains(low, "never") || strings.Contains(low, "do not") || strings.Contains(low, "don't") || strings.Contains(low, "refuse") || strings.Contains(low, "deny") || strings.Contains(low, "required") || strings.Contains(low, " only") || strings.Contains(low, "should")) {
				candidates[p] = append(candidates[p], line)
			}
		}
		if len(candidates[p]) > maxLines {
			maxLines = len(candidates[p])
		}
	}
	var known []string
	for i := 0; i < maxLines; i++ {
		for _, p := range paths {
			if i < len(candidates[p]) {
				known = append(known, p+": "+candidates[p][i])
			}
		}
	}
	return rules, known
}
func turns(pi []pisession.Turn, cc []ccsession.Turn) []signal.Turn {
	out := make([]signal.Turn, 0, len(pi)+len(cc))
	for _, t := range pi {
		out = append(out, signal.Turn{ID: t.ID, Role: t.Role, Text: t.Text, Source: t.Source, Project: t.Project, Timestamp: t.Timestamp})
	}
	for _, t := range cc {
		out = append(out, signal.Turn{ID: t.ID, Role: t.Role, Text: t.Text, Source: t.Source, Project: t.Project, Timestamp: t.Timestamp})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Source != out[j].Source {
			return out[i].Source < out[j].Source
		}
		return out[i].Timestamp.Before(out[j].Timestamp)
	})
	return out
}

func (a *App) Digest() (model.Digest, string, error) {
	now := a.Now().UTC()
	since, e := a.Config.SinceTime(now)
	if e != nil {
		return model.Digest{}, "", e
	}
	var ev []model.Evidence
	var pi []pisession.Turn
	var cc []ccsession.Turn
	var memory []string
	if a.Config.Sources.GuardLog {
		x, e := signal.GuardLog(a.Config.GuardLog, since)
		if e != nil {
			return model.Digest{}, "", e
		}
		ev = append(ev, x...)
	}
	if a.Config.Sources.PiSessions {
		pi, e = pisession.Walk(a.Config.PiSessions, since, a.Config.Projects)
		if e != nil {
			return model.Digest{}, "", e
		}
	}
	if a.Config.Sources.ClaudeCode {
		cc, memory, e = ccsession.Walk(a.Config.ClaudeProjects, since, a.Config.Projects)
		if e != nil {
			return model.Digest{}, "", e
		}
	}
	t := turns(pi, cc)
	ev = append(ev, signal.Corrections(t, a.Config.CorrectionOpeners)...)
	ev = append(ev, signal.FailureLoops(t)...)
	rules, known := readRules(a.Config.Projects)
	if a.Config.Sources.Rules {
		ev = append(ev, signal.RuleCollisions(t, rules)...)
	} else {
		known = nil
	}
	known = append(memory, known...)
	if a.Config.Sources.GitHub {
		for _, repo := range a.Config.Projects {
			x, e := ghsignal.ReviewComments(repo, since)
			if e != nil {
				return model.Digest{}, "", fmt.Errorf("github %s: %w", repo, e)
			}
			ev = append(ev, x...)
		}
	}
	r, e := redact.Load(filepath.Join(filepath.Dir(a.Config.Home), "guard.json"))
	if e != nil {
		return model.Digest{}, "", e
	}
	for i := range ev {
		ev[i].Quote = r.Text(ev[i].Quote)
		if len(ev[i].Quote) > a.Config.Limits.MaxQuoteChars {
			ev[i].Quote = ev[i].Quote[:a.Config.Limits.MaxQuoteChars] + "…"
		}
	}
	for i := range known {
		known[i] = r.Text(known[i])
		if len(known[i]) > a.Config.Limits.MaxQuoteChars {
			known[i] = known[i][:a.Config.Limits.MaxQuoteChars] + "…"
		}
	}
	maxRules := a.Config.Limits.MaxClusters * a.Config.Limits.MaxEvidencePerCluster
	if len(known) > maxRules {
		known = known[:maxRules]
	}
	s, e := state.Load(filepath.Join(a.Config.Home, "state.json"))
	if e != nil {
		return model.Digest{}, "", e
	}
	filtered := ev[:0]
	for _, item := range ev {
		if _, dismissed := s.Dismissals[item.Key]; !dismissed {
			filtered = append(filtered, item)
		}
	}
	signal.Sort(filtered)
	clusters, overflow := cluster.Group(filtered, a.Config.Limits.MaxClusters, a.Config.Limits.MaxEvidencePerCluster)
	d := model.Digest{Version: 1, Generated: now, Since: since, Clusters: clusters, KnownRules: known, Overflow: overflow}
	p := a.path("digest", now)
	if e = writeJSON(p, d); e != nil {
		return d, "", e
	}
	return d, p, nil
}

func brief(d model.Digest) string {
	b, _ := json.MarshalIndent(d, "", "  ")
	return `You are HABLO Dream. Review this deterministic, redacted evidence digest and propose durable rules that prevent repeated mistakes. Prefer machine-enforced guard, Taskfile, or CI changes over prose. Do not use tools or write files. Return JSON only, matching {"version":1,"proposals":[{"id":1,"title":"...","problem":"...","target":{"repo":"absolute path","file":"tracked relative path","kind":"instruction"},"change":{"kind":"append-section|replace-section|json-merge|add-task|manual","heading":"...","body":"...","values":{}},"evidence":["evidence id"],"confidence":"low|medium|high","alreadyCovered":null}]}. Every proposal must cite at least one evidence ID from the digest. If nothing warrants a proposal, return an empty proposals array.\n\nDIGEST:\n` + string(b)
}
func runPi(ctx context.Context, modelName, prompt string) (string, error) {
	args := []string{"-p", "--no-session", "--no-tools", "--no-context-files", "--model", modelName, prompt}
	cmd := exec.CommandContext(ctx, "pi", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if e := cmd.Run(); e != nil {
		return stdout.String(), fmt.Errorf("pi failed: %w: %s", e, strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}
func parseProposals(raw string, d model.Digest) (model.Proposals, error) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "```") {
		lines := strings.Split(raw, "\n")
		if len(lines) > 2 {
			raw = strings.Join(lines[1:len(lines)-1], "\n")
		}
	}
	var p model.Proposals
	if e := json.Unmarshal([]byte(raw), &p); e != nil {
		return p, e
	}
	if p.Version != 1 {
		return p, errors.New("proposal version must be 1")
	}
	validEvidence := map[string]bool{}
	for _, c := range d.Clusters {
		for _, e := range c.Evidence {
			validEvidence[e.ID] = true
		}
	}
	seen := map[int]bool{}
	kinds := map[string]bool{"append-section": true, "replace-section": true, "json-merge": true, "add-task": true, "manual": true}
	confidence := map[string]bool{"low": true, "medium": true, "high": true}
	for i := range p.Items {
		x := &p.Items[i]
		if x.ID <= 0 || seen[x.ID] {
			return p, fmt.Errorf("proposal id %d is invalid or duplicated", x.ID)
		}
		seen[x.ID] = true
		if x.Title == "" || x.Target.Repo == "" || x.Target.File == "" || x.Target.Kind == "" || !kinds[x.Change.Kind] || !confidence[x.Confidence] {
			return p, fmt.Errorf("proposal %d has an invalid title, target, or change kind", x.ID)
		}
		if len(x.Evidence) == 0 {
			return p, fmt.Errorf("proposal %d has no citation", x.ID)
		}
		for _, id := range x.Evidence {
			if !validEvidence[id] {
				return p, fmt.Errorf("proposal %d cites unknown evidence %q", x.ID, id)
			}
		}
		x.Fingerprint = fingerprint(*x)
	}
	return p, nil
}
func fingerprint(p model.Proposal) string {
	p.ID = 0
	p.Fingerprint = ""
	b, _ := json.Marshal(p)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func render(p model.Proposals, d model.Digest) string {
	var b strings.Builder
	b.WriteString("# HABLO Dream report — " + date(p.Generated) + "\n\n")
	if d.Overflow > 0 {
		fmt.Fprintf(&b, "> %d clusters exceeded the configured cap and were not sent to the model.\n\n", d.Overflow)
	}
	if len(p.Items) == 0 {
		b.WriteString("No proposals.\n")
		return b.String()
	}
	for _, x := range p.Items {
		fmt.Fprintf(&b, "## %d. %s\n\n%s\n\n- Confidence: %s\n- Target: `%s/%s` (%s)\n- Change: `%s`\n- Evidence: `%s`\n", x.ID, x.Title, x.Problem, x.Confidence, x.Target.Repo, x.Target.File, x.Target.Kind, x.Change.Kind, strings.Join(x.Evidence, "`, `"))
		if x.AlreadyCovered != nil {
			fmt.Fprintf(&b, "- Already covered: %s\n", *x.AlreadyCovered)
		}
		b.WriteByte('\n')
	}
	return b.String()
}

func (a *App) Run() (string, error) {
	d, _, e := a.Digest()
	if e != nil {
		return "", e
	}
	now := d.Generated
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(a.Config.Limits.SessionTimeoutMinutes)*time.Minute)
	defer cancel()
	raw, e := a.Pi(ctx, a.Config.Model, brief(d))
	if e != nil {
		os.MkdirAll(a.Config.Home, 0700)
		os.WriteFile(a.path("raw-reply", now), []byte(raw), 0600)
		return "", e
	}
	p, e := parseProposals(raw, d)
	if e != nil {
		os.MkdirAll(a.Config.Home, 0700)
		os.WriteFile(a.path("raw-reply", now), []byte(raw), 0600)
		return "", fmt.Errorf("invalid model reply (kept at %s): %w", a.path("raw-reply", now), e)
	}
	p.Generated = now
	s, e := state.Load(filepath.Join(a.Config.Home, "state.json"))
	if e != nil {
		return "", e
	}
	kept := p.Items[:0]
	for _, x := range p.Items {
		if _, dismissed := s.Dismissals[x.Fingerprint]; dismissed {
			continue
		}
		if _, seen := s.Proposed[x.Fingerprint]; seen {
			continue
		}
		s.Proposed[x.Fingerprint] = now
		kept = append(kept, x)
	}
	p.Items = kept
	s.LastRun = now
	if e = writeJSON(a.path("proposals", now), p); e != nil {
		return "", e
	}
	report := render(p, d)
	rp := a.path("report", now)
	if e = os.WriteFile(rp, []byte(report), 0600); e != nil {
		return "", e
	}
	if e = os.WriteFile(filepath.Join(a.Config.Home, "report.md"), []byte(report), 0600); e != nil {
		return "", e
	}
	if e = state.Save(filepath.Join(a.Config.Home, "state.json"), s); e != nil {
		return "", e
	}
	return rp, nil
}

func latest(home, prefix, suffix string) (string, error) {
	matches, e := filepath.Glob(filepath.Join(home, prefix+"-*"+suffix))
	if e != nil || len(matches) == 0 {
		return "", fmt.Errorf("no %s found", prefix)
	}
	sort.Strings(matches)
	return matches[len(matches)-1], nil
}
func (a *App) Proposals() (model.Proposals, error) {
	p, e := latest(a.Config.Home, "proposals", ".json")
	if e != nil {
		return model.Proposals{}, e
	}
	b, e := os.ReadFile(p)
	if e != nil {
		return model.Proposals{}, e
	}
	var x model.Proposals
	e = json.Unmarshal(b, &x)
	return x, e
}
func (a *App) Report() (string, error) {
	p := filepath.Join(a.Config.Home, "report.md")
	b, e := os.ReadFile(p)
	return string(b), e
}
func (a *App) Show(id int) (string, error) {
	p, e := a.Proposals()
	if e != nil {
		return "", e
	}
	for _, x := range p.Items {
		if x.ID != id {
			continue
		}
		b, _ := json.MarshalIndent(x, "", "  ")
		var out strings.Builder
		out.Write(b)
		out.WriteString("\n\nDiff preview:\n")
		target, err := validateTrackedAfterSwitch(x)
		if err != nil {
			fmt.Fprintf(&out, "unavailable: %v\n", err)
		} else if old, err := os.ReadFile(target); err != nil {
			fmt.Fprintf(&out, "unavailable: %v\n", err)
		} else if next, err := edit(x, old); err != nil {
			fmt.Fprintf(&out, "unavailable: %v\n", err)
		} else {
			fmt.Fprintf(&out, "--- a/%s\n+++ b/%s\n", x.Target.File, x.Target.File)
			for _, line := range strings.Split(string(old), "\n") {
				fmt.Fprintf(&out, "-%s\n", line)
			}
			for _, line := range strings.Split(string(next), "\n") {
				fmt.Fprintf(&out, "+%s\n", line)
			}
		}
		if dp, err := latest(a.Config.Home, "digest", ".json"); err == nil {
			var d model.Digest
			if raw, err := os.ReadFile(dp); err == nil && json.Unmarshal(raw, &d) == nil {
				wanted := map[string]bool{}
				for _, eid := range x.Evidence {
					wanted[eid] = true
				}
				out.WriteString("\nCited evidence:\n")
				for _, c := range d.Clusters {
					for _, ev := range c.Evidence {
						if wanted[ev.ID] {
							raw, _ := json.MarshalIndent(ev, "", "  ")
							out.Write(raw)
							out.WriteByte('\n')
						}
					}
				}
			}
		}
		return out.String(), nil
	}
	return "", fmt.Errorf("proposal %d not found", id)
}
func (a *App) Dismiss(id int, reason string) error {
	if strings.TrimSpace(reason) == "" {
		return errors.New("dismiss requires --reason")
	}
	p, e := a.Proposals()
	if e != nil {
		return e
	}
	for _, x := range p.Items {
		if x.ID == id {
			s, e := state.Load(filepath.Join(a.Config.Home, "state.json"))
			if e != nil {
				return e
			}
			dismissal := state.Dismissal{Reason: reason, At: a.Now().UTC()}
			s.Dismissals[x.Fingerprint] = dismissal
			if dp, err := latest(a.Config.Home, "digest", ".json"); err == nil {
				var d model.Digest
				if raw, err := os.ReadFile(dp); err == nil && json.Unmarshal(raw, &d) == nil {
					wanted := map[string]bool{}
					for _, eid := range x.Evidence {
						wanted[eid] = true
					}
					for _, c := range d.Clusters {
						for _, ev := range c.Evidence {
							if wanted[ev.ID] {
								s.Dismissals[c.Key] = dismissal
							}
						}
					}
				}
			}
			return state.Save(filepath.Join(a.Config.Home, "state.json"), s)
		}
	}
	return fmt.Errorf("proposal %d not found", id)
}
func (a *App) Doctor() string {
	var b strings.Builder
	fmt.Fprintf(&b, "config: ok\nhome: %s\nmodel: %s\npi: ", a.Config.Home, a.Config.Model)
	if _, e := exec.LookPath("pi"); e == nil {
		b.WriteString("ok\n")
	} else {
		b.WriteString("missing\n")
	}
	fmt.Fprintf(&b, "git: %s\ngh: %s\n", presence("git"), presence("gh"))
	s, e := state.Load(filepath.Join(a.Config.Home, "state.json"))
	if e != nil {
		fmt.Fprintf(&b, "state: %v\n", e)
	} else {
		fmt.Fprintf(&b, "dismissals: %d\nlast run: %s\n", len(s.Dismissals), s.LastRun.Format(time.RFC3339))
	}
	week := a.Now().Add(-7 * 24 * time.Hour)
	pi, _ := pisession.Walk(a.Config.PiSessions, week, a.Config.Projects)
	cc, _, _ := ccsession.Walk(a.Config.ClaudeProjects, week, a.Config.Projects)
	counts := map[string]int{}
	for _, t := range turns(pi, cc) {
		if t.Role != "user" {
			continue
		}
		low := strings.ToLower(strings.TrimSpace(t.Text))
		for _, opener := range a.Config.CorrectionOpeners {
			o := strings.ToLower(opener)
			if low == o || strings.HasPrefix(low, o+" ") || strings.HasPrefix(low, o+",") || strings.HasPrefix(low, o+".") {
				counts[opener]++
				break
			}
		}
	}
	b.WriteString("correction opener matches (7d):\n")
	for _, opener := range a.Config.CorrectionOpeners {
		fmt.Fprintf(&b, "  %s: %d\n", opener, counts[opener])
	}
	return b.String()
}
func presence(s string) string {
	if _, e := exec.LookPath(s); e == nil {
		return "ok"
	}
	return "missing"
}

func IDs(s string) ([]int, error) {
	var out []int
	for _, part := range strings.Split(s, ",") {
		n, e := strconv.Atoi(strings.TrimSpace(part))
		if e != nil || n <= 0 {
			return nil, fmt.Errorf("invalid proposal id %q", part)
		}
		out = append(out, n)
	}
	return out, nil
}
