package jira

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientEndpointsAndADF(t *testing.T) {
	var paths []string
	var comment map[string]any
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Basic ") {
			t.Error("missing auth")
		}
		switch r.URL.Path {
		case "/rest/api/3/search/jql":
			json.NewEncoder(w).Encode(map[string]any{"issues": []any{map[string]any{"key": "HABLO-1", "fields": map[string]any{"summary": "Demo"}}}, "isLast": true})
		case "/rest/api/3/issue/HABLO-1/comment":
			json.NewDecoder(r.Body).Decode(&comment)
			w.WriteHeader(201)
		default:
			http.NotFound(w, r)
		}
	}))
	defer s.Close()
	c := Client{BaseURL: s.URL, Email: "e", Token: "t"}
	xs, e := c.Search(context.Background(), "project=HABLO", 10)
	if e != nil || len(xs) != 1 {
		t.Fatalf("search: %v %#v", e, xs)
	}
	if e = c.AddComment(context.Background(), "HABLO-1", "hello"); e != nil {
		t.Fatal(e)
	}
	body := comment["body"].(map[string]any)
	if body["type"] != "doc" || body["version"].(float64) != 1 {
		t.Fatalf("not ADF: %#v", comment)
	}
	if len(paths) != 2 {
		t.Fatalf("paths: %#v", paths)
	}
}
func TestRateLimitRetriesOnce(t *testing.T) {
	n := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n++
		if n == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(429)
			return
		}
		w.WriteHeader(201)
	}))
	defer s.Close()
	c := Client{BaseURL: s.URL, Email: "e", Token: "t"}
	if e := c.AddComment(context.Background(), "X-1", "x"); e != nil {
		t.Fatal(e)
	}
	if n != 2 {
		t.Fatalf("requests=%d", n)
	}
}
