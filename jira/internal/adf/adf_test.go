package adf

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMarkdown(t *testing.T) {
	d := Document{Type: "doc", Version: 1, Content: []Node{
		{Type: "heading", Attrs: map[string]any{"level": float64(2)}, Content: []Node{{Type: "text", Text: "Title"}}},
		{Type: "paragraph", Content: []Node{{Type: "text", Text: "linked", Marks: []Mark{{Type: "link", Attrs: map[string]any{"href": "https://example.com"}}}}}},
	}}
	got := Markdown(d)
	if !strings.Contains(got, "## Title") || !strings.Contains(got, "[linked](https://example.com)") {
		t.Fatalf("unexpected markdown: %q", got)
	}
}

func TestGolden(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "testdata", "adf", "basic.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc any
	if err = json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(filepath.Join("..", "..", "testdata", "adf", "basic.md"))
	if err != nil {
		t.Fatal(err)
	}
	if got := Markdown(doc); got != strings.TrimSpace(string(want)) {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}
func TestFromMarkdown(t *testing.T) {
	d := FromMarkdown("one\n\ntwo")
	if d.Type != "doc" || d.Version != 1 || len(d.Content) != 2 {
		t.Fatalf("unexpected document: %#v", d)
	}
}
