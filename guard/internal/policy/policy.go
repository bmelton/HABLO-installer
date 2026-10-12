package policy

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Engine struct {
	BinName   string `json:"binName"`
	TimeoutMs int    `json:"timeoutMs"`
	AuditLog  string `json:"auditLog"`
	CacheDir  string `json:"cacheDir"`
}

type Ask struct {
	TimeoutSeconds int `json:"timeoutSeconds"`
}

type Secrets struct {
	Interactive   *bool    `json:"interactive"`
	MaxScanBytes  int      `json:"maxScanBytes"`
	Paths         []string `json:"paths"`
	Patterns      []string `json:"patterns"`
	ExfilCommands []string `json:"exfilCommands"`
	ExfilHosts    []string `json:"exfilHosts"`
}

type ProtectedPath struct {
	Rule           string `json:"rule"`
	Glob           string `json:"glob"`
	OutsideProject bool   `json:"outsideProject"`
	Interactive    *bool  `json:"interactive"`
}

type Shell struct {
	Interactive      *bool    `json:"interactive"`
	Deny             []string `json:"deny"`
	DenyForcePushTo  []string `json:"denyForceePushTo"` // typo kept from HOOKS.md schema
	DenyForcePushTo2 []string `json:"denyForcePushTo"`
}

type Check struct {
	ID        string `json:"id"`
	Command   string `json:"command"`
	Glob      string `json:"glob"`
	TimeoutMs int    `json:"timeoutMs"`
	OnFail    string `json:"onFail"`
}

type PostEdit struct {
	TurnBudgetMs int     `json:"turnBudgetMs"`
	Checks       []Check `json:"checks"`
}

type Allow struct {
	Rule    string `json:"rule"`
	Glob    string `json:"glob"`
	Command string `json:"command"`
	Project string `json:"project"`
	Note    string `json:"note"`
	Added   string `json:"added"`
}

type Policy struct {
	Mode           string          `json:"mode"`
	Engine         Engine          `json:"engine"`
	Ask            Ask             `json:"ask"`
	ExfilTools     []string        `json:"exfilTools"`
	Secrets        Secrets         `json:"secrets"`
	ProtectedPaths []ProtectedPath `json:"protectedPaths"`
	Shell          Shell           `json:"shell"`
	PostEdit       PostEdit        `json:"postEdit"`
	Allow          []Allow         `json:"allow"`
}

type Loader struct {
	mu       sync.Mutex
	userPath string
	mtime    time.Time
	pol      *Policy
	home     string
}

func NewLoader(userPath, home string) *Loader {
	return &Loader{userPath: userPath, home: home}
}

func (l *Loader) Get(projectDir string) (*Policy, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	st, err := os.Stat(l.userPath)
	if err != nil {
		return nil, fmt.Errorf("policy missing: %s: %w", l.userPath, err)
	}
	if l.pol == nil || !st.ModTime().Equal(l.mtime) {
		p, err := LoadFile(l.userPath)
		if err != nil {
			return nil, err
		}
		if err := ValidateBase(p); err != nil {
			return nil, err
		}
		ExpandTildes(p, l.home)
		l.pol = p
		l.mtime = st.ModTime()
	}
	out := clone(l.pol)
	if projectDir != "" {
		projPath := filepath.Join(projectDir, ".hablo", "guard.json")
		if _, err := os.Stat(projPath); err == nil {
			add, err := LoadFile(projPath)
			if err != nil {
				return nil, fmt.Errorf("project policy: %w", err)
			}
			if err := ValidateProject(add); err != nil {
				return nil, err
			}
			ExpandTildes(add, l.home)
			MergeProject(out, add)
		}
	}
	return out, nil
}

func LoadFile(path string) (*Policy, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var p Policy
	if err := json.Unmarshal(b, &p); err != nil {
		return nil, fmt.Errorf("unparsable policy %s: %w", path, err)
	}
	return &p, nil
}

func ValidateBase(p *Policy) error {
	if p.Mode == "" {
		p.Mode = "enforce"
	}
	switch p.Mode {
	case "enforce", "warn", "off":
	default:
		return fmt.Errorf("invalid mode %q", p.Mode)
	}
	for i, a := range p.Allow {
		if strings.TrimSpace(a.Rule) == "" || strings.TrimSpace(a.Note) == "" {
			return fmt.Errorf("allow[%d]: rule and note are required", i)
		}
		if a.Glob == "" && a.Command == "" {
			return fmt.Errorf("allow[%d]: glob or command required", i)
		}
	}
	if p.Secrets.MaxScanBytes == 0 {
		p.Secrets.MaxScanBytes = 8 << 20
	}
	if p.Engine.TimeoutMs == 0 {
		p.Engine.TimeoutMs = 3000
	}
	return nil
}

func ValidateProject(p *Policy) error {
	if p.Mode != "" {
		return fmt.Errorf("project policy may not set mode")
	}
	if len(p.Allow) > 0 {
		return fmt.Errorf("project policy may not set allow")
	}
	if p.Engine.BinName != "" || p.Engine.AuditLog != "" || p.Engine.CacheDir != "" || p.Engine.TimeoutMs != 0 {
		return fmt.Errorf("project policy may not set engine")
	}
	return nil
}

func MergeProject(base, add *Policy) {
	base.Secrets.Paths = append(base.Secrets.Paths, add.Secrets.Paths...)
	base.Secrets.Patterns = append(base.Secrets.Patterns, add.Secrets.Patterns...)
	base.Secrets.ExfilCommands = append(base.Secrets.ExfilCommands, add.Secrets.ExfilCommands...)
	base.Secrets.ExfilHosts = append(base.Secrets.ExfilHosts, add.Secrets.ExfilHosts...)
	base.ProtectedPaths = append(base.ProtectedPaths, add.ProtectedPaths...)
	base.Shell.Deny = append(base.Shell.Deny, add.Shell.Deny...)
	base.Shell.DenyForcePushTo = append(base.Shell.DenyForcePushTo, add.Shell.DenyForcePushTo...)
	base.Shell.DenyForcePushTo2 = append(base.Shell.DenyForcePushTo2, add.Shell.DenyForcePushTo2...)
	base.PostEdit.Checks = append(base.PostEdit.Checks, add.PostEdit.Checks...)
	base.ExfilTools = append(base.ExfilTools, add.ExfilTools...)
}

func ExpandTildes(p *Policy, home string) {
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	exp := func(s string) string {
		if strings.HasPrefix(s, "~/") {
			return filepath.Join(home, s[2:])
		}
		if s == "~" {
			return home
		}
		return s
	}
	p.Engine.AuditLog = exp(p.Engine.AuditLog)
	p.Engine.CacheDir = exp(p.Engine.CacheDir)
	for i, s := range p.Secrets.Paths {
		p.Secrets.Paths[i] = exp(s)
	}
	for i := range p.ProtectedPaths {
		p.ProtectedPaths[i].Glob = exp(p.ProtectedPaths[i].Glob)
	}
	for i := range p.Allow {
		p.Allow[i].Glob = exp(p.Allow[i].Glob)
		p.Allow[i].Project = exp(p.Allow[i].Project)
	}
}

func clone(p *Policy) *Policy {
	b, _ := json.Marshal(p)
	var out Policy
	_ = json.Unmarshal(b, &out)
	return &out
}

func (p *Policy) ForcePushBranches() []string {
	if len(p.Shell.DenyForcePushTo2) > 0 {
		return p.Shell.DenyForcePushTo2
	}
	return p.Shell.DenyForcePushTo
}

func BoolDefault(b *bool, def bool) bool {
	if b == nil {
		return def
	}
	return *b
}
