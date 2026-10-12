package tui

import (
	"encoding/json"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/bmelton/HABLO-installer/config/internal/fileio"
	"github.com/bmelton/HABLO-installer/config/internal/jsonedit"
	"github.com/bmelton/HABLO-installer/config/internal/paths"
)

type jiraPage struct {
	paths paths.Paths
	obj   map[string]any
	form  formModel
}

func newJiraPage(p paths.Paths) *jiraPage {
	jp := &jiraPage{paths: p}
	obj, err := fileio.LoadJiraObject(p.JiraConfig)
	if err != nil {
		jp.form = formModel{title: "Jira", err: err.Error()}
		return jp
	}
	jp.obj = obj
	agent := jsonedit.GetMap(obj, "agent")
	labels := jsonedit.GetMap(agent, "labels")
	jp.form = formModel{
		title: "Jira  " + p.JiraConfig,
		fields: []formField{
			newBoolField("enabled", "enabled", jsonedit.GetBool(obj, "enabled", false)),
			{label: "home", key: "home", input: newInput("path", jsonedit.GetString(obj, "home"), false)},
			{label: "envFile", key: "envFile", input: newInput("path", jsonedit.GetString(obj, "envFile"), false)},
			{label: "root (sandbox)", key: "root", input: newInput("empty=unconfined", jsonedit.GetString(obj, "root"), false)},
			{label: "harnessDir", key: "harnessDir", input: newInput("firstmate dir", jsonedit.GetString(obj, "harnessDir"), false)},
			newBoolField("agent.enabled", "agent.enabled", jsonedit.GetBool(agent, "enabled", false)),
			{label: "agent.intervalSeconds", key: "agent.intervalSeconds", input: newInput("20", jsonedit.GetNumberString(agent, "intervalSeconds"), false)},
			{label: "agent.maxConcurrent", key: "agent.maxConcurrent", input: newInput("1", jsonedit.GetNumberString(agent, "maxConcurrent"), false)},
			{label: "agent.jqlExtra", key: "agent.jqlExtra", input: newInput("JQL", jsonedit.GetString(agent, "jqlExtra"), false)},
			{label: "labels.ready", key: "labels.ready", input: newInput("agent-ready", jsonedit.GetString(labels, "ready"), false)},
			{label: "labels.running", key: "labels.running", input: newInput("agent-running", jsonedit.GetString(labels, "running"), false)},
			{label: "labels.done", key: "labels.done", input: newInput("agent-done", jsonedit.GetString(labels, "done"), false)},
			{label: "labels.failed", key: "labels.failed", input: newInput("agent-failed", jsonedit.GetString(labels, "failed"), false)},
			{label: "projects JSON", key: "projects", input: newInput(`{"HAB":{...}}`, marshalMini(jsonedit.GetMap(obj, "projects")), false)},
		},
	}
	jp.form.initFocus()
	return jp
}

func marshalMini(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}

func (j *jiraPage) update(msg tea.Msg, root *Model) (tea.Model, tea.Cmd) {
	if km, ok := msg.(tea.KeyMsg); ok && km.String() == "ctrl+s" {
		j.save()
		return root, nil
	}
	cmd := j.form.update(msg)
	return root, cmd
}

func (j *jiraPage) save() {
	if j.obj == nil {
		j.form.err = "no config loaded"
		return
	}
	v := j.form.values()
	jsonedit.SetBool(j.obj, "enabled", parseBool(v["enabled"]))
	jsonedit.SetString(j.obj, "home", strings.TrimSpace(v["home"]))
	jsonedit.SetString(j.obj, "envFile", strings.TrimSpace(v["envFile"]))
	if r := strings.TrimSpace(v["root"]); r == "" {
		delete(j.obj, "root")
	} else {
		jsonedit.SetString(j.obj, "root", r)
	}
	jsonedit.SetString(j.obj, "harnessDir", strings.TrimSpace(v["harnessDir"]))

	agent := jsonedit.GetMap(j.obj, "agent")
	jsonedit.SetBool(agent, "enabled", parseBool(v["agent.enabled"]))
	if err := jsonedit.SetIntString(agent, "intervalSeconds", v["agent.intervalSeconds"]); err != nil {
		j.form.err = err.Error()
		return
	}
	if err := jsonedit.SetIntString(agent, "maxConcurrent", v["agent.maxConcurrent"]); err != nil {
		j.form.err = err.Error()
		return
	}
	jsonedit.SetString(agent, "jqlExtra", v["agent.jqlExtra"])
	labels := jsonedit.GetMap(agent, "labels")
	jsonedit.SetString(labels, "ready", v["labels.ready"])
	jsonedit.SetString(labels, "running", v["labels.running"])
	jsonedit.SetString(labels, "done", v["labels.done"])
	jsonedit.SetString(labels, "failed", v["labels.failed"])
	agent["labels"] = labels
	j.obj["agent"] = agent

	var projects map[string]any
	if err := json.Unmarshal([]byte(v["projects"]), &projects); err != nil {
		j.form.err = "projects JSON: " + err.Error()
		j.form.status = ""
		return
	}
	j.obj["projects"] = projects

	if err := fileio.SaveJiraObject(j.paths.JiraConfig, j.obj); err != nil {
		j.form.err = err.Error()
		j.form.status = ""
		return
	}
	j.form.err = ""
	j.form.status = "saved (validated)"
}

func (j *jiraPage) view() string { return j.form.view() }
