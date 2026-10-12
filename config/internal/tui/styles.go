package tui

import "github.com/charmbracelet/lipgloss"

var (
	titleStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("212"))
	bannerStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("214"))
	helpStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	okStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("42"))
	badStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("196"))
	focusStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("205"))
	errStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("196"))
	okMsgStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("42"))
)
