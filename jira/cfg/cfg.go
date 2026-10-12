// Package cfg re-exports Jira config load/validate for sibling HABLO tools (hablo-config).
package cfg

import "github.com/bmelton/HABLO-installer/jira/internal/config"

type (
	Config      = config.Config
	Credentials = config.Credentials
	Project     = config.Project
)

// Load reads and validates a Jira config.json (and optional env file).
func Load(path string) (Config, Credentials, error) { return config.Load(path) }
