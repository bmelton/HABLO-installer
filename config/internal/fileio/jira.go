package fileio

import (
	"fmt"
	"os"

	"github.com/bmelton/HABLO-installer/config/internal/jsonedit"
	jiracfg "github.com/bmelton/HABLO-installer/jira/cfg"
)

// LoadJiraObject loads ~/.hablo/jira/config.json preserving comment keys.
func LoadJiraObject(path string) (map[string]any, error) {
	return jsonedit.Load(path)
}

// ValidateJiraObject validates via the jira Load/Validate path.
func ValidateJiraObject(obj map[string]any) error {
	tmp, err := jsonedit.MarshalTemp(obj)
	if err != nil {
		return err
	}
	defer os.Remove(tmp)
	_, _, err = jiracfg.Load(tmp)
	return err
}

// SaveJiraObject validates then writes.
func SaveJiraObject(path string, obj map[string]any) error {
	if err := ValidateJiraObject(obj); err != nil {
		return fmt.Errorf("validation: %w", err)
	}
	return jsonedit.Write(path, obj, 0o644)
}
