package fileio

import (
	"fmt"
	"os"

	"github.com/bmelton/HABLO-installer/config/internal/jsonedit"
	dreamcfg "github.com/bmelton/HABLO-installer/dream/cfg"
)

// LoadDreamObject loads dream config.json preserving comment keys.
func LoadDreamObject(path string) (map[string]any, error) {
	return jsonedit.Load(path)
}

// ValidateDreamObject validates via dream config.Load.
func ValidateDreamObject(obj map[string]any) error {
	tmp, err := jsonedit.MarshalTemp(obj)
	if err != nil {
		return err
	}
	defer os.Remove(tmp)
	_, err = dreamcfg.Load(tmp)
	return err
}

// SaveDreamObject validates then writes.
func SaveDreamObject(path string, obj map[string]any) error {
	if err := ValidateDreamObject(obj); err != nil {
		return fmt.Errorf("validation: %w", err)
	}
	return jsonedit.Write(path, obj, 0o644)
}
