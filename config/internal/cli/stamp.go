package cli

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"strings"
)

var (
	reProvider = regexp.MustCompile(`(?m)^DEFAULT_PROVIDER="[^"]*"`)
	reModel    = regexp.MustCompile(`(?m)^DEFAULT_MODEL="[^"]*"`)
)

// Defaults are the stamped provider/model in the hablo launcher.
type Defaults struct {
	Provider string
	Model    string
}

// ReadDefaults extracts DEFAULT_PROVIDER / DEFAULT_MODEL from a stamped hablo script.
func ReadDefaults(habloBin string) (Defaults, error) {
	b, err := os.ReadFile(habloBin)
	if err != nil {
		return Defaults{}, err
	}
	d := Defaults{}
	s := bufio.NewScanner(strings.NewReader(string(b)))
	for s.Scan() {
		line := s.Text()
		if strings.HasPrefix(line, "DEFAULT_PROVIDER=") {
			d.Provider = strings.Trim(strings.TrimPrefix(line, "DEFAULT_PROVIDER="), `"`)
		}
		if strings.HasPrefix(line, "DEFAULT_MODEL=") {
			d.Model = strings.Trim(strings.TrimPrefix(line, "DEFAULT_MODEL="), `"`)
		}
	}
	return d, nil
}

// WriteDefaults rewrites DEFAULT_PROVIDER / DEFAULT_MODEL in place (preserves mode).
func WriteDefaults(habloBin string, d Defaults) error {
	fi, err := os.Stat(habloBin)
	if err != nil {
		return err
	}
	b, err := os.ReadFile(habloBin)
	if err != nil {
		return err
	}
	text := string(b)
	if !reProvider.MatchString(text) || !reModel.MatchString(text) {
		return fmt.Errorf("%s: missing DEFAULT_PROVIDER/DEFAULT_MODEL stamps", habloBin)
	}
	prov := strings.ReplaceAll(d.Provider, `"`, "")
	model := strings.ReplaceAll(d.Model, `"`, "")
	text = reProvider.ReplaceAllString(text, fmt.Sprintf(`DEFAULT_PROVIDER="%s"`, prov))
	text = reModel.ReplaceAllString(text, fmt.Sprintf(`DEFAULT_MODEL="%s"`, model))
	tmp := habloBin + ".tmp"
	if err := os.WriteFile(tmp, []byte(text), fi.Mode().Perm()); err != nil {
		return err
	}
	if err := os.Chmod(tmp, fi.Mode().Perm()); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, habloBin)
}
