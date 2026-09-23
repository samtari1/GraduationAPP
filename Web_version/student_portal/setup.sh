#!/usr/bin/env bash
set -Eeuo pipefail

PORTAL_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -x "$PORTAL_DIR/.venv/bin/python" ]]; then
  python3 -m venv "$PORTAL_DIR/.venv"
fi
"$PORTAL_DIR/.venv/bin/python" -m pip install -r "$PORTAL_DIR/requirements.txt"
echo "Student portal setup complete. Start it with: $PORTAL_DIR/start.sh"
