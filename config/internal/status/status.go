package status

import (
	"fmt"
	"os"
	"strings"

	"github.com/bmelton/HABLO-installer/config/internal/agent"
	"github.com/bmelton/HABLO-installer/config/internal/cli"
	"github.com/bmelton/HABLO-installer/config/internal/envfile"
	"github.com/bmelton/HABLO-installer/config/internal/fileio"
	"github.com/bmelton/HABLO-installer/config/internal/jsonedit"
	"github.com/bmelton/HABLO-installer/config/internal/paths"
)

// Chip is a one-line status summary.
type Chip struct {
	Name  string
	Value string
	OK    bool
}

// Collect returns home-page style status chips.
func Collect(p paths.Paths) []Chip {
	chips := []Chip{}

	ag := agent.Read(p.AgentMarker)
	ok := ag != agent.Claude || agent.ClaudeOnPATH()
	val := ag
	if w := agent.WarnClaudeMissing(ag); w != "" {
		val = ag + " (missing binary)"
	}
	chips = append(chips, Chip{Name: "agent", Value: val, OK: ok})

	if _, err := os.Stat(p.JiraConfig); err != nil {
		chips = append(chips, Chip{Name: "jira", Value: "missing config", OK: false})
	} else if obj, err := fileio.LoadJiraObject(p.JiraConfig); err != nil {
		chips = append(chips, Chip{Name: "jira", Value: err.Error(), OK: false})
	} else if err := fileio.ValidateJiraObject(obj); err != nil {
		chips = append(chips, Chip{Name: "jira", Value: err.Error(), OK: false})
	} else {
		en := jsonedit.GetBool(obj, "enabled", false)
		chips = append(chips, Chip{Name: "jira", Value: fmt.Sprintf("enabled=%v", en), OK: true})
	}

	mode := envfile.ModeString(p.JiraEnv)
	secOK := mode == "0600" || mode == "(missing)"
	link := ""
	if envfile.IsSymlink(p.JiraEnv) {
		link = " → " + envfile.LinkSource(p.JiraEnv)
	}
	chips = append(chips, Chip{Name: "secrets", Value: mode + link, OK: secOK && !envfile.TooOpen(p.JiraEnv)})

	if _, err := os.Stat(p.DreamConfig); err != nil {
		chips = append(chips, Chip{Name: "dream", Value: "missing config", OK: false})
	} else if obj, err := fileio.LoadDreamObject(p.DreamConfig); err != nil {
		chips = append(chips, Chip{Name: "dream", Value: err.Error(), OK: false})
	} else if err := fileio.ValidateDreamObject(obj); err != nil {
		chips = append(chips, Chip{Name: "dream", Value: err.Error(), OK: false})
	} else {
		en := jsonedit.GetBool(obj, "enabled", false)
		chips = append(chips, Chip{Name: "dream", Value: fmt.Sprintf("enabled=%v model=%s", en, jsonedit.GetString(obj, "model")), OK: true})
	}

	harness := agent.ReadCrewHarness(p.FirstmateDir)
	chips = append(chips, Chip{Name: "firstmate", Value: fmt.Sprintf("harness=%s dir=%s", harness, p.FirstmateDir), OK: true})

	if d, err := cli.ReadDefaults(p.HabloBin); err != nil {
		chips = append(chips, Chip{Name: "cli", Value: err.Error(), OK: false})
	} else {
		chips = append(chips, Chip{Name: "cli", Value: fmt.Sprintf("%s/%s", d.Provider, d.Model), OK: true})
	}

	return chips
}

// Print writes chips to w.
func Print(p paths.Paths) string {
	var b strings.Builder
	b.WriteString("hablo-config status (runtime files; next install may overwrite JSON)\n")
	for _, c := range Collect(p) {
		mark := "ok"
		if !c.OK {
			mark = "!!"
		}
		fmt.Fprintf(&b, "  [%s] %-10s %s\n", mark, c.Name, c.Value)
	}
	return b.String()
}

// Check validates runtime files; returns error messages (empty = pass).
func Check(p paths.Paths) []string {
	var errs []string
	if _, err := os.Stat(p.JiraConfig); err == nil {
		obj, err := fileio.LoadJiraObject(p.JiraConfig)
		if err != nil {
			errs = append(errs, "jira: "+err.Error())
		} else if err := fileio.ValidateJiraObject(obj); err != nil {
			errs = append(errs, "jira: "+err.Error())
		}
	}
	if _, err := os.Stat(p.DreamConfig); err == nil {
		obj, err := fileio.LoadDreamObject(p.DreamConfig)
		if err != nil {
			errs = append(errs, "dream: "+err.Error())
		} else if err := fileio.ValidateDreamObject(obj); err != nil {
			errs = append(errs, "dream: "+err.Error())
		}
	}
	if envfile.TooOpen(p.JiraEnv) {
		errs = append(errs, fmt.Sprintf("secrets: %s mode %s is readable beyond owner (want 0600)", p.JiraEnv, envfile.ModeString(p.JiraEnv)))
	}
	ag := agent.Read(p.AgentMarker)
	if ag != agent.Pi && ag != agent.Claude {
		errs = append(errs, "agent: invalid marker value "+ag)
	}
	return errs
}
