#!/usr/bin/env bash
set -Eeuo pipefail

# Resolve the web application directory so this works from any current directory.
GRADVOICE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ -x "$GRADVOICE_DIR/.venv/bin/python" ]]; then
  GRADVOICE_PYTHON="$GRADVOICE_DIR/.venv/bin/python"
else
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 was not found. Install Python 3.9 or newer." >&2
    exit 1
  fi

  echo "Creating Python virtual environment at $GRADVOICE_DIR/.venv..."
  python3 -m venv "$GRADVOICE_DIR/.venv"
  GRADVOICE_PYTHON="$GRADVOICE_DIR/.venv/bin/python"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node.js 20 or newer." >&2
  exit 1
fi

echo "Installing Python packages..."
"$GRADVOICE_PYTHON" -m pip install -r "$GRADVOICE_DIR/requirements.txt"

echo "Installing frontend packages..."
npm --prefix "$GRADVOICE_DIR/frontend" install

echo "Creating sample database data..."
cd "$GRADVOICE_DIR"
"$GRADVOICE_PYTHON" -m backend.app.seed

echo
echo "Setup complete. Start GradVoice with:"
echo "  $GRADVOICE_DIR/start.sh"