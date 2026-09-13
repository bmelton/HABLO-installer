package model

import "time"

type Evidence struct {
	ID        string    `json:"id"`
	Key       string    `json:"key"`
	Kind      string    `json:"kind"`
	Source    string    `json:"source"`
	Project   string    `json:"project,omitempty"`
	Quote     string    `json:"quote,omitempty"`
	Target    string    `json:"target,omitempty"`
	Rule      string    `json:"rule,omitempty"`
	Timestamp time.Time `json:"timestamp,omitempty"`
}

type Cluster struct {
	Key      string     `json:"key"`
	Kind     string     `json:"kind"`
	Count    int        `json:"count"`
	Evidence []Evidence `json:"evidence"`
}

type Digest struct {
	Version    int       `json:"version"`
	Generated  time.Time `json:"generatedAt"`
	Since      time.Time `json:"since"`
	Clusters   []Cluster `json:"clusters"`
	KnownRules []string  `json:"knownRules,omitempty"`
	Overflow   int       `json:"overflow,omitempty"`
}

type Target struct {
	Repo string `json:"repo"`
	File string `json:"file"`
	Kind string `json:"kind"`
}

type Change struct {
	Kind    string         `json:"kind"`
	Heading string         `json:"heading,omitempty"`
	Body    string         `json:"body,omitempty"`
	Values  map[string]any `json:"values,omitempty"`
}

type Proposal struct {
	ID             int      `json:"id"`
	Title          string   `json:"title"`
	Problem        string   `json:"problem"`
	Target         Target   `json:"target"`
	Change         Change   `json:"change"`
	Evidence       []string `json:"evidence"`
	Confidence     string   `json:"confidence"`
	AlreadyCovered *string  `json:"alreadyCovered"`
	Fingerprint    string   `json:"fingerprint,omitempty"`
}

type Proposals struct {
	Version   int        `json:"version"`
	Generated time.Time  `json:"generatedAt,omitempty"`
	Items     []Proposal `json:"proposals"`
}
