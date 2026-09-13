package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Sources struct {
	PiSessions bool `json:"piSessions"`
	GuardLog   bool `json:"guardLog"`
	ClaudeCode bool `json:"claudeCode"`
	Rules      bool `json:"rules"`
	GitHub     bool `json:"github,omitempty"`
}

type Limits struct {
	MaxClusters           int `json:"maxClusters"`
	MaxEvidencePerCluster int `json:"maxEvidencePerCluster"`
	MaxQuoteChars         int `json:"maxQuoteChars"`
	SessionTimeoutMinutes int `json:"sessionTimeoutMinutes"`
}

type Service struct {
	Kind         string `json:"kind"`
	At           string `json:"at"`
	LaunchdLabel string `json:"launchdLabel"`
	SystemdUnit  string `json:"systemdUnit"`
}

type Config struct {
	Enabled           bool     `json:"enabled"`
	Home              string   `json:"home"`
	Since             string   `json:"since"`
	Sources           Sources  `json:"sources"`
	Projects          []string `json:"projects"`
	CorrectionOpeners []string `json:"correctionOpeners"`
	Limits            Limits   `json:"limits"`
	Model             string   `json:"model"`
	Service           Service  `json:"service"`
	GuardLog          string   `json:"guardLog,omitempty"`
	PiSessions        string   `json:"piSessions,omitempty"`
	ClaudeProjects    string   `json:"claudeProjects,omitempty"`
	RulesRoot         string   `json:"rulesRoot,omitempty"`
}

func expand(path string) string {
	if path == "~" || strings.HasPrefix(path, "~/") {
		h, _ := os.UserHomeDir()
		if path == "~" {
			return h
		}
		return filepath.Join(h, strings.TrimPrefix(path, "~/"))
	}
	return path
}

func (c *Config) Normalize() {
	c.Home = expand(c.Home)
	if c.GuardLog == "" {
		c.GuardLog = "~/.hablo/guard-log.jsonl"
	}
	if c.PiSessions == "" {
		c.PiSessions = "~/.pi/agent/sessions"
	}
	if c.ClaudeProjects == "" {
		c.ClaudeProjects = "~/.claude/projects"
	}
	c.GuardLog, c.PiSessions, c.ClaudeProjects = expand(c.GuardLog), expand(c.PiSessions), expand(c.ClaudeProjects)
	for i := range c.Projects {
		c.Projects[i] = expand(c.Projects[i])
	}
	if c.Limits.MaxClusters <= 0 {
		c.Limits.MaxClusters = 40
	}
	if c.Limits.MaxEvidencePerCluster <= 0 {
		c.Limits.MaxEvidencePerCluster = 5
	}
	if c.Limits.MaxQuoteChars <= 0 {
		c.Limits.MaxQuoteChars = 300
	}
	if c.Limits.SessionTimeoutMinutes <= 0 {
		c.Limits.SessionTimeoutMinutes = 20
	}
}

func Load(path string) (Config, error) {
	b, err := os.ReadFile(expand(path))
	if err != nil {
		return Config{}, err
	}
	var c Config
	if err := json.Unmarshal(b, &c); err != nil {
		return c, fmt.Errorf("parse config: %w", err)
	}
	c.Normalize()
	return c, nil
}

func (c Config) SinceTime(now time.Time) (time.Time, error) {
	s := strings.TrimSpace(c.Since)
	if strings.HasSuffix(s, "d") {
		s = strings.TrimSuffix(s, "d") + "h"
		var n int
		if _, err := fmt.Sscanf(s, "%dh", &n); err == nil {
			s = fmt.Sprintf("%dh", n*24)
		}
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid since %q: %w", c.Since, err)
	}
	return now.Add(-d), nil
}
