package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/bmelton/hablo-installer/dream/internal/model"
)

func command(dir, name string, args ...string) (string, error) {
	c := exec.Command(name, args...)
	c.Dir = dir
	b, e := c.CombinedOutput()
	if e != nil {
		return string(b), fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), e, strings.TrimSpace(string(b)))
	}
	return string(b), nil
}
func validateTarget(p model.Proposal) (string, error) {
	repo, err := filepath.Abs(p.Target.Repo)
	if err != nil {
		return "", err
	}
	out, e := command(repo, "git", "rev-parse", "--show-toplevel")
	resolvedRepo, _ := filepath.EvalSymlinks(repo)
	resolvedTop, _ := filepath.EvalSymlinks(strings.TrimSpace(out))
	if e != nil || resolvedTop != resolvedRepo {
		return "", errors.New("proposal target is not the root of a git repository")
	}
	clean, e := command(repo, "git", "status", "--porcelain")
	if e != nil {
		return "", e
	}
	if strings.TrimSpace(clean) != "" {
		return "", errors.New("target repository has uncommitted changes")
	}
	file := filepath.Clean(p.Target.File)
	if filepath.IsAbs(file) || file == ".." || strings.HasPrefix(file, ".."+string(filepath.Separator)) {
		return "", errors.New("proposal file escapes repository")
	}
	if _, e = command(repo, "git", "ls-files", "--error-unmatch", "--", file); e != nil {
		return "", errors.New("proposal target is not a tracked file")
	}
	return filepath.Join(repo, file), nil
}
func merge(dst map[string]any, src map[string]any) {
	for k, v := range src {
		if sm, ok := v.(map[string]any); ok {
			dm, _ := dst[k].(map[string]any)
			if dm == nil {
				dm = map[string]any{}
				dst[k] = dm
			}
			merge(dm, sm)
		} else {
			dst[k] = v
		}
	}
}
func edit(p model.Proposal, old []byte) ([]byte, error) {
	switch p.Change.Kind {
	case "append-section":
		heading := strings.TrimSpace(p.Change.Heading)
		if heading == "" {
			return nil, errors.New("append-section needs heading")
		}
		return []byte(strings.TrimRight(string(old), "\n") + "\n\n## " + heading + "\n\n" + strings.TrimSpace(p.Change.Body) + "\n"), nil
	case "replace-section":
		heading := strings.TrimSpace(p.Change.Heading)
		if heading == "" {
			return nil, errors.New("replace-section needs heading")
		}
		lines := strings.Split(string(old), "\n")
		start, end := -1, len(lines)
		needle := "## " + heading
		for i, l := range lines {
			if strings.TrimSpace(l) == needle {
				start = i
				continue
			}
			if start >= 0 && i > start && strings.HasPrefix(l, "## ") {
				end = i
				break
			}
		}
		if start < 0 {
			return nil, fmt.Errorf("section %q not found", heading)
		}
		repl := []string{needle, "", strings.TrimSpace(p.Change.Body), ""}
		lines = append(lines[:start], append(repl, lines[end:]...)...)
		return []byte(strings.Join(lines, "\n")), nil
	case "json-merge":
		var doc map[string]any
		if e := json.Unmarshal(old, &doc); e != nil {
			return nil, e
		}
		merge(doc, p.Change.Values)
		b, e := json.MarshalIndent(doc, "", "  ")
		return append(b, '\n'), e
	case "add-task":
		return []byte(strings.TrimRight(string(old), "\n") + "\n" + strings.TrimSpace(p.Change.Body) + "\n"), nil
	case "manual":
		return nil, errors.New("manual proposals cannot be applied automatically")
	}
	return nil, errors.New("unsupported change kind")
}

func (a *App) Apply(ids []int) ([]string, error) {
	ps, e := a.Proposals()
	if e != nil {
		return nil, e
	}
	wanted := map[int]bool{}
	for _, id := range ids {
		wanted[id] = true
	}
	byRepo := map[string][]model.Proposal{}
	for _, p := range ps.Items {
		if wanted[p.ID] {
			byRepo[p.Target.Repo] = append(byRepo[p.Target.Repo], p)
			delete(wanted, p.ID)
		}
	}
	if len(wanted) > 0 {
		return nil, errors.New("one or more proposal ids were not found")
	}
	repos := make([]string, 0, len(byRepo))
	for r := range byRepo {
		repos = append(repos, r)
	}
	sort.Strings(repos)
	var urls []string
	for _, repo := range repos {
		items := byRepo[repo]
		prepared := map[string][]byte{}
		for _, p := range items {
			target, err := validateTarget(p)
			if err != nil {
				return urls, fmt.Errorf("proposal %d: %w", p.ID, err)
			}
			old, ok := prepared[target]
			if !ok {
				old, err = os.ReadFile(target)
				if err != nil {
					return urls, err
				}
			}
			next, err := edit(p, old)
			if err != nil {
				return urls, fmt.Errorf("proposal %d: %w", p.ID, err)
			}
			prepared[target] = next
		}
		branch := "dream/" + date(a.Now().UTC())
		if _, e = command(repo, "git", "switch", "-c", branch); e != nil {
			return urls, e
		}
		for target, next := range prepared {
			if e = os.WriteFile(target, next, 0644); e != nil {
				return urls, e
			}
		}
		files := []string{}
		evidence := []string{}
		titles := []string{}
		for _, p := range items {
			files = append(files, p.Target.File)
			evidence = append(evidence, p.Evidence...)
			titles = append(titles, p.Title)
		}
		args := append([]string{"add", "--"}, files...)
		if _, e = command(repo, "git", args...); e != nil {
			return urls, e
		}
		body := "HABLO Dream evidence:\n\n- " + strings.Join(evidence, "\n- ")
		if _, e = command(repo, "git", "commit", "-m", "dream: "+strings.Join(titles, "; "), "-m", body); e != nil {
			return urls, e
		}
		out, e := command(repo, "gh", "pr", "create", "--fill", "--body", body)
		if e != nil {
			return urls, e
		}
		urls = append(urls, strings.TrimSpace(out))
	}
	return urls, nil
}
func validateTrackedAfterSwitch(p model.Proposal) (string, error) {
	repo, e := filepath.Abs(p.Target.Repo)
	if e != nil {
		return "", e
	}
	file := filepath.Clean(p.Target.File)
	if _, e = command(repo, "git", "ls-files", "--error-unmatch", "--", file); e != nil {
		return "", errors.New("proposal target is not a tracked file")
	}
	return filepath.Join(repo, file), nil
}
