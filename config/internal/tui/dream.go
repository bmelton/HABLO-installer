package tui

import (
	"encoding/json"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/bmelton/HABLO-installer/config/internal/fileio"
	"github.com/bmelton/HABLO-installer/config/internal/jsonedit"
	"github.com/bmelton/HABLO-installer/config/internal/paths"
)

type dreamPage struct {
	paths paths.Paths
	obj   map[string]any
	form  formModel
}

func newDreamPage(p paths.Paths) *dreamPage {
	dp := &dreamPage{paths: p}
	obj, err := fileio.LoadDreamObject(p.DreamConfig)
	if err != nil {
		dp.form = formModel{title: "Dream", err: err.Error()}
		return dp
	}
	dp.obj = obj
	sources := jsonedit.GetMap(obj, "sources")
	limits := jsonedit.GetMap(obj, "limits")
	service := jsonedit.GetMap(obj, "service")
	projects, _ := json.Marshal(obj["projects"])
	openers, _ := json.Marshal(obj["correctionOpeners"])
	dp.form = formModel{
		title: "Dream  " + p.DreamConfig,
		fields: []formField{
			newBoolField("enabled", "enabled", jsonedit.GetBool(obj, "enabled", false)),
			{label: "home", key: "home", input: newInput("path", jsonedit.GetString(obj, "home"), false)},
			{label: "since", key: "since", input: newInput("24h", jsonedit.GetString(obj, "since"), false)},
			{label: "model", key: "model", input: newInput("bedrouter/auto", jsonedit.GetString(obj, "model"), false)},
			newBoolField("sources.piSessions", "sources.piSessions", jsonedit.GetBool(sources, "piSessions", true)),
			newBoolField("sources.guardLog", "sources.guardLog", jsonedit.GetBool(sources, "guardLog", true)),
			newBoolField("sources.claudeCode", "sources.claudeCode", jsonedit.GetBool(sources, "claudeCode", true)),
			newBoolField("sources.rules", "sources.rules", jsonedit.GetBool(sources, "rules", true)),
			newBoolField("sources.github", "sources.github", jsonedit.GetBool(sources, "github", false)),
			{label: "limits.maxClusters", key: "limits.maxClusters", input: newInput("40", jsonedit.GetNumberString(limits, "maxClusters"), false)},
			{label: "service.at", key: "service.at", input: newInput("03:00", jsonedit.GetString(service, "at"), false)},
			{label: "projects JSON array", key: "projects", input: newInput(`["~/code"]`, string(projects), false)},
			{label: "correctionOpeners JSON", key: "correctionOpeners", input: newInput(`["no"]`, string(openers), false)},
		},
	}
	dp.form.initFocus()
	return dp
}

func (d *dreamPage) update(msg tea.Msg, root *Model) (tea.Model, tea.Cmd) {
	if km, ok := msg.(tea.KeyMsg); ok && km.String() == "ctrl+s" {
		d.save()
		return root, nil
	}
	return root, d.form.update(msg)
}

func (d *dreamPage) save() {
	if d.obj == nil {
		d.form.err = "no config loaded"
		return
	}
	v := d.form.values()
	jsonedit.SetBool(d.obj, "enabled", parseBool(v["enabled"]))
	jsonedit.SetString(d.obj, "home", strings.TrimSpace(v["home"]))
	jsonedit.SetString(d.obj, "since", strings.TrimSpace(v["since"]))
	jsonedit.SetString(d.obj, "model", strings.TrimSpace(v["model"]))
	sources := jsonedit.GetMap(d.obj, "sources")
	jsonedit.SetBool(sources, "piSessions", parseBool(v["sources.piSessions"]))
	jsonedit.SetBool(sources, "guardLog", parseBool(v["sources.guardLog"]))
	jsonedit.SetBool(sources, "claudeCode", parseBool(v["sources.claudeCode"]))
	jsonedit.SetBool(sources, "rules", parseBool(v["sources.rules"]))
	jsonedit.SetBool(sources, "github", parseBool(v["sources.github"]))
	d.obj["sources"] = sources
	limits := jsonedit.GetMap(d.obj, "limits")
	if err := jsonedit.SetIntString(limits, "maxClusters", v["limits.maxClusters"]); err != nil {
		d.form.err = err.Error()
		return
	}
	d.obj["limits"] = limits
	service := jsonedit.GetMap(d.obj, "service")
	jsonedit.SetString(service, "at", strings.TrimSpace(v["service.at"]))
	d.obj["service"] = service

	var projects any
	if err := json.Unmarshal([]byte(v["projects"]), &projects); err != nil {
		d.form.err = "projects: " + err.Error()
		return
	}
	d.obj["projects"] = projects
	var openers any
	if err := json.Unmarshal([]byte(v["correctionOpeners"]), &openers); err != nil {
		d.form.err = "correctionOpeners: " + err.Error()
		return
	}
	d.obj["correctionOpeners"] = openers

	if err := fileio.SaveDreamObject(d.paths.DreamConfig, d.obj); err != nil {
		d.form.err = err.Error()
		d.form.status = ""
		return
	}
	d.form.err = ""
	d.form.status = "saved (validated)"
}

func (d *dreamPage) view() string { return d.form.view() }
