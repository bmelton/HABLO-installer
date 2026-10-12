package tui

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/bmelton/HABLO-installer/config/internal/cli"
	"github.com/bmelton/HABLO-installer/config/internal/paths"
)

type cliPage struct {
	paths paths.Paths
	form  formModel
}

func newCLIPage(p paths.Paths) *cliPage {
	cp := &cliPage{paths: p}
	d, err := cli.ReadDefaults(p.HabloBin)
	if err != nil {
		cp.form = formModel{title: "CLI defaults", err: err.Error()}
		return cp
	}
	cp.form = formModel{
		title: "CLI defaults  " + p.HabloBin,
		fields: []formField{
			{label: "DEFAULT_PROVIDER", key: "provider", input: newInput("bedrouter", d.Provider, false)},
			{label: "DEFAULT_MODEL", key: "model", input: newInput("auto", d.Model, false)},
		},
		status: "HABLO_PROVIDER / HABLO_MODEL still win at launch",
	}
	cp.form.initFocus()
	return cp
}

func (c *cliPage) update(msg tea.Msg, root *Model) (tea.Model, tea.Cmd) {
	if km, ok := msg.(tea.KeyMsg); ok && km.String() == "ctrl+s" {
		c.save()
		return root, nil
	}
	return root, c.form.update(msg)
}

func (c *cliPage) save() {
	v := c.form.values()
	d := cli.Defaults{
		Provider: strings.TrimSpace(v["provider"]),
		Model:    strings.TrimSpace(v["model"]),
	}
	if d.Provider == "" || d.Model == "" {
		c.form.err = "provider and model are required"
		return
	}
	if err := cli.WriteDefaults(c.paths.HabloBin, d); err != nil {
		c.form.err = err.Error()
		c.form.status = ""
		return
	}
	c.form.err = ""
	c.form.status = "stamped " + d.Provider + "/" + d.Model
}

func (c *cliPage) view() string { return c.form.view() }
