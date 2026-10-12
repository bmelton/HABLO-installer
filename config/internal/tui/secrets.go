package tui

import (
	"fmt"
	"os/exec"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/bmelton/HABLO-installer/config/internal/envfile"
	"github.com/bmelton/HABLO-installer/config/internal/paths"
)

type secretsPage struct {
	paths  paths.Paths
	form   formModel
	action string
}

func newSecretsPage(p paths.Paths) *secretsPage {
	vals, _ := envfile.Load(p.JiraEnv)
	linkNote := p.JiraEnv
	if envfile.IsSymlink(p.JiraEnv) {
		linkNote = fmt.Sprintf("%s → %s", p.JiraEnv, envfile.LinkSource(p.JiraEnv))
	}
	sp := &secretsPage{paths: p}
	sp.form = formModel{
		title: "Secrets  " + linkNote + "  mode=" + envfile.ModeString(p.JiraEnv),
		fields: []formField{
			{label: "JIRA_URL", key: "JIRA_URL", input: newInput("https://…atlassian.net", vals["JIRA_URL"], false)},
			{label: "JIRA_EMAIL", key: "JIRA_EMAIL", input: newInput("you@example.com", vals["JIRA_EMAIL"], false)},
			{label: "JIRA_API_TOKEN", key: "JIRA_API_TOKEN", input: newInput("token", vals["JIRA_API_TOKEN"], true)},
			{label: "AWS profile (SSO login action)", key: "aws_profile", input: newInput("bedrouter", "bedrouter", false)},
		},
	}
	if envfile.TooOpen(p.JiraEnv) {
		sp.form.err = "warning: secrets file is readable beyond owner"
	}
	sp.form.initFocus()
	return sp
}

func (s *secretsPage) update(msg tea.Msg, root *Model) (tea.Model, tea.Cmd) {
	if km, ok := msg.(tea.KeyMsg); ok {
		switch km.String() {
		case "ctrl+s":
			s.save()
			return root, nil
		case "ctrl+a":
			s.awsLogin()
			return root, nil
		case "ctrl+d":
			s.doctor()
			return root, nil
		}
	}
	return root, s.form.update(msg)
}

func (s *secretsPage) save() {
	v := s.form.values()
	vals, _ := envfile.Load(s.paths.JiraEnv)
	if vals == nil {
		vals = map[string]string{}
	}
	for _, k := range envfile.Vars {
		vals[k] = strings.TrimSpace(v[k])
	}
	if err := envfile.Write0600(s.paths.JiraEnv, vals); err != nil {
		s.form.err = err.Error()
		s.form.status = ""
		return
	}
	s.form.err = ""
	s.form.status = "saved mode " + envfile.ModeString(s.paths.JiraEnv)
	s.form.title = "Secrets  " + s.paths.JiraEnv + "  mode=" + envfile.ModeString(s.paths.JiraEnv)
}

func (s *secretsPage) awsLogin() {
	profile := strings.TrimSpace(s.form.values()["aws_profile"])
	if profile == "" {
		s.form.err = "set AWS profile first"
		return
	}
	cmd := exec.Command("aws", "sso", "login", "--profile", profile)
	out, err := cmd.CombinedOutput()
	if err != nil {
		s.form.err = fmt.Sprintf("aws sso login: %v\n%s", err, truncate(string(out), 400))
		s.form.status = ""
		return
	}
	s.form.err = ""
	s.form.status = "aws sso login ok for profile " + profile
}

func (s *secretsPage) doctor() {
	cmd := exec.Command("hablo-jira", "doctor")
	out, err := cmd.CombinedOutput()
	msg := strings.TrimSpace(string(out))
	if err != nil {
		s.form.err = fmt.Sprintf("doctor: %v\n%s", err, truncate(msg, 400))
		s.form.status = ""
		return
	}
	s.form.err = ""
	s.form.status = truncate(msg, 400)
}

func (s *secretsPage) view() string {
	body := s.form.view()
	return body + "\n" + helpStyle.Render("ctrl+a aws sso login · ctrl+d hablo-jira doctor")
}

func truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
