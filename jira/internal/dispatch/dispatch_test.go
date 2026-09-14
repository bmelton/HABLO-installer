package dispatch

import (
	"fmt"
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestTmuxLifecycle(t *testing.T) {
	if _, e := exec.LookPath("tmux"); e != nil {
		t.Skip("tmux unavailable")
	}
	key := fmt.Sprintf("TEST-%d", os.Getpid())
	defer Kill(key)
	if e := exec.Command("tmux", "new-session", "-d", "-s", "hablo-"+key, "sleep", "5").Run(); e != nil {
		t.Fatal(e)
	}
	deadline := time.Now().Add(time.Second)
	for !Alive(key) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !Alive(key) {
		t.Fatal("session not alive")
	}
	Kill(key)
	if Alive(key) {
		t.Fatal("session survived kill")
	}
}

func TestReadableCollapsesTerminalNoise(t *testing.T) {
	// A spinner redrawing in place, wrapped in the OSC-8 hyperlink and synchronised-update sequences Pi emits.
	raw := "\x1b[?2026h \x1b[32m⠧ Working\x1b[0m \x1b]8;;\x07\r" +
		"\x1b[?2026h \x1b[32m⠧ Working\x1b[0m \x1b]8;;\x07\r" +
		"\x1b[?2026h \x1b[32m⠇ Working\x1b[0m \x1b]8;;\x07\r" +
		"\ncreated HELLO.md\n\n\n"
	got := Readable(raw)
	want := []string{" ⠧ Working", " ⠇ Working", "created HELLO.md"}
	if len(got) != len(want) {
		t.Fatalf("got %q, want %q", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %q, want %q", got, want)
		}
	}
}

func TestStripTerminalKeepsText(t *testing.T) {
	if got := StripTerminal("\x1b[1;31mred\x1b[0m plain"); got != "red plain" {
		t.Fatalf("got %q", got)
	}
	// An OSC-8 hyperlink terminated by ST rather than BEL.
	if got := StripTerminal("\x1b]8;;https://example.com\x1b\\link"); got != "link" {
		t.Fatalf("got %q", got)
	}
	if got := StripTerminal("no escapes here"); got != "no escapes here" {
		t.Fatalf("got %q", got)
	}
}

func TestCaptureWithoutSession(t *testing.T) {
	if _, e := Capture("NOPE-999", 0); e == nil {
		t.Fatal("expected an error for a key with no tmux session")
	}
}
