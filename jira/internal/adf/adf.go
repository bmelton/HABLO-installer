package adf

import (
	"encoding/json"
	"fmt"
	"strings"
)

type Node struct {
	Type    string         `json:"type"`
	Text    string         `json:"text,omitempty"`
	Attrs   map[string]any `json:"attrs,omitempty"`
	Marks   []Mark         `json:"marks,omitempty"`
	Content []Node         `json:"content,omitempty"`
}
type Mark struct {
	Type  string         `json:"type"`
	Attrs map[string]any `json:"attrs,omitempty"`
}
type Document struct {
	Type    string `json:"type"`
	Version int    `json:"version"`
	Content []Node `json:"content"`
}

func Markdown(v any) string {
	b, _ := json.Marshal(v)
	var d Node
	if json.Unmarshal(b, &d) != nil {
		return ""
	}
	return strings.TrimSpace(render(d, 0))
}
func render(n Node, depth int) string {
	children := func() string {
		var b strings.Builder
		for _, c := range n.Content {
			b.WriteString(render(c, depth))
		}
		return b.String()
	}
	switch n.Type {
	case "doc":
		return children()
	case "text":
		t := n.Text
		for _, m := range n.Marks {
			switch m.Type {
			case "strong":
				t = "**" + t + "**"
			case "em":
				t = "*" + t + "*"
			case "code":
				t = "`" + t + "`"
			case "link":
				if h, ok := m.Attrs["href"].(string); ok {
					t = "[" + t + "](" + h + ")"
				}
			}
		}
		return t
	case "paragraph":
		return children() + "\n\n"
	case "hardBreak":
		return "  \n"
	case "heading":
		lvl := 2
		if x, ok := n.Attrs["level"].(float64); ok {
			lvl = int(x)
		}
		return strings.Repeat("#", lvl) + " " + children() + "\n\n"
	case "bulletList", "orderedList":
		var b strings.Builder
		for i, c := range n.Content {
			prefix := "- "
			if n.Type == "orderedList" {
				prefix = fmt.Sprintf("%d. ", i+1)
			}
			b.WriteString(strings.Repeat("  ", depth) + prefix + strings.TrimSpace(render(c, depth+1)) + "\n")
		}
		return b.String() + "\n"
	case "listItem":
		return children()
	case "codeBlock":
		lang, _ := n.Attrs["language"].(string)
		return "```" + lang + "\n" + children() + "\n```\n\n"
	case "blockquote":
		return "> " + strings.ReplaceAll(strings.TrimSpace(children()), "\n", "\n> ") + "\n\n"
	case "rule":
		return "---\n\n"
	case "inlineCard":
		if u, ok := n.Attrs["url"].(string); ok {
			return u
		}
		return children()
	case "mediaSingle":
		return children()
	case "table":
		var b strings.Builder
		for _, row := range n.Content {
			b.WriteString(render(row, depth))
		}
		return b.String() + "\n"
	case "tableRow":
		var cells []string
		for _, c := range n.Content {
			cells = append(cells, strings.TrimSpace(render(c, depth)))
		}
		return "| " + strings.Join(cells, " | ") + " |\n"
	case "tableCell", "tableHeader":
		return children()
	default:
		return children()
	}
}
func FromMarkdown(s string) Document {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	content := make([]Node, 0)
	var para []string
	flush := func() {
		if len(para) > 0 {
			content = append(content, Node{Type: "paragraph", Content: []Node{{Type: "text", Text: strings.Join(para, "\n")}}})
			para = nil
		}
	}
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			flush()
		} else {
			para = append(para, line)
		}
	}
	flush()
	if len(content) == 0 {
		content = []Node{{Type: "paragraph", Content: []Node{{Type: "text", Text: ""}}}}
	}
	return Document{Type: "doc", Version: 1, Content: content}
}
