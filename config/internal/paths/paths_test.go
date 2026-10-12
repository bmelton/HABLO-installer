package paths

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadStampBashDefault(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "hablo")
	body := "#!/bin/bash\nFM_ROOT=\"${FM_ROOT:-/home/vagrant/firstmate}\"\nDEFAULT_PROVIDER=\"bedrouter\"\n"
	if err := os.WriteFile(bin, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	got := readStamp(bin, "FM_ROOT")
	if got != "/home/vagrant/firstmate" {
		t.Fatalf("got %q", got)
	}
	if g := readStamp(bin, "DEFAULT_PROVIDER"); g != "bedrouter" {
		t.Fatalf("provider %q", g)
	}
}

func TestResolveUsesStamp(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "home")
	bin := filepath.Join(dir, "hablo")
	fm := filepath.Join(home, "fm")
	body := "#!/bin/bash\nFM_ROOT=\"${FM_ROOT:-" + fm + "}\"\n"
	if err := os.WriteFile(bin, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	p := Resolve(home, bin, "")
	if p.FirstmateDir != fm {
		t.Fatalf("FirstmateDir=%q want %q", p.FirstmateDir, fm)
	}
}
