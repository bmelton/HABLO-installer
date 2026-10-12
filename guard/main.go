package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/bmelton/HABLO-installer/guard/internal/audit"
	"github.com/bmelton/HABLO-installer/guard/internal/decide"
	"github.com/bmelton/HABLO-installer/guard/internal/policy"
)

const version = "0.1.0"

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "usage: hablo-guard <decide|version|doctor|probe|check|record|report> …\n")
		os.Exit(1)
	}
	home, _ := os.UserHomeDir()
	policyPath := os.Getenv("HABLO_GUARD_POLICY")
	if policyPath == "" {
		policyPath = filepath.Join(home, ".hablo", "guard.json")
	}
	switch os.Args[1] {
	case "version":
		fmt.Println(version)
	case "decide":
		cmdDecide(policyPath, home)
	case "doctor":
		os.Exit(cmdDoctor(policyPath, home))
	case "probe":
		cmdProbe(policyPath, home)
	case "check":
		cmdCheck()
	case "record":
		cmdRecord(policyPath, home)
	case "report":
		cmdReport(policyPath, home)
	default:
		fmt.Fprintf(os.Stderr, "hablo-guard: unknown command %q\n", os.Args[1])
		os.Exit(1)
	}
}

func cmdDecide(policyPath, home string) {
	b, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintf(os.Stderr, "hablo-guard: read stdin: %v\n", err)
		os.Exit(3)
	}
	req, err := decide.DecodeRequest(b)
	if err != nil {
		fmt.Fprintf(os.Stderr, "hablo-guard: bad request: %v\n", err)
		os.Exit(3)
	}
	eng := &decide.Engine{Loader: policy.NewLoader(policyPath, home), Home: home}
	v, code := eng.Decide(req)
	enc := json.NewEncoder(os.Stdout)
	if err := enc.Encode(v); err != nil {
		os.Exit(3)
	}
	os.Exit(code)
}

func cmdDoctor(policyPath, home string) int {
	p, err := policy.LoadFile(policyPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "hablo-guard doctor: %v\n", err)
		return 2
	}
	if err := policy.ValidateBase(p); err != nil {
		fmt.Fprintf(os.Stderr, "hablo-guard doctor: %v\n", err)
		return 2
	}
	policy.ExpandTildes(p, home)
	fmt.Printf("hablo-guard %s  mode=%s  policy=%s\n", version, p.Mode, policyPath)
	fmt.Printf("  secrets.paths=%d patterns=%d  protectedPaths=%d  shell.deny=%d  allow=%d\n",
		len(p.Secrets.Paths), len(p.Secrets.Patterns), len(p.ProtectedPaths), len(p.Shell.Deny), len(p.Allow))
	for _, a := range p.Allow {
		fmt.Printf("  allow  rule=%s glob=%s note=%q\n", a.Rule, a.Glob, a.Note)
	}
	return 0
}

func cmdProbe(policyPath, home string) {
	p, err := policy.LoadFile(policyPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "hablo-guard probe: %v\n", err)
		os.Exit(2)
	}
	type row struct {
		ID      string `json:"id"`
		Present bool   `json:"present"`
	}
	var out []row
	for _, c := range p.PostEdit.Checks {
		bin := strings.Fields(c.Command)
		present := false
		if len(bin) > 0 {
			_, err := exec.LookPath(bin[0])
			present = err == nil
		}
		out = append(out, row{ID: c.ID, Present: present})
	}
	_ = home
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"checks": out})
}

func cmdCheck() {
	// Report-only v1: empty findings.
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"findings": []any{}})
}

func cmdRecord(policyPath, home string) {
	b, err := io.ReadAll(os.Stdin)
	if err != nil {
		os.Exit(3)
	}
	var line audit.Line
	if err := json.Unmarshal(b, &line); err != nil {
		os.Exit(3)
	}
	p, err := policy.LoadFile(policyPath)
	if err != nil {
		os.Exit(2)
	}
	policy.ExpandTildes(p, home)
	if err := audit.Append(p.Engine.AuditLog, line); err != nil {
		os.Exit(3)
	}
}

func cmdReport(policyPath, home string) {
	p, err := policy.LoadFile(policyPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "hablo-guard report: %v\n", err)
		os.Exit(2)
	}
	policy.ExpandTildes(p, home)
	since := time.Now().Add(-24 * time.Hour)
	for i := 2; i < len(os.Args); i++ {
		if os.Args[i] == "--since" && i+1 < len(os.Args) {
			if d, err := time.ParseDuration(os.Args[i+1]); err == nil {
				since = time.Now().Add(-d)
			}
			i++
		}
	}
	f, err := os.Open(p.Engine.AuditLog)
	if err != nil {
		fmt.Println("no audit log yet")
		return
	}
	defer f.Close()
	type agg struct {
		Rule  string
		Count int
		Last  string
	}
	m := map[string]*agg{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var line audit.Line
		if json.Unmarshal(sc.Bytes(), &line) != nil {
			continue
		}
		ts, err := time.Parse(time.RFC3339, line.TS)
		if err != nil || ts.Before(since) {
			continue
		}
		if line.Verdict != "deny" && line.Verdict != "ask" && line.Verdict != "warn" {
			continue
		}
		a := m[line.Rule]
		if a == nil {
			a = &agg{Rule: line.Rule}
			m[line.Rule] = a
		}
		a.Count++
		a.Last = line.Reason
	}
	if len(m) == 0 {
		fmt.Println("no denials in window")
		return
	}
	for _, a := range m {
		fmt.Printf("%s  count=%d  last=%s\n", a.Rule, a.Count, a.Last)
	}
}
