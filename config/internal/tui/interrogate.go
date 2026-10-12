package tui

import (
	"fmt"
	"os"
	"path/filepath"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/bmelton/HABLO-installer/config/internal/fileio"
	"github.com/bmelton/HABLO-installer/config/internal/paths"
)

type interrogatePage struct {
	paths paths.Paths
	form  formModel
}

func newInterrogatePage(p paths.Paths) *interrogatePage {
	ip := &interrogatePage{paths: p}
	cur := fileio.ReadInterrogate(p.Home)
	home := os.Getenv("HOME")
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	skillCandidates := []string{
		filepath.Join(home, ".pi", "agent", "skills", "technical-design-doc", "SKILL.md"),
	}
	skillNote := "missing (hablo update / install fetches pin)"
	for _, skill := range skillCandidates {
		if _, err := os.Stat(skill); err == nil {
			skillNote = skill
			break
		}
	}
	ip.form = formModel{
		title: fmt.Sprintf("Interrogate  %s", filepath.Join(p.Home, "interrogate.json")),
		fields: []formField{
			newEnumField("enabled", "enabled", fmt.Sprint(cur.Enabled), []enumOpt{
				{Value: "false", Label: "false"},
				{Value: "true", Label: "true"},
			}),
		},
		status: "skill: " + skillNote + " · TDDs → ~/tdds/<TICKET>-<slug>/",
	}
	ip.form.initFocus()
	return ip
}

func (i *interrogatePage) update(msg tea.Msg, root *Model) (tea.Model, tea.Cmd) {
	if km, ok := msg.(tea.KeyMsg); ok {
		switch km.String() {
		case "ctrl+s":
			i.save()
			return root, nil
		case " ", "enter", "right", "l", "left", "h":
			// Single enum: persist as soon as the value changes (esc alone used to discard).
			before := i.form.values()["enabled"]
			cmd := i.form.update(msg)
			if i.form.values()["enabled"] != before {
				i.save()
			}
			return root, cmd
		}
	}
	return root, i.form.update(msg)
}

func (i *interrogatePage) save() {
	if err := i.form.validateEnums(); err != nil {
		i.form.err = err.Error()
		i.form.status = ""
		return
	}
	enabled := parseBool(i.form.values()["enabled"])
	if err := fileio.WriteInterrogateEnabled(i.paths.Home, enabled); err != nil {
		i.form.err = err.Error()
		return
	}
	policy := fileio.InterrogatePolicyPath(i.paths.Home)
	if err := fileio.SetInterrogateCaptainBlock(i.paths.FirstmateDir, policy, enabled); err != nil {
		// Still keep interrogate.json — policy file may be missing until install step 10b.
		i.form.err = "saved enabled=" + fmt.Sprint(enabled) + " but captain.md: " + err.Error()
		i.form.status = ""
		return
	}
	i.form.err = ""
	if enabled {
		i.form.status = "saved enabled=true (captain policy on)"
	} else {
		i.form.status = "saved enabled=false (captain policy off)"
	}
}

func (i *interrogatePage) view() string {
	body := i.form.view()
	return body + "\n" + helpStyle.Render("←→/space toggles and saves immediately · esc back to summary")
}
