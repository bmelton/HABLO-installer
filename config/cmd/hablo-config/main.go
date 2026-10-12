// hablo-config edits HABLO runtime files (Jira, secrets, Spy, Dream, firstmate, CLI stamps, Agent).
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/bmelton/HABLO-installer/config/internal/agent"
	"github.com/bmelton/HABLO-installer/config/internal/cli"
	"github.com/bmelton/HABLO-installer/config/internal/paths"
	"github.com/bmelton/HABLO-installer/config/internal/status"
	"github.com/bmelton/HABLO-installer/config/internal/tui"
)

func main() {
	var (
		printStatus = flag.Bool("print", false, "print status chips and exit")
		check       = flag.Bool("check", false, "validate runtime files and exit non-zero on failure")
		setAgent    = flag.String("set-agent", "", "set agent preference to pi or claude (headless)")
		setProvider = flag.String("set-provider", "", "stamp DEFAULT_PROVIDER on hablo (headless; requires --set-model)")
		setModel    = flag.String("set-model", "", "stamp DEFAULT_MODEL on hablo (headless; requires --set-provider)")
		habloBin    = flag.String("hablo-bin", "", "path to stamped hablo (default: PATH or ~/.local/bin/hablo)")
		fmDir       = flag.String("firstmate-dir", "", "firstmate checkout (default: stamped FM_ROOT or ~/firstmate)")
		home        = flag.String("home", "", "override HOME for path resolution")
	)
	flag.Parse()

	userHome := *home
	if userHome == "" {
		userHome = os.Getenv("HOME")
	}
	p := paths.Resolve(userHome, *habloBin, *fmDir)

	if *setAgent != "" {
		if err := agent.SetPreference(p.AgentMarker, p.FirstmateDir, *setAgent); err != nil {
			fail(err)
		}
		if w := agent.WarnClaudeMissing(*setAgent); w != "" {
			fmt.Fprintln(os.Stderr, "warning:", w)
		}
		fmt.Println("agent:", *setAgent)
		return
	}
	if *setProvider != "" || *setModel != "" {
		if *setProvider == "" || *setModel == "" {
			fail(fmt.Errorf("--set-provider and --set-model must be used together"))
		}
		if err := cli.WriteDefaults(p.HabloBin, cli.Defaults{Provider: *setProvider, Model: *setModel}); err != nil {
			fail(err)
		}
		fmt.Printf("cli: %s/%s\n", *setProvider, *setModel)
		return
	}
	if *printStatus {
		fmt.Print(status.Print(p))
		return
	}
	if *check {
		errs := status.Check(p)
		if len(errs) == 0 {
			fmt.Println("hablo-config --check: ok")
			return
		}
		for _, e := range errs {
			fmt.Fprintln(os.Stderr, e)
		}
		os.Exit(1)
	}

	if err := tui.Run(p); err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "hablo-config:", err)
	os.Exit(1)
}
