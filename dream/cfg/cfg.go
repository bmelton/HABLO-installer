// Package cfg re-exports Dream config load for sibling HABLO tools (hablo-config).
package cfg

import "github.com/bmelton/HABLO-installer/dream/internal/config"

type Config = config.Config

func Load(path string) (Config, error) { return config.Load(path) }
