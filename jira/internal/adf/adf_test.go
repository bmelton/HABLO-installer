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

func TestFromMarkdownStructure(t *testing.T) {
	d := FromMarkdown("## Background / Context\n\nWhy this exists.\n\n## Acceptance Criteria\n\n- first\n- second\n\ntrailing text\n")
	types := []string{}
	for _, n := range d.Content {
		types = append(types, n.Type)
	}
	want := []string{"heading", "paragraph", "heading", "bulletList", "paragraph"}
	if len(types) != len(want) {
		t.Fatalf("node types = %v, want %v", types, want)
	}
	for i := range want {
		if types[i] != want[i] {
			t.Fatalf("node types = %v, want %v", types, want)
		}
	}
	if lvl := d.Content[0].Attrs["level"]; lvl != 2 {
		t.Fatalf("heading level = %v, want 2", lvl)
	}
	if got := d.Content[0].Content[0].Text; got != "Background / Context" {
		t.Fatalf("heading text = %q", got)
	}
	if n := len(d.Content[3].Content); n != 2 {
		t.Fatalf("bulletList items = %d, want 2", n)
	}
	if got := d.Content[3].Content[0].Content[0].Content[0].Text; got != "first" {
		t.Fatalf("first item = %q", got)
	}
}

func TestFromMarkdownNonHeadings(t *testing.T) {
	// "#hashtag" has no space and "####### x" is seven deep; both are body text in Markdown, not headings.
	for _, s := range []string{"#hashtag", "####### too deep", "a - b"} {
		d := FromMarkdown(s)
		if d.Content[0].Type != "paragraph" {
			t.Fatalf("%q became %s, want paragraph", s, d.Content[0].Type)
		}
	}
}

func TestFromMarkdownRoundTrip(t *testing.T) {
	src := "## Acceptance Criteria\n\n- one\n- two"
	if got := Markdown(FromMarkdown(src)); got != src {
		t.Fatalf("round trip = %q, want %q", got, src)
	}
}
