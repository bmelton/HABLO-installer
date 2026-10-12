package paths

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Paths locates the runtime files hablo-config edits.
type Paths struct {
	Home         string
	JiraConfig   string
	JiraHome     string
	JiraEnv      string
	DreamConfig  string
	HabloBin     string
	AgentMarker  string
	FirstmateDir string
	BinDir       string
}

// Resolve builds Paths from HOME and optional overrides (empty = discover).
func Resolve(home, habloBin, firstmateDir string) Paths {
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	habloHome := filepath.Join(home, ".hablo")
	jiraHome := filepath.Join(habloHome, "jira")
	p := Paths{
		Home:        habloHome,
		JiraHome:    jiraHome,
		JiraConfig:  filepath.Join(jiraHome, "config.json"),
		DreamConfig: filepath.Join(habloHome, "dream", "config.json"),
		AgentMarker: filepath.Join(habloHome, "agent"),
		BinDir:      filepath.Join(home, ".local", "bin"),
	}
	if habloBin != "" {
		p.HabloBin = habloBin
	} else if which, err := exec.LookPath("hablo"); err == nil {
		p.HabloBin = which
	} else {
		p.HabloBin = filepath.Join(p.BinDir, "hablo")
	}
	if firstmateDir != "" {
		p.FirstmateDir = expandHome(firstmateDir, home)
	} else if fm := readStamp(p.HabloBin, "FM_ROOT"); fm != "" && fm != "__FM_ROOT__" {
		p.FirstmateDir = fm
	} else {
		p.FirstmateDir = filepath.Join(home, "firstmate")
	}
	p.JiraEnv = jiraEnvFromConfig(p.JiraConfig, filepath.Join(jiraHome, ".env"))
	return p
}

func jiraEnvFromConfig(cfgPath, fallback string) string {
	b, err := os.ReadFile(cfgPath)
	if err != nil {
		return fallback
	}
	// Lightweight extract: avoid importing the full jira loader here for path bootstrap.
	const key = `"envFile"`
	i := strings.Index(string(b), key)
	if i < 0 {
		return fallback
	}
	rest := string(b)[i+len(key):]
	q1 := strings.Index(rest, `"`)
	if q1 < 0 {
		return fallback
	}
	rest = rest[q1+1:]
	q2 := strings.Index(rest, `"`)
	if q2 < 0 {
		return fallback
	}
	return expandHome(rest[:q2], "")
}

func expandHome(p, home string) string {
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	if p == "~" {
		return home
	}
	if strings.HasPrefix(p, "~/") {
		return filepath.Join(home, p[2:])
	}
	return p
}

func readStamp(habloBin, varName string) string {
	f, err := os.Open(habloBin)
	if err != nil {
		return ""
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	for s.Scan() {
		line := s.Text()
		if !strings.HasPrefix(line, varName+"=") {
			continue
		}
		v := strings.TrimPrefix(line, varName+"=")
		// Stamped form: FM_ROOT="${FM_ROOT:-/path/to/firstmate}"
		if i := strings.Index(v, ":-"); i >= 0 {
			rest := v[i+2:]
			rest = strings.TrimSuffix(rest, `}"`)
			rest = strings.TrimSuffix(rest, `}`)
			return strings.Trim(rest, `"`)
		}
		return strings.Trim(v, `"`)
	}
	return ""
}

// HabloHomeStamp returns the stamped HABLO_HOME from the hablo binary, if present.
func HabloHomeStamp(habloBin string) string {
	v := readStamp(habloBin, "HABLO_HOME")
	if v == "" || v == "__HABLO_HOME__" {
		return ""
	}
	return v
}
