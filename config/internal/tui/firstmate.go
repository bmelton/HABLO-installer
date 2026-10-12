package tui

import (
	"strings"

	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/bmelton/HABLO-installer/config/internal/agent"
	"github.com/bmelton/HABLO-installer/config/internal/fileio"
	"github.com/bmelton/HABLO-installer/config/internal/paths"
)

type firstmatePage struct {
	paths    paths.Paths
	form     formModel
	brief    textarea.Model
	focusBox int // 0=fields, 1=brief
}

func newFirstmatePage(p paths.Paths) *firstmatePage {
	fp := &firstmatePage{paths: p}
	backend := fileio.ReadBackend(p.FirstmateDir)
	harness := agent.ReadCrewHarness(p.FirstmateDir)
	brief, _ := fileio.ReadBriefInclude(p.FirstmateDir)
	ta := textarea.New()
	ta.SetWidth(72)
	ta.SetHeight(10)
	ta.SetValue(brief)
	ta.Blur()
	fp.brief = ta
	fp.form = formModel{
		title: "Firstmate  " + p.FirstmateDir,
		fields: []formField{
			newEnumField("backend", "backend", backend, []enumOpt{
				{Value: "", Label: "auto"},
				{Value: "tmux", Label: "tmux"},
				{Value: "herdr", Label: "herdr"},
			}),
			newEnumField("crew-harness", "crew-harness", harness, []enumOpt{
				{Value: agent.Pi, Label: "pi"},
				{Value: agent.Claude, Label: "claude"},
			}),
		},
	}
	fp.form.initFocus()
	return fp
}

func (f *firstmatePage) update(msg tea.Msg, root *Model) (tea.Model, tea.Cmd) {
	if km, ok := msg.(tea.KeyMsg); ok {
		switch km.String() {
		case "ctrl+s":
			f.save()
			return root, nil
		case "ctrl+b":
			if f.focusBox == 0 {
				f.focusBox = 1
				if len(f.form.fields) > 0 {
					f.form.fields[f.form.focus].input.Blur()
				}
				f.brief.Focus()
			} else {
				f.focusBox = 0
				f.brief.Blur()
				f.form.initFocus()
			}
			return root, nil
		}
	}
	if f.focusBox == 1 {
		var cmd tea.Cmd
		f.brief, cmd = f.brief.Update(msg)
		return root, cmd
	}
	return root, f.form.update(msg)
}

func (f *firstmatePage) save() {
	if err := f.form.validateEnums(); err != nil {
		f.form.err = err.Error()
		f.form.status = ""
		return
	}
	v := f.form.values()
	backend := strings.TrimSpace(v["backend"])
	harness := strings.TrimSpace(v["crew-harness"])
	if err := fileio.WriteBackend(f.paths.FirstmateDir, backend); err != nil {
		f.form.err = "backend: " + err.Error()
		return
	}
	if err := agent.WriteCrewHarness(f.paths.FirstmateDir, harness); err != nil {
		f.form.err = "crew-harness: " + err.Error()
		return
	}
	// Keep marker in sync when harness changes from this page.
	if err := agent.Write(f.paths.AgentMarker, harness); err != nil {
		f.form.err = "agent marker: " + err.Error()
		return
	}
	if err := fileio.WriteBriefInclude(f.paths.FirstmateDir, f.brief.Value()); err != nil {
		f.form.err = "brief-include: " + err.Error()
		return
	}
	f.form.err = ""
	f.form.status = "saved backend, crew-harness, agent marker, brief-include"
}

func (f *firstmatePage) view() string {
	var b strings.Builder
	b.WriteString(f.form.view())
	b.WriteString("\n\n" + titleStyle.Render("brief-include.md") + "  " + helpStyle.Render("(ctrl+b focus)") + "\n")
	b.WriteString(f.brief.View())
	return b.String()
}
