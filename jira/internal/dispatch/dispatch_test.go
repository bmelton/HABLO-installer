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
