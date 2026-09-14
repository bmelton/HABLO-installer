package jira

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/bmelton/HABLO-installer/jira/internal/adf"
)

type Client struct {
	BaseURL, Email, Token string
	HTTP                  *http.Client
	DryRun                bool
	Out                   io.Writer
}
type User struct {
	AccountID    string `json:"accountId"`
	DisplayName  string `json:"displayName"`
	EmailAddress string `json:"emailAddress"`
}
type Issue struct {
	ID, Key string
	Fields  Fields `json:"fields"`
}
type Fields struct {
	Summary     string   `json:"summary"`
	Description any      `json:"description"`
	IssueType   Named    `json:"issuetype"`
	Priority    Named    `json:"priority"`
	Status      Named    `json:"status"`
	Labels      []string `json:"labels"`
	Reporter    User     `json:"reporter"`
	Comments    struct {
		Comments []Comment `json:"comments"`
	} `json:"comment"`
}
type Named struct {
	ID, Name       string
	StatusCategory struct{ Key, Name string } `json:"statusCategory"`
}
type Comment struct {
	ID      string `json:"id"`
	Body    any    `json:"body"`
	Author  User   `json:"author"`
	Created string `json:"created"`
}
type Transition struct {
	ID, Name string
	To       Named `json:"to"`
}

func (c *Client) request(ctx context.Context, method, p string, body any, out any, retry bool) error {
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	if c.DryRun && method != http.MethodGet && p != "/rest/api/3/search/jql" {
		fmt.Fprintf(c.Out, "%s %s\n%s\n", method, p, raw)
		return nil
	}
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.BaseURL, "/")+p, bytes.NewReader(raw))
		if err != nil {
			return err
		}
		req.Header.Set("Accept", "application/json")
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(c.Email+":"+c.Token)))
		h := c.HTTP
		if h == nil {
			h = &http.Client{Timeout: 30 * time.Second}
		}
		resp, err := h.Do(req)
		if err != nil {
			return err
		}
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
		resp.Body.Close()
		if resp.StatusCode == 429 && retry && attempt == 0 {
			sec, _ := strconv.Atoi(resp.Header.Get("Retry-After"))
			if sec < 1 {
				sec = 1
			}
			if sec > 30 {
				sec = 30
			}
			time.Sleep(time.Duration(sec) * time.Second)
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("jira %s %s: HTTP %d: %s", method, p, resp.StatusCode, strings.TrimSpace(string(b)))
		}
		if out != nil && len(b) > 0 {
			if err := json.Unmarshal(b, out); err != nil {
				return err
			}
		}
		return nil
	}
}
func (c *Client) Myself(ctx context.Context) (User, error) {
	var x User
	e := c.request(ctx, "GET", "/rest/api/3/myself", nil, &x, false)
	return x, e
}
func (c *Client) Read(ctx context.Context, key string) (Issue, error) {
	var x Issue
	e := c.request(ctx, "GET", "/rest/api/3/issue/"+url.PathEscape(key)+"?fields=summary,description,issuetype,priority,status,labels,reporter,comment", nil, &x, false)
	return x, e
}
func (c *Client) Search(ctx context.Context, jql string, limit int) ([]Issue, error) {
	var all []Issue
	token := ""
	for len(all) < limit {
		var x struct {
			Issues []Issue `json:"issues"`
			Next   string  `json:"nextPageToken"`
			IsLast bool    `json:"isLast"`
		}
		n := limit - len(all)
		if n > 100 {
			n = 100
		}
		body := map[string]any{"jql": jql, "maxResults": n, "fields": []string{"summary", "description", "issuetype", "priority", "status", "labels", "reporter", "comment"}}
		if token != "" {
			body["nextPageToken"] = token
		}
		if e := c.request(ctx, "POST", "/rest/api/3/search/jql", body, &x, false); e != nil {
			return nil, e
		}
		all = append(all, x.Issues...)
		if x.IsLast || x.Next == "" || len(x.Issues) == 0 {
			break
		}
		token = x.Next
	}
	return all, nil
}
func (c *Client) RecentComments(ctx context.Context, key string, n int) ([]Comment, error) {
	var x struct {
		Comments []Comment `json:"comments"`
	}
	p := fmt.Sprintf("/rest/api/3/issue/%s/comment?orderBy=-created&maxResults=%d", url.PathEscape(key), n)
	e := c.request(ctx, "GET", p, nil, &x, false)
	return x.Comments, e
}
func (c *Client) AddComment(ctx context.Context, key, text string) error {
	return c.request(ctx, "POST", "/rest/api/3/issue/"+url.PathEscape(key)+"/comment", map[string]any{"body": adf.FromMarkdown(text)}, nil, true)
}
func (c *Client) Transitions(ctx context.Context, key string) ([]Transition, error) {
	var x struct {
		Transitions []Transition `json:"transitions"`
	}
	e := c.request(ctx, "GET", "/rest/api/3/issue/"+url.PathEscape(key)+"/transitions", nil, &x, false)
	return x.Transitions, e
}
func (c *Client) Transition(ctx context.Context, key, id string) error {
	return c.request(ctx, "POST", "/rest/api/3/issue/"+url.PathEscape(key)+"/transitions", map[string]any{"transition": map[string]string{"id": id}}, nil, true)
}
func (c *Client) UpdateLabels(ctx context.Context, key string, remove, add []string) error {
	var ops []map[string]string
	for _, x := range remove {
		ops = append(ops, map[string]string{"remove": x})
	}
	for _, x := range add {
		ops = append(ops, map[string]string{"add": x})
	}
	return c.request(ctx, "PUT", "/rest/api/3/issue/"+url.PathEscape(key), map[string]any{"update": map[string]any{"labels": ops}}, nil, true)
}

// CreateIssue opens an issue and returns its key. Assignee is set in the same call so the issue is never briefly
// visible unassigned, which the dispatch JQL would skip.
func (c *Client) CreateIssue(ctx context.Context, project, summary, description, issueType, assigneeID string, labels []string) (string, error) {
	fields := map[string]any{
		"project":   map[string]string{"key": project},
		"summary":   summary,
		"issuetype": map[string]string{"name": issueType},
	}
	if strings.TrimSpace(description) != "" {
		fields["description"] = adf.FromMarkdown(description)
	}
	if assigneeID != "" {
		fields["assignee"] = map[string]string{"accountId": assigneeID}
	}
	if len(labels) > 0 {
		fields["labels"] = labels
	}
	var x struct {
		Key string `json:"key"`
	}
	e := c.request(ctx, "POST", "/rest/api/3/issue", map[string]any{"fields": fields}, &x, true)
	return x.Key, e
}

type Board struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}
type Sprint struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	State string `json:"state"`
}

// BoardForProject returns the project's first scrum board. A project with only a kanban board has no sprints at all,
// so the caller is told which it is rather than being handed a board that cannot hold one.
func (c *Client) BoardForProject(ctx context.Context, project string) (Board, error) {
	var x struct {
		Values []Board `json:"values"`
	}
	if e := c.request(ctx, "GET", "/rest/agile/1.0/board?projectKeyOrId="+url.QueryEscape(project), nil, &x, false); e != nil {
		return Board{}, e
	}
	for _, b := range x.Values {
		if strings.EqualFold(b.Type, "scrum") {
			return b, nil
		}
	}
	return Board{}, fmt.Errorf("no scrum board for project %s", project)
}

// Sprints lists the board's active and future sprints, oldest first. Closed sprints are excluded: nothing should be
// scheduled into one.
func (c *Client) Sprints(ctx context.Context, boardID int) ([]Sprint, error) {
	var x struct {
		Values []Sprint `json:"values"`
	}
	e := c.request(ctx, "GET", fmt.Sprintf("/rest/agile/1.0/board/%d/sprint?state=active,future", boardID), nil, &x, false)
	return x.Values, e
}
func (c *Client) CreateSprint(ctx context.Context, boardID int, name string) (Sprint, error) {
	var x Sprint
	e := c.request(ctx, "POST", "/rest/agile/1.0/sprint", map[string]any{"name": name, "originBoardId": boardID}, &x, true)
	return x, e
}

// MoveToSprint uses the agile endpoint rather than writing the Sprint custom field, whose customfield_NNNNN id differs
// between Jira sites.
func (c *Client) MoveToSprint(ctx context.Context, sprintID int, key string) error {
	return c.request(ctx, "POST", fmt.Sprintf("/rest/agile/1.0/sprint/%d/issue", sprintID), map[string]any{"issues": []string{key}}, nil, true)
}
