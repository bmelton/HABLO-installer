package ccsession

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Turn struct {
	ID, Role, Text, Source, Project string
	Timestamp                       time.Time
}

func stringContent(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case []any:
		var b strings.Builder
		for _, part := range x {
			if m, ok := part.(map[string]any); ok {
				if t, ok := m["text"].(string); ok {
					if b.Len() > 0 {
						b.WriteByte('\n')
					}
					b.WriteString(t)
				}
			}
		}
		return b.String()
	}
	return ""
}

func readTranscript(path string) ([]Turn, error) {
	f, e := os.Open(path)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	var out []Turn
	s := bufio.NewScanner(f)
	s.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for s.Scan() {
		var m map[string]any
		if json.Unmarshal(s.Bytes(), &m) != nil {
			continue
		}
		role, _ := m["type"].(string)
		msg, _ := m["message"].(map[string]any)
		if r, ok := msg["role"].(string); ok {
			role = r
		}
		if role != "user" && role != "assistant" {
			continue
		}
		body := stringContent(msg["content"])
		if body == "" {
			body = stringContent(m["content"])
		}
		if body == "" {
			continue
		}
		ts, _ := time.Parse(time.RFC3339Nano, stringValue(m["timestamp"]))
		out = append(out, Turn{ID: stringValue(m["uuid"]), Role: role, Text: body, Source: path, Project: stringValue(m["cwd"]), Timestamp: ts})
	}
	return out, s.Err()
}
func stringValue(v any) string { s, _ := v.(string); return s }

func Walk(root string, since time.Time, projects []string) ([]Turn, []string, error) {
	var files, mem []string
	allowedSlug := map[string]bool{}
	for _, project := range projects {
		allowedSlug[strings.ReplaceAll(filepath.Clean(project), string(filepath.Separator), "-")] = true
	}
	allowedPath := func(project string) bool {
		if len(projects) == 0 {
			return true
		}
		for _, base := range projects {
			rel, err := filepath.Rel(base, project)
			if err == nil && (rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))) {
				return true
			}
		}
		return false
	}
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, e error) error {
		if e != nil {
			if os.IsNotExist(e) {
				return nil
			}
			return e
		}
		if d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		slug := strings.Split(rel, string(filepath.Separator))[0]
		if len(allowedSlug) > 0 && !allowedSlug[slug] {
			return nil
		}
		if strings.HasSuffix(p, ".jsonl") {
			files = append(files, p)
		} else if strings.Contains(p, string(filepath.Separator)+"memory"+string(filepath.Separator)) && strings.HasSuffix(p, ".md") {
			b, e := os.ReadFile(p)
			if e == nil {
				mem = append(mem, string(b))
			}
		}
		return nil
	})
	if err != nil && os.IsNotExist(err) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	sort.Strings(files)
	var out []Turn
	for _, p := range files {
		st, e := os.Stat(p)
		if e != nil || st.ModTime().Before(since) {
			continue
		}
		turns, e := readTranscript(p)
		if e != nil {
			return nil, nil, e
		}
		for _, t := range turns {
			if !t.Timestamp.IsZero() && t.Timestamp.Before(since) {
				continue
			}
			if t.Project != "" && !allowedPath(t.Project) {
				continue
			}
			out = append(out, t)
		}
	}
	return out, mem, nil
}
