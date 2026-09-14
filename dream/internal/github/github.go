package github

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/bmelton/HABLO-installer/dream/internal/model"
)

// ReviewComments is the optional phase-2 source. It uses the already-authenticated gh CLI.
func ReviewComments(repo string, since time.Time) ([]model.Evidence, error) {
	cmd := exec.Command("gh", "api", "--paginate", "--slurp", fmt.Sprintf("repos/{owner}/{repo}/pulls/comments?per_page=100&since=%s", since.UTC().Format(time.RFC3339)))
	cmd.Dir = repo
	b, e := cmd.Output()
	if e != nil {
		return nil, e
	}
	type comment struct {
		ID       int64  `json:"id"`
		Body     string `json:"body"`
		Path     string `json:"path"`
		Created  string `json:"created_at"`
		CommitID string `json:"commit_id"`
		User     struct {
			Login string `json:"login"`
		} `json:"user"`
		Pull string `json:"pull_request_url"`
	}
	var pages [][]comment
	if e = json.Unmarshal(b, &pages); e != nil {
		return nil, e
	}
	var rows []comment
	for _, page := range pages {
		rows = append(rows, page...)
	}
	var out []model.Evidence
	authors := map[string]bool{}
	for _, r := range rows {
		agent, ok := authors[r.CommitID]
		if !ok {
			c := exec.Command("gh", "api", fmt.Sprintf("repos/{owner}/{repo}/commits/%s", r.CommitID))
			c.Dir = repo
			var commit struct {
				Author struct {
					Login string `json:"login"`
				} `json:"author"`
				Commit struct {
					Author struct {
						Name string `json:"name"`
					} `json:"author"`
					Message string `json:"message"`
				} `json:"commit"`
			}
			if raw, err := c.Output(); err == nil && json.Unmarshal(raw, &commit) == nil {
				identity := strings.ToLower(commit.Author.Login + " " + commit.Commit.Author.Name + " " + commit.Commit.Message)
				agent = strings.Contains(identity, "[bot]") || strings.Contains(identity, "hablo") || strings.Contains(identity, "firstmate") || strings.Contains(identity, "agent")
			}
			authors[r.CommitID] = agent
		}
		if !agent {
			continue
		}
		ts, _ := time.Parse(time.RFC3339, r.Created)
		parts := strings.Split(r.Pull, "/")
		pr := parts[len(parts)-1]
		id := fmt.Sprintf("gh:%s:%s:%d", filepathBase(repo), pr, r.ID)
		out = append(out, model.Evidence{ID: id, Key: id, Kind: "github-review", Source: r.Pull, Project: repo, Quote: r.Body, Target: r.Path, Timestamp: ts})
	}
	// A review requesting changes is useful even when it has no inline comment.
	list := exec.Command("gh", "api", "--paginate", "--slurp", "repos/{owner}/{repo}/pulls?state=all&sort=updated&direction=desc&per_page=100")
	list.Dir = repo
	if raw, err := list.Output(); err == nil {
		type pull struct {
			Number  int    `json:"number"`
			Updated string `json:"updated_at"`
			Head    struct {
				SHA string `json:"sha"`
			} `json:"head"`
			URL string `json:"html_url"`
		}
		var pullPages [][]pull
		if json.Unmarshal(raw, &pullPages) == nil {
			for _, page := range pullPages {
				for _, pr := range page {
					updated, _ := time.Parse(time.RFC3339, pr.Updated)
					if updated.Before(since) {
						continue
					}
					agent, ok := authors[pr.Head.SHA]
					if !ok {
						agent = agentCommit(repo, pr.Head.SHA)
						authors[pr.Head.SHA] = agent
					}
					if !agent {
						continue
					}
					reviews := exec.Command("gh", "api", fmt.Sprintf("repos/{owner}/{repo}/pulls/%d/reviews?per_page=100", pr.Number))
					reviews.Dir = repo
					var rr []struct {
						ID          int64 `json:"id"`
						Body, State string
						Submitted   string `json:"submitted_at"`
					}
					if rb, err := reviews.Output(); err == nil && json.Unmarshal(rb, &rr) == nil {
						for _, review := range rr {
							if review.State != "CHANGES_REQUESTED" {
								continue
							}
							ts, _ := time.Parse(time.RFC3339, review.Submitted)
							id := fmt.Sprintf("gh:%s:%d:%d", filepathBase(repo), pr.Number, review.ID)
							out = append(out, model.Evidence{ID: id, Key: id, Kind: "github-change-request", Source: pr.URL, Project: repo, Quote: review.Body, Timestamp: ts})
						}
					}
				}
			}
		}
	}
	return out, nil
}

func agentCommit(repo, sha string) bool {
	c := exec.Command("gh", "api", fmt.Sprintf("repos/{owner}/{repo}/commits/%s", sha))
	c.Dir = repo
	var commit struct {
		Author struct {
			Login string `json:"login"`
		} `json:"author"`
		Commit struct {
			Author struct {
				Name string `json:"name"`
			} `json:"author"`
			Message string `json:"message"`
		} `json:"commit"`
	}
	if raw, err := c.Output(); err == nil && json.Unmarshal(raw, &commit) == nil {
		identity := strings.ToLower(commit.Author.Login + " " + commit.Commit.Author.Name + " " + commit.Commit.Message)
		return strings.Contains(identity, "[bot]") || strings.Contains(identity, "hablo") || strings.Contains(identity, "firstmate") || strings.Contains(identity, "agent")
	}
	return false
}
func filepathBase(s string) string {
	p := strings.Split(strings.TrimRight(s, "/"), "/")
	return p[len(p)-1]
}
