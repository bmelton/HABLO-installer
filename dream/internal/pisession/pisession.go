package pisession

import (
	"bufio"
	"encoding/json"
	"fmt"
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
type entry struct {
	Type, ID, ParentID, Timestamp string
	Version                       int
	CWD, Summary                  string
	Message                       struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	} `json:"message"`
}

func text(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var parts []struct{ Type, Text string }
	if json.Unmarshal(raw, &parts) == nil {
		var b strings.Builder
		for _, p := range parts {
			if p.Type == "text" {
				if b.Len() > 0 {
					b.WriteByte('\n')
				}
				b.WriteString(p.Text)
			}
		}
		return b.String()
	}
	return ""
}

func ReadFile(path string) ([]Turn, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var all []entry
	cwd := ""
	scan := bufio.NewScanner(f)
	scan.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for scan.Scan() {
		var e entry
		if err := json.Unmarshal(scan.Bytes(), &e); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		if e.Type == "session" {
			if e.Version != 3 {
				return nil, fmt.Errorf("%s: unsupported Pi session version %d", path, e.Version)
			}
			cwd = e.CWD
			continue
		}
		all = append(all, e)
	}
	if err := scan.Err(); err != nil {
		return nil, err
	}
	if len(all) == 0 {
		return nil, nil
	}
	byID := map[string]entry{}
	for _, e := range all {
		if e.ID != "" {
			byID[e.ID] = e
		}
	}
	cur := all[len(all)-1]
	var branch []entry
	for {
		branch = append(branch, cur)
		if cur.Type == "compaction" || cur.ParentID == "" {
			break
		}
		p, ok := byID[cur.ParentID]
		if !ok {
			break
		}
		cur = p
	}
	for i, j := 0, len(branch)-1; i < j; i, j = i+1, j-1 {
		branch[i], branch[j] = branch[j], branch[i]
	}
	var out []Turn
	for _, e := range branch {
		if e.Type != "message" {
			continue
		}
		s := text(e.Message.Content)
		if s == "" {
			continue
		}
		ts, _ := time.Parse(time.RFC3339Nano, e.Timestamp)
		out = append(out, Turn{ID: e.ID, Role: e.Message.Role, Text: s, Source: path, Project: cwd, Timestamp: ts})
	}
	return out, nil
}

func Walk(root string, since time.Time, projects []string) ([]Turn, error) {
	allowed := func(p string) bool {
		if len(projects) == 0 {
			return true
		}
		for _, x := range projects {
			rel, e := filepath.Rel(x, p)
			if e == nil && (rel == "." || (!strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != "..")) {
				return true
			}
		}
		return false
	}
	var files []string
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, e error) error {
		if e != nil {
			if os.IsNotExist(e) {
				return nil
			}
			return e
		}
		if !d.IsDir() && strings.HasSuffix(d.Name(), ".jsonl") {
			files = append(files, p)
		}
		return nil
	})
	if err != nil && os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	var out []Turn
	for _, p := range files {
		st, e := os.Stat(p)
		if e != nil || st.ModTime().Before(since) {
			continue
		}
		turns, e := ReadFile(p)
		if e != nil {
			return nil, e
		}
		for _, t := range turns {
			if allowed(t.Project) && !t.Timestamp.Before(since) {
				out = append(out, t)
			}
		}
	}
	return out, nil
}
