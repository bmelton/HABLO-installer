package signal

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/bmelton/HABLO-installer/dream/internal/cluster"
	"github.com/bmelton/HABLO-installer/dream/internal/model"
)

type Turn struct {
	ID, Role, Text, Source, Project string
	Timestamp                       time.Time
}

func short(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:8]) }
func evidenceID(prefix string, t Turn) string {
	if t.ID != "" {
		return prefix + ":" + t.ID
	}
	return prefix + ":" + short(t.Source+t.Timestamp.String()+t.Text)
}

func GuardLog(path string, since time.Time) ([]model.Evidence, error) {
	f, e := os.Open(path)
	if os.IsNotExist(e) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	defer f.Close()
	var out []model.Evidence
	s := bufio.NewScanner(f)
	s.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for s.Scan() {
		var m map[string]any
		if json.Unmarshal(s.Bytes(), &m) != nil {
			continue
		}
		ts, _ := time.Parse(time.RFC3339Nano, str(m, "timestamp", "at", "time"))
		if !ts.IsZero() && ts.Before(since) {
			continue
		}
		verdict := str(m, "verdict", "result")
		kind := ""
		key := ""
		rule := str(m, "rule", "ruleId", "checkId")
		target := str(m, "target", "path", "file")
		if verdict == "deny" {
			kind = "guard-denial"
			key = "guard:" + rule + ":" + target
		} else if verdict == "fail" || boolv(m, "dropped") || boolv(m, "failed") {
			kind = "check-failure"
			ext := ""
			if i := strings.LastIndex(target, "."); i >= 0 {
				ext = target[i:]
			}
			key = "check:" + rule + ":" + ext
		} else {
			continue
		}
		id := str(m, "id")
		if id == "" {
			id = short(string(s.Bytes()))
		}
		out = append(out, model.Evidence{ID: "guard:" + id, Key: key, Kind: kind, Source: path, Project: str(m, "project", "cwd"), Quote: str(m, "reason", "message"), Target: target, Rule: rule, Timestamp: ts})
	}
	return out, s.Err()
}
func str(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if s, ok := m[k].(string); ok {
			return s
		}
	}
	return ""
}
func boolv(m map[string]any, k string) bool { b, _ := m[k].(bool); return b }

func Corrections(turns []Turn, openers []string) []model.Evidence {
	var out []model.Evidence
	for i, t := range turns {
		if t.Role != "user" {
			continue
		}
		low := strings.ToLower(strings.TrimSpace(t.Text))
		matched := ""
		for _, o := range openers {
			if low == strings.ToLower(o) || strings.HasPrefix(low, strings.ToLower(o)+" ") || strings.HasPrefix(low, strings.ToLower(o)+",") || strings.HasPrefix(low, strings.ToLower(o)+".") {
				matched = o
				break
			}
		}
		if matched == "" {
			continue
		}
		prior := ""
		for j := i - 1; j >= 0; j-- {
			if turns[j].Source != t.Source {
				break
			}
			if turns[j].Role == "assistant" {
				prior = turns[j].Text
				break
			}
		}
		quote := t.Text
		if prior != "" {
			quote = "Correction: " + t.Text + "\nPrior response: " + prior
		}
		out = append(out, model.Evidence{ID: evidenceID("session", t), Key: "text:" + cluster.TextKey(t.Text), Kind: "human-correction", Source: t.Source, Project: t.Project, Quote: quote, Timestamp: t.Timestamp})
	}
	return out
}

var commandLine = regexp.MustCompile("(?m)(?:^|\\$ |```(?:bash|sh)?\\n)([A-Za-z0-9_./-]+(?:\\s+[^\\n]+)?)")

func FailureLoops(turns []Turn) []model.Evidence {
	counts := map[string][]Turn{}
	for _, t := range turns {
		if t.Role != "toolResult" && t.Role != "user" {
			continue
		}
		low := strings.ToLower(t.Text)
		if !strings.Contains(low, "error") && !strings.Contains(low, "failed") && !strings.Contains(low, "exit code") && !strings.Contains(low, "status 1") {
			continue
		}
		head := "unknown"
		if m := commandLine.FindStringSubmatch(t.Text); len(m) > 1 {
			head = strings.Fields(m[1])[0]
		}
		counts[t.Source+"\x00"+head] = append(counts[t.Source+"\x00"+head], t)
	}
	var out []model.Evidence
	for compound, items := range counts {
		if len(items) < 3 {
			continue
		}
		t := items[len(items)-1]
		head := strings.SplitN(compound, "\x00", 2)[1]
		out = append(out, model.Evidence{ID: evidenceID("loop", t), Key: "loop:" + head, Kind: "failure-loop", Source: t.Source, Project: t.Project, Quote: fmt.Sprintf("%s failed %d times in one session", head, len(items)), Timestamp: t.Timestamp})
	}
	return out
}

func RuleCollisions(turns []Turn, rules map[string][]string) []model.Evidence {
	var out []model.Evidence
	for file, lines := range rules {
		for n, line := range lines {
			low := strings.ToLower(line)
			if !strings.Contains(low, "never") && !strings.Contains(low, "do not") && !strings.Contains(low, "don't") {
				continue
			}
			tokens := strings.Fields(cluster.TextKey(line))
			for _, t := range turns {
				if t.Role != "assistant" {
					continue
				}
				action := strings.ToLower(t.Text)
				if !strings.Contains(action, "edit") && !strings.Contains(action, "wrote") && !strings.Contains(action, "write") && !strings.Contains(action, "changed") && !strings.Contains(action, "delete") && !strings.Contains(action, "remove") && !strings.Contains(action, "ran ") {
					continue
				}
				body := " " + cluster.TextKey(t.Text) + " "
				hits := 0
				meaningful := 0
				for _, tok := range tokens {
					if len(tok) > 3 {
						meaningful++
						if strings.Contains(body, " "+tok+" ") {
							hits++
						}
					}
				}
				if hits >= 4 && hits*2 >= meaningful {
					out = append(out, model.Evidence{ID: evidenceID("rule", t), Key: fmt.Sprintf("rule:%s:%d", file, n+1), Kind: "rule-collision", Source: t.Source, Project: t.Project, Quote: t.Text, Target: file, Rule: line, Timestamp: t.Timestamp})
					break
				}
			}
		}
	}
	return out
}

func Sort(in []model.Evidence) {
	sort.Slice(in, func(i, j int) bool {
		if in[i].Key != in[j].Key {
			return in[i].Key < in[j].Key
		}
		return in[i].ID < in[j].ID
	})
}
