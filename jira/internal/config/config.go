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
	Dir        string            `json:"dir"`
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
	c.Home, c.EnvFile = expand(c.Home), expand(c.EnvFile)
	for k, p := range c.Projects {
		p.Dir = expand(p.Dir)
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
	}
	if c.Agent.Enabled && (c.Agent.Labels.Ready == "" || c.Agent.Labels.Running == "" || c.Agent.Labels.Done == "" || c.Agent.Labels.Failed == "") {
		return errors.New("enabled Jira agent requires all four labels")
	}
	return nil
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
