#!/usr/bin/env bash
# Full HABLO uninstall: everything the installer can reverse (state, globals, firstmate, Pi).
# Equivalent to: node install.mjs uninstall --all --yes
# Pass extra flags after if you need them (for example --no-backup or --infer).
set -euo pipefail
cd "$(dirname "$0")"

node_fix() {
  if [ "$(uname)" = Darwin ] && command -v brew >/dev/null 2>&1; then
    echo "  brew install node"
  elif command -v pacman >/dev/null 2>&1; then
    echo "  sudo pacman -S --needed nodejs npm"
  else
    command -v apt-get >/dev/null 2>&1 && echo "  Do not use apt: its Node is usually older than 20."
    command -v dnf >/dev/null 2>&1 && echo "  Do not use dnf: its Node is usually older than 20."
    echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
    echo "  then open a new shell and run: nvm install 22"
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or later is required to uninstall HABLO. To install it:" >&2
  node_fix >&2
  exit 1
fi
major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 20 ]; then
  echo "Node.js $major at $(command -v node) is too old; HABLO needs 20 or later. To install a newer one:" >&2
  node_fix >&2
  echo "If you already installed a newer Node, open a new shell so it comes first on PATH." >&2
  exit 1
fi

exec node install.mjs uninstall --all --yes "$@"
