package tui

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/bmelton/HABLO-installer/config/internal/paths"
)

type spyPage struct {
	paths    paths.Paths
	list     string
	body     string
	keyInput textinput.Model
	vp       viewport.Model
	follow   bool
	status   string
	err      string
}

type spyTickMsg time.Time

func newSpyPage(p paths.Paths) *spyPage {
	ti := textinput.New()
	ti.Placeholder = "ORIGINOPS-1234"
	ti.Width = 24
	ti.CharLimit = 32
	ti.Focus()
	sp := &spyPage{
		paths:    p,
		keyInput: ti,
		vp:       viewport.New(80, 16),
	}
	sp.refreshList()
	return sp
}

func (s *spyPage) refreshList() {
	cmd := exec.Command("hablo-jira-agent", "spy")
	out, err := cmd.CombinedOutput()
	if err != nil {
		// Fall back to listing runs dir so the page works without the binary in odd PATH cases.
		s.list = listRunsDir(filepath.Join(s.paths.JiraHome, "runs"))
		if s.list == "" {
			s.err = fmt.Sprintf("spy list: %v\n%s", err, string(out))
		}
		return
	}
	s.err = ""
	s.list = strings.TrimSpace(string(out))
}

func listRunsDir(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	var b strings.Builder
	for _, e := range entries {
		if e.IsDir() {
			fmt.Fprintf(&b, "%s\n", e.Name())
		}
	}
	if b.Len() == 0 {
		return "no runs recorded"
	}
	return b.String()
}

func (s *spyPage) loadKey() {
	key := strings.TrimSpace(s.keyInput.Value())
	if key == "" {
		s.refreshList()
		s.body = ""
		s.status = "listing runs"
		return
	}
	args := []string{"spy", "--key", key, "--lines", "80"}
	cmd := exec.Command("hablo-jira-agent", args...)
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(out))
	if err != nil {
		s.err = fmt.Sprintf("%v\n%s", err, text)
		s.body = ""
		return
	}
	s.err = ""
	s.body = text
	s.vp.SetContent(text)
	s.status = "showing " + key
}

func (s *spyPage) update(msg tea.Msg, root *Model) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		s.vp.Width = msg.Width - 2
		s.vp.Height = msg.Height - 12
		if s.vp.Height < 5 {
			s.vp.Height = 5
		}
	case spyTickMsg:
		if s.follow {
			s.loadKey()
			return root, tickSpy()
		}
	case tea.KeyMsg:
		switch msg.String() {
		case "esc":
			root.page = pageHome
			return root, nil
		case "r":
			s.loadKey()
			return root, nil
		case "l":
			s.keyInput.SetValue("")
			s.refreshList()
			s.body = ""
			s.follow = false
			s.status = "listing runs"
			return root, nil
		case "f":
			s.follow = !s.follow
			if s.follow {
				s.status = "follow on"
				s.loadKey()
				return root, tickSpy()
			}
			s.status = "follow off"
			return root, nil
		case "enter":
			s.follow = false
			s.loadKey()
			return root, nil
		case "q":
			return root, tea.Quit
		}
	}
	var cmd tea.Cmd
	s.keyInput, cmd = s.keyInput.Update(msg)
	s.vp, _ = s.vp.Update(msg)
	return root, cmd
}

func tickSpy() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg { return spyTickMsg(t) })
}

func (s *spyPage) view() string {
	var b strings.Builder
	b.WriteString(titleStyle.Render("Spy  (hablo-jira-agent spy)") + "\n\n")
	b.WriteString("key: " + s.keyInput.View() + "\n\n")
	if s.list != "" && s.body == "" {
		b.WriteString("runs:\n" + s.list + "\n\n")
	}
	if s.body != "" {
		b.WriteString(s.vp.View() + "\n")
	}
	if s.err != "" {
		b.WriteString(errStyle.Render(s.err) + "\n")
	}
	if s.status != "" {
		b.WriteString(okMsgStyle.Render(s.status) + "\n")
	}
	b.WriteString(helpStyle.Render("enter load · r refresh · l list · f follow · esc back · q quit"))
	return b.String()
}
