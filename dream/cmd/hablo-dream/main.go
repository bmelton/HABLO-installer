package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/bmelton/HABLO-installer/dream/internal/app"
	"github.com/bmelton/HABLO-installer/dream/internal/config"
)

const version = "0.1.0"

func fail(e error) { fmt.Fprintln(os.Stderr, "hablo-dream:", e); os.Exit(1) }
func usage() {
	fmt.Fprintln(os.Stderr, "usage: hablo-dream [--config path] digest|run|report|show <n>|dismiss <n> --reason text|apply <n[,n…]>|doctor|version")
}
func main() {
	global := flag.NewFlagSet("hablo-dream", flag.ContinueOnError)
	defaultConfig := os.Getenv("HABLO_DREAM_CONFIG")
	if defaultConfig == "" {
		h, _ := os.UserHomeDir()
		defaultConfig = filepath.Join(h, ".hablo", "dream", "config.json")
	}
	configPath := global.String("config", defaultConfig, "config path")
	if e := global.Parse(os.Args[1:]); e != nil {
		os.Exit(2)
	}
	args := global.Args()
	if len(args) == 0 {
		usage()
		os.Exit(2)
	}
	if args[0] == "version" {
		fmt.Println("hablo-dream " + version)
		return
	}
	c, e := config.Load(*configPath)
	if e != nil {
		fail(e)
	}
	a := app.New(c)
	switch args[0] {
	case "digest":
		_, p, e := a.Digest()
		if e != nil {
			fail(e)
		}
		fmt.Println(p)
	case "run":
		p, e := a.Run()
		if e != nil {
			fail(e)
		}
		fmt.Println(p)
	case "report":
		s, e := a.Report()
		if e != nil {
			fail(e)
		}
		fmt.Print(s)
	case "show":
		if len(args) != 2 {
			usage()
			os.Exit(2)
		}
		n, e := strconv.Atoi(args[1])
		if e != nil {
			fail(e)
		}
		s, e := a.Show(n)
		if e != nil {
			fail(e)
		}
		fmt.Print(s)
	case "dismiss":
		fs := flag.NewFlagSet("dismiss", flag.ContinueOnError)
		reason := fs.String("reason", "", "dismissal reason")
		if len(args) < 2 {
			usage()
			os.Exit(2)
		}
		n, e := strconv.Atoi(args[1])
		if e != nil {
			fail(e)
		}
		if e = fs.Parse(args[2:]); e != nil {
			os.Exit(2)
		}
		if e = a.Dismiss(n, *reason); e != nil {
			fail(e)
		}
	case "apply":
		if len(args) != 2 {
			usage()
			os.Exit(2)
		}
		ids, e := app.IDs(args[1])
		if e != nil {
			fail(e)
		}
		urls, e := a.Apply(ids)
		if e != nil {
			fail(e)
		}
		for _, u := range urls {
			fmt.Println(u)
		}
	case "doctor":
		fmt.Print(a.Doctor())
	default:
		usage()
		os.Exit(2)
	}
}
