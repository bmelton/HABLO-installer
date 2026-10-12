package tui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestEnumRejectsFreeTextAndCycles(t *testing.T) {
	f := formModel{
		fields: []formField{
			newEnumField("crew-harness", "crew-harness", "pi", []enumOpt{
				{Value: "pi"},
				{Value: "claude"},
			}),
		},
	}
	f.initFocus()
	// Typing "banana" must not change the value.
	f.update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("banana")})
	if f.values()["crew-harness"] != "pi" {
		t.Fatalf("got %q after typing", f.values()["crew-harness"])
	}
	f.update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(" ")})
	if f.values()["crew-harness"] != "claude" {
		t.Fatalf("space cycle: got %q", f.values()["crew-harness"])
	}
	if err := f.validateEnums(); err != nil {
		t.Fatal(err)
	}
}

func TestEnumValidateRejectsInvalidCurrent(t *testing.T) {
	f := formModel{
		fields: []formField{
			newEnumField("backend", "backend", "banana", []enumOpt{
				{Value: "", Label: "auto"},
				{Value: "tmux"},
				{Value: "herdr"},
			}),
		},
	}
	if err := f.validateEnums(); err == nil {
		t.Fatal("expected validation error for banana")
	}
	f.update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(" ")})
	if err := f.validateEnums(); err != nil {
		t.Fatal(err)
	}
	if v := f.values()["backend"]; v != "" && v != "tmux" && v != "herdr" {
		t.Fatalf("unexpected %q", v)
	}
}

func TestBoolRejectsFreeText(t *testing.T) {
	f := formModel{fields: []formField{newBoolField("enabled", "enabled", true)}}
	f.initFocus()
	f.update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("nope")})
	if f.values()["enabled"] != "true" {
		t.Fatalf("got %q", f.values()["enabled"])
	}
	f.update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(" ")})
	if f.values()["enabled"] != "false" {
		t.Fatalf("got %q", f.values()["enabled"])
	}
}
