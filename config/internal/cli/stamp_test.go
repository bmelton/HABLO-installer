package cli

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteDefaults(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "hablo")
	src := "#!/bin/bash\nDEFAULT_PROVIDER=\"bedrouter\"\nDEFAULT_MODEL=\"auto\"\n"
	if err := os.WriteFile(bin, []byte(src), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := WriteDefaults(bin, Defaults{Provider: "openai", Model: "gpt"}); err != nil {
		t.Fatal(err)
	}
	d, err := ReadDefaults(bin)
	if err != nil {
		t.Fatal(err)
	}
	if d.Provider != "openai" || d.Model != "gpt" {
		t.Fatalf("%+v", d)
	}
	fi, _ := os.Stat(bin)
	if fi.Mode().Perm()&0o111 == 0 {
		t.Fatal("lost execute bit")
	}
}
