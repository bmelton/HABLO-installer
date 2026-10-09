package config

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type Project struct {
	Dir string `json:"dir"`
	// Root, when set, replaces the global root for this project, even when it is broader or unrelated.
	Root       string            `json:"root"`
	BaseBranch string            `json:"baseBranch"`
	Mode       string            `json:"mode"`
	Statuses   map[string]string `json:"statuses"`
}

type Labels struct {
	Ready   string `json:"ready"`
	Running string `json:"running"`
	Done    string `json:"done"`
	Failed  string `json:"failed"`
}
type Service struct {
	Kind         string `json:"kind"`
	LaunchdLabel string `json:"launchdLabel"`
	SystemdUnit  string `json:"systemdUnit"`
}
type Agent struct {
	Enabled           bool     `json:"enabled"`
	BinName           string   `json:"binName"`
	IntervalSeconds   int      `json:"intervalSeconds"`
	Labels            Labels   `json:"labels"`
	JQLExtra          string   `json:"jqlExtra"`
	MaxConcurrent     int      `json:"maxConcurrent"`
	MaxAttempts       int      `json:"maxAttempts"`
	RunTimeoutMinutes int      `json:"runTimeoutMinutes"`
	CommentOnDispatch bool     `json:"commentOnDispatch"`
	ReporterAllowlist []string `json:"reporterAllowlist"`
	Service           Service  `json:"service"`
}
type Reporting struct {
	Enabled     bool     `json:"enabled"`
	Transitions bool     `json:"transitions"`
	Stages      []string `json:"stages"`
}
type Config struct {
	Enabled   bool               `json:"enabled"`
	Home      string             `json:"home"`
	EnvFile   string             `json:"envFile"`
	Projects  map[string]Project `json:"projects"`
	Reporting Reporting          `json:"reporting"`
	Agent     Agent              `json:"agent"`
	// Root confines every dispatched captain's writes to this directory. Empty means unconfined.
	Root string `json:"root"`
	// RequireSandbox nil means true: a root that cannot be enforced refuses dispatch rather than running unconfined.
	RequireSandbox *bool `json:"requireSandbox"`
	// HarnessDir is the firstmate checkout. Its state, data and projects directories are writable carve-outs.
	HarnessDir string `json:"harnessDir"`
	// SandboxWritable is the installer's list of carve-outs outside the root. Empty falls back to a built-in guess.
	SandboxWritable []string `json:"sandboxWritable"`
}
type Credentials struct{ URL, Email, Token string }

func expand(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		if h, e := os.UserHomeDir(); e == nil {
			return filepath.Join(h, strings.TrimPrefix(p, "~/"))
		}
	}
	return p
}
func Load(path string) (Config, Credentials, error) {
	b, err := os.ReadFile(expand(path))
	if err != nil {
		return Config{}, Credentials{}, err
	}
	var c Config
	if err := json.Unmarshal(b, &c); err != nil {
		return c, Credentials{}, err
	}
	c.Home, c.EnvFile, c.Root, c.HarnessDir = expand(c.Home), expand(c.EnvFile), expand(c.Root), expand(c.HarnessDir)
	for i, w := range c.SandboxWritable {
		c.SandboxWritable[i] = expand(w)
	}
	for k, p := range c.Projects {
		p.Dir, p.Root = expand(p.Dir), expand(p.Root)
		c.Projects[k] = p
	}
	if err := c.Validate(); err != nil {
		return c, Credentials{}, err
	}
	env, err := loadEnv(c.EnvFile)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return c, Credentials{}, err
	}
	return c, Credentials{env["JIRA_URL"], env["JIRA_EMAIL"], env["JIRA_API_TOKEN"]}, nil
}
func (c Config) Validate() error {
	if c.Home == "" || c.EnvFile == "" {
		return errors.New("jira home and envFile are required")
	}
	if !filepath.IsAbs(c.Home) || !filepath.IsAbs(c.EnvFile) {
		return errors.New("jira home and envFile must resolve to absolute paths")
	}
	if c.Agent.Enabled && len(c.Projects) == 0 {
		return errors.New("enabled Jira agent requires at least one mapped project")
	}
	for key, p := range c.Projects {
		if key == "" || p.Dir == "" || p.BaseBranch == "" {
			return fmt.Errorf("project %q requires dir and baseBranch", key)
		}
		if !regexp.MustCompile(`^[A-Z][A-Z0-9_]*$`).MatchString(key) {
			return fmt.Errorf("invalid Jira project key %q", key)
		}
		if !filepath.IsAbs(p.Dir) {
			return fmt.Errorf("project %s directory must resolve to an absolute path", key)
		}
		if p.Mode == "local-only" {
			return fmt.Errorf("project %s: local-only is unsafe for Jira dispatch", key)
		}
		if root := c.EffectiveRoot(p); root != "" {
			if !filepath.IsAbs(root) {
				return fmt.Errorf("project %s root %s must resolve to an absolute path", key, root)
			}
			if TooBroad(root) {
				return fmt.Errorf("project %s root %s is at or above the home directory, which confines nothing", key, root)
			}
			if !Within(root, p.Dir) {
				return fmt.Errorf("project %s directory %s is outside root %s", key, p.Dir, root)
			}
		}
	}
	if c.Agent.Enabled && (c.Agent.Labels.Ready == "" || c.Agent.Labels.Running == "" || c.Agent.Labels.Done == "" || c.Agent.Labels.Failed == "") {
		return errors.New("enabled Jira agent requires all four labels")
	}
	return nil
}

// EffectiveRoot is the directory a project's captain is confined to: its own root when set, else the global one.
func (c Config) EffectiveRoot(p Project) string {
	if p.Root != "" {
		return p.Root
	}
	return c.Root
}

// SandboxRequired reports whether a configured root must be enforced. A root with no way to enforce it is a
// promise the agent cannot keep, so the default is to refuse rather than run unconfined.
func (c Config) SandboxRequired() bool {
	if c.RequireSandbox != nil && !*c.RequireSandbox {
		return false
	}
	if c.Root != "" {
		return true
	}
	for _, p := range c.Projects {
		if p.Root != "" {
			return true
		}
	}
	return false
}

// Within reports whether path is root or inside it, after resolving symlinks in both. Without resolution a single
// symlink inside the root would carry a project directory anywhere on the machine.
func Within(root, path string) bool {
	r, p := resolveDeepest(root), resolveDeepest(path)
	rel, e := filepath.Rel(r, p)
	return e == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

// TooBroad reports whether a root contains the home directory. Such a root leaves ~/.ssh, shell rc files and every
// other repository writable, so it confines nothing that matters.
func TooBroad(root string) bool {
	home, e := os.UserHomeDir()
	return e != nil || Within(root, home)
}

// resolveDeepest resolves symlinks in the longest existing prefix of p and re-attaches the rest. A project directory
// that is not cloned yet must still compare correctly against a root that sits behind a symlink, such as /var on
// macOS.
func resolveDeepest(p string) string {
	p = filepath.Clean(p)
	var rest []string
	for {
		if r, e := filepath.EvalSymlinks(p); e == nil {
			return filepath.Join(append([]string{r}, rest...)...)
		}
		parent := filepath.Dir(p)
		if parent == p {
			return filepath.Join(append([]string{p}, rest...)...)
		}
		rest = append([]string{filepath.Base(p)}, rest...)
		p = parent
	}
}

func (c Config) ProjectFor(key string) (Project, bool) {
	if !ValidIssueKey(key) {
		return Project{}, false
	}
	p, ok := c.Projects[strings.SplitN(key, "-", 2)[0]]
	return p, ok
}
func ValidIssueKey(key string) bool {
	return regexp.MustCompile(`^[A-Z][A-Z0-9_]*-[1-9][0-9]*$`).MatchString(key)
}
func (c Credentials) Complete() bool { return c.URL != "" && c.Email != "" && c.Token != "" }
func loadEnv(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return map[string]string{}, err
	}
	defer f.Close()
	out := map[string]string{}
	s := bufio.NewScanner(f)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if ok {
			out[strings.TrimSpace(k)] = strings.Trim(strings.TrimSpace(v), "\"'")
		}
	}
	return out, s.Err()
}
