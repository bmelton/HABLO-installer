package tui

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/bmelton/HABLO-installer/config/internal/paths"
	"github.com/bmelton/HABLO-installer/config/internal/status"
)

type page int

const (
	pageHome page = iota
	pageJira
	pageSecrets
	pageSpy
	pageDream
	pageFirstmate
	pageCLI
	pageAgent
	pageInterrogate
)

var homeItems = []struct {
	key  string
	name string
}{
	{"1", "Jira"},
	{"2", "Secrets"},
	{"3", "Spy"},
	{"4", "Dream"},
	{"5", "Firstmate"},
	{"6", "CLI defaults"},
	{"7", "Agent"},
	{"8", "Interrogate"},
}

// Model is the root Bubble Tea model.
type Model struct {
	paths paths.Paths
	page  page
	home  int
	jira  *jiraPage
	sec   *secretsPage
	spy   *spyPage
	dream *dreamPage
	fm    *firstmatePage
	cli   *cliPage
	agent *agentPage
	iq    *interrogatePage
	width int
	err   string
}

// New creates the root model.
func New(p paths.Paths) Model {
	return Model{paths: p, page: pageHome}
}

func (m Model) Init() tea.Cmd { return nil }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
	case tea.KeyMsg:
		if msg.String() == "ctrl+c" {
			return m, tea.Quit
		}
		if m.page == pageHome {
			return m.updateHome(msg)
		}
		if msg.String() == "esc" {
			// Flush interrogate before leaving so the home chips match disk.
			if m.page == pageInterrogate && m.iq != nil {
				m.iq.save()
			}
			m.page = pageHome
			m.err = ""
			return m, nil
		}
	}

	switch m.page {
	case pageJira:
		return m.jira.update(msg, &m)
	case pageSecrets:
		return m.sec.update(msg, &m)
	case pageSpy:
		return m.spy.update(msg, &m)
	case pageDream:
		return m.dream.update(msg, &m)
	case pageFirstmate:
		return m.fm.update(msg, &m)
	case pageCLI:
		return m.cli.update(msg, &m)
	case pageAgent:
		return m.agent.update(msg, &m)
	case pageInterrogate:
		return m.iq.update(msg, &m)
	}
	return m, nil
}

func (m Model) updateHome(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q", "esc":
		return m, tea.Quit
	case "up", "k":
		if m.home > 0 {
			m.home--
		}
	case "down", "j":
		if m.home < len(homeItems)-1 {
			m.home++
		}
	case "enter", " ":
		return m.openPage(homeItems[m.home].key)
	default:
		return m.openPage(msg.String())
	}
	return m, nil
}

func (m Model) openPage(key string) (tea.Model, tea.Cmd) {
	switch key {
	case "1":
		m.page = pageJira
		m.jira = newJiraPage(m.paths)
	case "2":
		m.page = pageSecrets
		m.sec = newSecretsPage(m.paths)
	case "3":
		m.page = pageSpy
		m.spy = newSpyPage(m.paths)
	case "4":
		m.page = pageDream
		m.dream = newDreamPage(m.paths)
	case "5":
		m.page = pageFirstmate
		m.fm = newFirstmatePage(m.paths)
	case "6":
		m.page = pageCLI
		m.cli = newCLIPage(m.paths)
	case "7":
		m.page = pageAgent
		m.agent = newAgentPage(m.paths)
	case "8":
		m.page = pageInterrogate
		m.iq = newInterrogatePage(m.paths)
	default:
		return m, nil
	}
	return m, nil
}

func (m Model) View() string {
	switch m.page {
	case pageJira:
		return m.jira.view()
	case pageSecrets:
		return m.sec.view()
	case pageSpy:
		return m.spy.view()
	case pageDream:
		return m.dream.view()
	case pageFirstmate:
		return m.fm.view()
	case pageCLI:
		return m.cli.view()
	case pageAgent:
		return m.agent.view()
	case pageInterrogate:
		return m.iq.view()
	default:
		return m.viewHome()
	}
}

func (m Model) viewHome() string {
	var b strings.Builder
	b.WriteString(titleStyle.Render("hablo-config") + "\n")
	b.WriteString(bannerStyle.Render("Runtime files; next install may overwrite JSON.") + "\n")
	b.WriteString(bannerStyle.Render("No bedrouter stack/routing editor here.") + "\n\n")

	for _, c := range status.Collect(m.paths) {
		style := okStyle
		mark := "ok"
		if !c.OK {
			style = badStyle
			mark = "!!"
		}
		fmt.Fprintf(&b, "  %s\n", style.Render(fmt.Sprintf("[%s] %-10s %s", mark, c.Name, c.Value)))
	}
	b.WriteString("\n")
	for i, item := range homeItems {
		line := fmt.Sprintf("%s  %s", item.key, item.name)
		if i == m.home {
			line = focusStyle.Render("> " + line)
		} else {
			line = "  " + line
		}
		b.WriteString(line + "\n")
	}
	b.WriteString("\n" + helpStyle.Render("↑↓/j k move · enter open · 1-8 jump · q quit"))
	if m.err != "" {
		b.WriteString("\n" + errStyle.Render(m.err))
	}
	return b.String()
}

// Run starts the interactive TUI.
func Run(p paths.Paths) error {
	_, err := tea.NewProgram(New(p), tea.WithAltScreen()).Run()
	return err
}
