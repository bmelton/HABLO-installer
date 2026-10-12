package decide

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/bmelton/HABLO-installer/guard/internal/audit"
	"github.com/bmelton/HABLO-installer/guard/internal/glob"
	"github.com/bmelton/HABLO-installer/guard/internal/policy"
	"github.com/bmelton/HABLO-installer/guard/internal/resolve"
)

type Session struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Attended bool   `json:"attended"`
	Project  string `json:"project"`
	Cwd      string `json:"cwd"`
	TaskID   string `json:"taskId"`
}

type Request struct {
	V       int            `json:"v"`
	Event   string         `json:"event"`
	Agent   string         `json:"agent"`
	Tool    string         `json:"tool"`
	Input   map[string]any `json:"input"`
	Session Session        `json:"session"`
}

type Finding struct {
	Check   string `json:"check"`
	Message string `json:"message"`
}

type Verdict struct {
	V         int       `json:"v"`
	Verdict   string    `json:"verdict"` // allow | deny | ask
	Rule      string    `json:"rule,omitempty"`
	Reason    string    `json:"reason,omitempty"`
	Remedy    string    `json:"remedy,omitempty"`
	Terminate bool      `json:"terminate"`
	Findings  []Finding `json:"findings,omitempty"`
}

type Engine struct {
	Loader *policy.Loader
	Home   string
}

func (e *Engine) Decide(req Request) (Verdict, int) {
	if req.V == 0 {
		req.V = 1
	}
	pol, err := e.Loader.Get(req.Session.Project)
	if err != nil {
		return Verdict{V: 1, Verdict: "deny", Rule: "policy", Reason: "guard: policy: " + err.Error(), Remedy: "Fix ~/.hablo/guard.json or re-run the HABLO installer."}, 2
	}
	if pol.Mode == "off" || os.Getenv("HABLO_GUARD") == "off" {
		return Verdict{V: 1, Verdict: "allow"}, 0
	}

	if req.Event == "tool_result" {
		return e.postEdit(req, pol), 0
	}

	v := e.evaluate(req, pol)
	if v.Verdict == "allow" {
		return v, 0
	}
	if pol.Mode == "warn" {
		_ = audit.Append(pol.Engine.AuditLog, audit.Line{
			Kind: req.Session.Kind, Task: req.Session.TaskID, Project: req.Session.Project,
			Tool: req.Tool, Rule: v.Rule, Verdict: "warn", Target: targetOf(req), Reason: v.Reason,
		})
		v.Verdict = "allow"
		return v, 0
	}
	if v.Verdict == "ask" && !req.Session.Attended {
		v.Verdict = "deny"
		v.Reason += " (unattended session: ask demoted to deny)"
	}
	_ = audit.Append(pol.Engine.AuditLog, audit.Line{
		Kind: req.Session.Kind, Task: req.Session.TaskID, Project: req.Session.Project,
		Tool: req.Tool, Rule: v.Rule, Verdict: v.Verdict, Target: targetOf(req), Reason: v.Reason, Match: redactMatch(v.Reason),
	})
	return v, 0
}

func (e *Engine) evaluate(req Request, pol *policy.Policy) Verdict {
	tool := normalizeTool(req.Tool)
	home := e.Home
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	cwd := req.Session.Cwd
	if cwd == "" {
		cwd, _ = os.Getwd()
	}

	pathField := firstString(req.Input, "file_path", "path", "filePath")
	content := firstString(req.Input, "content", "new_string", "newString")
	command := firstString(req.Input, "command")

	if pathField != "" {
		abs := resolve.Path(pathField, cwd, home)
		if tool == "read" {
			if hit, pat := matchSecretPath(pol, abs, cwd, home); hit {
				return deny("secrets.read", abs, pat, req.Session.Attended, policy.BoolDefault(pol.Secrets.Interactive, false),
					fmt.Sprintf("reading credential path %s", short(abs, home)),
					"Load secrets from the environment / Infisical-populated .env instead of reading credential files in-session.")
			}
		}
		if tool == "write" || tool == "edit" {
			if hit, pat := matchSecretPath(pol, abs, cwd, home); hit {
				return deny("secrets.write", abs, pat, req.Session.Attended, policy.BoolDefault(pol.Secrets.Interactive, false),
					fmt.Sprintf("writing credential path %s", short(abs, home)),
					"Do not write credential files; rotate via Infisical / aws configure.")
			}
			if v := e.protectedPath(pol, abs, req); v.Verdict != "allow" {
				return v
			}
			if content != "" {
				if v := scanContent(pol, abs, content, req.Session.Attended); v.Verdict != "allow" {
					return v
				}
			}
		}
	}

	if tool == "bash" && command != "" {
		if v := shellDestructive(pol, command, req.Session.Attended); v.Verdict != "allow" {
			return v
		}
		if v := secretsExfil(pol, command, req.Session.Attended); v.Verdict != "allow" {
			return v
		}
		if v := secretsPush(pol, command, cwd, req.Session.Attended); v.Verdict != "allow" {
			return v
		}
	}

	// Exfil tools: scan their input for secret shapes.
	for _, name := range pol.ExfilTools {
		if strings.EqualFold(name, req.Tool) || strings.EqualFold(normalizeTool(name), tool) {
			raw, _ := json.Marshal(req.Input)
			if v := scanContent(pol, req.Tool, string(raw), req.Session.Attended); v.Verdict != "allow" {
				v.Rule = "secrets.content"
				return v
			}
		}
	}

	return Verdict{V: 1, Verdict: "allow"}
}

func (e *Engine) protectedPath(pol *policy.Policy, abs string, req Request) Verdict {
	home := e.Home
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	project := req.Session.Project
	for _, pp := range pol.ProtectedPaths {
		interactive := policy.BoolDefault(pp.Interactive, true)
		if pp.OutsideProject {
			if project == "" {
				continue
			}
			projAbs := resolve.Path(project, req.Session.Cwd, home)
			rel, err := filepath.Rel(projAbs, abs)
			if err != nil || strings.HasPrefix(rel, "..") {
				return deny(pp.Rule, abs, "outsideProject", req.Session.Attended, interactive,
					fmt.Sprintf("write outside project %s: %s", short(projAbs, home), short(abs, home)),
					"Keep edits inside the HABLO project, or clear HABLO_PROJECT for solo work.")
			}
			continue
		}
		if pp.Glob == "" {
			continue
		}
		if pathMatches(pp.Glob, abs, home) {
			if allowed(pol, pp.Rule, abs, req.Session.Project, home) {
				continue
			}
			return deny(pp.Rule, abs, pp.Glob, req.Session.Attended, interactive,
				fmt.Sprintf("write to protected path %s", short(abs, home)),
				fmt.Sprintf("Add {\"rule\":%q,\"glob\":%q,\"note\":\"…\"} to guard.allow in hablo.json and re-run the installer.", pp.Rule, pp.Glob))
		}
	}
	return Verdict{V: 1, Verdict: "allow"}
}

func (e *Engine) postEdit(req Request, pol *policy.Policy) Verdict {
	// Report-only stubs: return empty findings when checks absent.
	return Verdict{V: 1, Verdict: "allow", Findings: nil}
}

func scanContent(pol *policy.Policy, target, content string, attended bool) Verdict {
	if len(content) > pol.Secrets.MaxScanBytes {
		return deny("secrets.content", target, "maxScanBytes", attended, false,
			fmt.Sprintf("content of %s exceeds secrets.maxScanBytes (%d)", target, pol.Secrets.MaxScanBytes),
			"Split the write or raise secrets.maxScanBytes deliberately.")
	}
	interactive := policy.BoolDefault(pol.Secrets.Interactive, false)
	for _, pat := range pol.Secrets.Patterns {
		re, err := regexp.Compile(pat)
		if err != nil {
			continue
		}
		if m := re.FindString(content); m != "" {
			return deny("secrets.content", target, redactMatch(m), attended, interactive,
				fmt.Sprintf("the new content of %s contains a secret matching %s", target, previewPattern(pat)),
				"Remove the literal value and read it from the environment. Secrets load from .env (Infisical).")
		}
	}
	return Verdict{V: 1, Verdict: "allow"}
}

func shellDestructive(pol *policy.Policy, command string, attended bool) Verdict {
	interactive := policy.BoolDefault(pol.Shell.Interactive, true)
	for _, pat := range pol.Shell.Deny {
		re, err := regexp.Compile(pat)
		if err != nil {
			continue
		}
		if re.MatchString(command) {
			return deny("shell.destructive", command, pat, attended, interactive,
				"destructive shell command blocked",
				"Run the command yourself in a shell, or add a noted allow entry for shell.destructive.")
		}
	}
	// Force push to protected branches
	if regexp.MustCompile(`\bgit\s+push\b.*(--force|-f)\b`).MatchString(command) {
		for _, br := range pol.ForcePushBranches() {
			if regexp.MustCompile(`\b` + regexp.QuoteMeta(br) + `\b`).MatchString(command) {
				return deny("shell.destructive", command, "force-push:"+br, attended, interactive,
					fmt.Sprintf("force-push to %s blocked", br),
					"Force-push only to personal branches, never develop/main/master.")
			}
		}
	}
	return Verdict{V: 1, Verdict: "allow"}
}

func secretsExfil(pol *policy.Policy, command string, attended bool) Verdict {
	interactive := policy.BoolDefault(pol.Secrets.Interactive, false)
	low := strings.ToLower(command)
	hasExfil := false
	for _, c := range pol.Secrets.ExfilCommands {
		if regexp.MustCompile(`\b` + regexp.QuoteMeta(strings.ToLower(c)) + `\b`).MatchString(low) {
			hasExfil = true
			break
		}
	}
	for _, h := range pol.Secrets.ExfilHosts {
		if strings.Contains(low, strings.ToLower(h)) {
			hasExfil = true
			break
		}
	}
	if !hasExfil {
		return Verdict{V: 1, Verdict: "allow"}
	}
	// Credential path referenced in the same command.
	for _, p := range pol.Secrets.Paths {
		base := filepath.Base(strings.TrimSuffix(p, "/**"))
		base = strings.TrimPrefix(base, "**/")
		if base == "" || base == "*" || base == "**" {
			continue
		}
		if strings.Contains(command, base) || strings.Contains(command, ".env") {
			return deny("secrets.exfil", command, base, attended, interactive,
				"shell command appears to exfiltrate a credential file",
				"Do not pipe credential files to curl/scp/rsync/pastebins.")
		}
	}
	return Verdict{V: 1, Verdict: "allow"}
}

func secretsPush(pol *policy.Policy, command, cwd string, attended bool) Verdict {
	if !regexp.MustCompile(`\bgit\s+push\b`).MatchString(command) {
		return Verdict{V: 1, Verdict: "allow"}
	}
	out, err := exec.Command("git", "-C", cwd, "diff", "--cached", "--name-only").Output()
	if err != nil {
		return Verdict{V: 1, Verdict: "allow"}
	}
	home, _ := os.UserHomeDir()
	interactive := policy.BoolDefault(pol.Secrets.Interactive, false)
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		abs := resolve.Path(line, cwd, home)
		if hit, pat := matchSecretPath(pol, abs, cwd, home); hit {
			return deny("secrets.push", line, pat, attended, interactive,
				fmt.Sprintf("staged secret path %s would be pushed", line),
				"Unstage the credential file and use Infisical / .env instead.")
		}
	}
	return Verdict{V: 1, Verdict: "allow"}
}

func matchSecretPath(pol *policy.Policy, abs, cwd, home string) (bool, string) {
	for _, pat := range pol.Secrets.Paths {
		if pathMatches(pat, abs, home) {
			return true, pat
		}
		// Also match basename-style patterns against relative form.
		rel := abs
		if cwd != "" {
			if r, err := filepath.Rel(cwd, abs); err == nil {
				rel = r
			}
		}
		if pathMatches(pat, rel, home) {
			return true, pat
		}
	}
	return false, ""
}

func pathMatches(pattern, abs, home string) bool {
	pattern = filepath.ToSlash(pattern)
	absSlash := filepath.ToSlash(abs)
	if glob.Match(pattern, absSlash) {
		return true
	}
	// Patterns like **/.env should match any directory depth.
	if strings.HasPrefix(pattern, "**/") {
		if glob.Match(pattern, absSlash) {
			return true
		}
		// Try suffix match on basename patterns.
		suf := strings.TrimPrefix(pattern, "**/")
		if !strings.Contains(suf, "/") && glob.Match(suf, filepath.Base(absSlash)) {
			return true
		}
		if glob.Match(suf, absSlash) {
			return true
		}
	}
	// Absolute expanded patterns (e.g. /home/u/.aws/credentials)
	if filepath.IsAbs(pattern) && (absSlash == filepath.ToSlash(pattern) || glob.Match(pattern, absSlash)) {
		return true
	}
	_ = home
	return false
}

func allowed(pol *policy.Policy, rule, abs, project, home string) bool {
	for _, a := range pol.Allow {
		if a.Rule != rule {
			continue
		}
		if a.Project != "" {
			proj := resolve.Path(a.Project, "", home)
			if project == "" || resolve.Path(project, "", home) != proj {
				continue
			}
		}
		if a.Glob != "" && pathMatches(a.Glob, abs, home) {
			return true
		}
	}
	return false
}

func deny(rule, target, match string, attended, interactive bool, reason, remedy string) Verdict {
	v := "deny"
	if interactive && attended {
		v = "ask"
	}
	return Verdict{
		V: 1, Verdict: v, Rule: rule,
		Reason:    fmt.Sprintf("guard: %s: %s", rule, reason),
		Remedy:    remedy,
		Terminate: false,
	}
}

func normalizeTool(t string) string {
	switch strings.ToLower(t) {
	case "read":
		return "read"
	case "write", "notebookedit":
		return "write"
	case "edit":
		return "edit"
	case "bash", "powershell":
		return "bash"
	default:
		return strings.ToLower(t)
	}
}

func firstString(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
	}
	return ""
}

func targetOf(req Request) string {
	if p := firstString(req.Input, "file_path", "path"); p != "" {
		return p
	}
	if c := firstString(req.Input, "command"); c != "" {
		if len(c) > 120 {
			return c[:120] + "…"
		}
		return c
	}
	return req.Tool
}

func short(p, home string) string {
	if home != "" && strings.HasPrefix(p, home) {
		return "~" + p[len(home):]
	}
	return p
}

func redactMatch(s string) string {
	if len(s) <= 4 {
		return fmt.Sprintf("%s(%d)", s, len(s))
	}
	return fmt.Sprintf("%s…(%d)", s[:4], len(s))
}

func previewPattern(pat string) string {
	if len(pat) > 24 {
		return pat[:24] + "…"
	}
	return pat
}

func DecodeRequest(b []byte) (Request, error) {
	var req Request
	if err := json.Unmarshal(b, &req); err != nil {
		return req, err
	}
	if req.Input == nil {
		req.Input = map[string]any{}
	}
	return req, nil
}
