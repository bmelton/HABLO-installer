package fileio

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteBackendRejectsBanana(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := WriteBackend(dir, "banana"); err == nil {
		t.Fatal("expected error")
	}
	if err := WriteBackend(dir, "tmux"); err != nil {
		t.Fatal(err)
	}
	if got := ReadBackend(dir); got != "tmux" {
		t.Fatalf("got %q", got)
	}
	if err := WriteBackend(dir, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "config", "backend")); !os.IsNotExist(err) {
		t.Fatalf("expected removed, err=%v", err)
	}
}
