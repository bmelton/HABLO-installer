package tui

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/bmelton/HABLO-installer/config/internal/agent"
	"github.com/bmelton/HABLO-installer/config/internal/paths"
)

type agentPage struct {
	paths paths.Paths
	form  formModel
}

func newAgentPage(p paths.Paths) *agentPage {
	ap := &agentPage{paths: p}
	cur := agent.Read(p.AgentMarker)
	ap.form = formModel{
		title: "Agent  " + p.AgentMarker,
		fields: []formField{
			newEnumField("active agent", "agent", cur, []enumOpt{
				{Value: agent.Pi, Label: "pi"},
				{Value: agent.Claude, Label: "claude"},
			}),
		},
	}
	if w := agent.WarnClaudeMissing(cur); w != "" {
		ap.form.err = w
	}
	ap.form.initFocus()
	return ap
}

func (a *agentPage) update(msg tea.Msg, root *Model) (tea.Model, tea.Cmd) {
	if km, ok := msg.(tea.KeyMsg); ok && km.String() == "ctrl+s" {
		a.save()
		return root, nil
	}
	return root, a.form.update(msg)
}

func (a *agentPage) save() {
	if err := a.form.validateEnums(); err != nil {
		a.form.err = err.Error()
		a.form.status = ""
		return
	}
	name := strings.ToLower(strings.TrimSpace(a.form.values()["agent"]))
	if err := agent.SetPreference(a.paths.AgentMarker, a.paths.FirstmateDir, name); err != nil {
		a.form.err = err.Error()
		a.form.status = ""
		return
	}
	a.form.status = "saved agent=" + name + " (marker + crew-harness)"
	if w := agent.WarnClaudeMissing(name); w != "" {
		a.form.err = w
	} else {
		a.form.err = ""
	}
}

func (a *agentPage) view() string {
	body := a.form.view()
	return body + "\n" + helpStyle.Render("←→/space choose pi|claude · ctrl+s save (Claude may be missing; still saves)")
}
