#!/usr/bin/env bash
set -Eeuo pipefail

PORTAL_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -x "$PORTAL_DIR/.venv/bin/python" ]]; then
  echo "Run $PORTAL_DIR/setup.sh first." >&2
  exit 1
fi
cd "$PORTAL_DIR"
exec "$PORTAL_DIR/.venv/bin/python" -m uvicorn backend.app.main:app \
  --host "${PORTAL_HOST:-127.0.0.1}" --port "${PORTAL_PORT:-8022}"
