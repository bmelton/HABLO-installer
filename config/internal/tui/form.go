package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
)

// enumOpt is one allowed value for an enum field. Empty Value is allowed (e.g. backend auto).
type enumOpt struct {
	Value string
	Label string // shown in the UI; defaults to Value or "(auto)" when Value is empty
}

func (o enumOpt) display() string {
	if o.Label != "" {
		return o.Label
	}
	if o.Value == "" {
		return "(auto)"
	}
	return o.Value
}

type formField struct {
	label   string
	key     string
	input   textinput.Model
	bool    bool      // space toggles true/false; no free typing
	options []enumOpt // when set, left/right/space cycle; no free typing
	enumIdx int
}

func newInput(placeholder, value string, password bool) textinput.Model {
	ti := textinput.New()
	ti.Placeholder = placeholder
	ti.SetValue(value)
	ti.CharLimit = 4096
	ti.Width = 56
	if password {
		ti.EchoMode = textinput.EchoPassword
		ti.EchoCharacter = '•'
	}
	return ti
}

func newEnumField(label, key, value string, opts []enumOpt) formField {
	idx := 0
	found := false
	for i, o := range opts {
		if o.Value == value {
			idx = i
			found = true
			break
		}
	}
	f := formField{
		label:   label,
		key:     key,
		input:   newInput("", opts[idx].Value, false),
		options: opts,
		enumIdx: idx,
	}
	if !found && value != "" {
		// Unknown on-disk value: keep it visible until the user cycles to a valid option.
		f.input.SetValue(value)
		f.enumIdx = -1
	}
	return f
}

func newBoolField(label, key string, value bool) formField {
	return formField{
		label: label,
		key:   key,
		input: newInput("true|false", fmt.Sprint(value), false),
		bool:  true,
	}
}

type formModel struct {
	title  string
	fields []formField
	focus  int
	status string
	err    string
	width  int
}

func (f *formModel) initFocus() {
	for i := range f.fields {
		f.fields[i].input.Blur()
	}
	if len(f.fields) > 0 {
		f.focusEditable()
		f.focus = 0
		f.focusEditable()
	}
}

func (f *formModel) focusEditable() {
	if len(f.fields) == 0 {
		return
	}
	field := &f.fields[f.focus]
	if field.bool || len(field.options) > 0 {
		field.input.Blur()
		return
	}
	field.input.Focus()
}

func (f *formModel) update(msg tea.Msg) tea.Cmd {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		f.width = msg.Width
	case tea.KeyMsg:
		if len(f.fields) == 0 {
			return nil
		}
		field := &f.fields[f.focus]
		switch msg.String() {
		case "tab", "down":
			f.next(1)
			return nil
		case "shift+tab", "up":
			f.next(-1)
			return nil
		case " ", "enter", "right", "l":
			if field.bool {
				f.toggleBool(field)
				return nil
			}
			if len(field.options) > 0 {
				f.cycleEnum(field, 1)
				return nil
			}
		case "left", "h":
			if len(field.options) > 0 {
				f.cycleEnum(field, -1)
				return nil
			}
		}
		// Bool/enum fields reject free typing entirely.
		if field.bool || len(field.options) > 0 {
			return nil
		}
	}
	if len(f.fields) == 0 {
		return nil
	}
	var cmd tea.Cmd
	f.fields[f.focus].input, cmd = f.fields[f.focus].input.Update(msg)
	return cmd
}

func (f *formModel) toggleBool(field *formField) {
	if parseBool(field.input.Value()) {
		field.input.SetValue("false")
	} else {
		field.input.SetValue("true")
	}
}

func (f *formModel) cycleEnum(field *formField, delta int) {
	if len(field.options) == 0 {
		return
	}
	if field.enumIdx < 0 {
		field.enumIdx = 0
	} else {
		field.enumIdx = (field.enumIdx + delta + len(field.options)) % len(field.options)
	}
	field.input.SetValue(field.options[field.enumIdx].Value)
}

func (f *formModel) next(delta int) {
	if len(f.fields) == 0 {
		return
	}
	f.fields[f.focus].input.Blur()
	f.focus = (f.focus + delta + len(f.fields)) % len(f.fields)
	f.focusEditable()
}

func (f *formModel) values() map[string]string {
	out := map[string]string{}
	for _, field := range f.fields {
		out[field.key] = field.input.Value()
	}
	return out
}

// validateEnums returns an error if any enum field holds a value outside its options.
func (f *formModel) validateEnums() error {
	for _, field := range f.fields {
		if len(field.options) == 0 {
			continue
		}
		v := field.input.Value()
		ok := false
		var allowed []string
		for _, o := range field.options {
			allowed = append(allowed, o.display())
			if o.Value == v {
				ok = true
				break
			}
		}
		if !ok {
			return fmt.Errorf("%s: %q is not allowed (choose %s)", field.label, v, strings.Join(allowed, "|"))
		}
	}
	return nil
}

func (f *formModel) view() string {
	var b strings.Builder
	b.WriteString(titleStyle.Render(f.title) + "\n\n")
	for i, field := range f.fields {
		label := field.label
		if i == f.focus {
			label = focusStyle.Render("> " + label)
		} else {
			label = "  " + label
		}
		b.WriteString(label + "\n")
		b.WriteString("    " + fieldView(field, i == f.focus) + "\n")
	}
	b.WriteString("\n")
	if f.err != "" {
		b.WriteString(errStyle.Render(f.err) + "\n")
	}
	if f.status != "" {
		b.WriteString(okMsgStyle.Render(f.status) + "\n")
	}
	b.WriteString(helpStyle.Render("tab/↑↓ fields · ←→/space cycle enums · ctrl+s save · esc back"))
	return b.String()
}

func fieldView(field formField, focused bool) string {
	if len(field.options) > 0 {
		parts := make([]string, 0, len(field.options))
		cur := field.input.Value()
		for i, o := range field.options {
			label := o.display()
			if o.Value == cur || (field.enumIdx == i && cur == o.Value) {
				if focused {
					parts = append(parts, focusStyle.Render("["+label+"]"))
				} else {
					parts = append(parts, "["+label+"]")
				}
			} else {
				parts = append(parts, label)
			}
		}
		line := strings.Join(parts, "  ")
		if field.enumIdx < 0 {
			line += "  " + errStyle.Render(fmt.Sprintf("(current %q invalid — cycle to fix)", cur))
		}
		return line
	}
	if field.bool {
		on := parseBool(field.input.Value())
		if focused {
			if on {
				return focusStyle.Render("[true]") + "  false"
			}
			return "true  " + focusStyle.Render("[false]")
		}
		if on {
			return "[true]  false"
		}
		return "true  [false]"
	}
	return field.input.View()
}

func parseBool(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}
