#!/usr/bin/env bash
# Thin wrapper: checks Node, then hands off to install.mjs with the same arguments.
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "node is required (22+ recommended): https://nodejs.org or nvm install 22" >&2; exit 1; fi
major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 20 ]; then echo "node $major is too old; need 20+ (22+ for OpenWiki)" >&2; exit 1; fi
exec node install.mjs "$@"
