#!/usr/bin/env bash
set -Eeuo pipefail

# Resolve the web application directory so this works from any current directory.
GRADVOICE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GRADVOICE_HOST="${GRADVOICE_HOST:-127.0.0.1}"
GRADVOICE_PORT="${GRADVOICE_PORT:-8012}"

if [[ ! -x "$GRADVOICE_DIR/.venv/bin/python" ]]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 was not found. Install Python 3.11 or newer." >&2
    exit 1
  fi

  echo "Creating the GradVoice Python virtual environment..."
  python3 -m venv "$GRADVOICE_DIR/.venv"
fi

GRADVOICE_PYTHON="$GRADVOICE_DIR/.venv/bin/python"

echo "Installing GradVoice Python packages..."
"$GRADVOICE_PYTHON" -m pip install -r "$GRADVOICE_DIR/requirements.txt"

if ! "$GRADVOICE_PYTHON" -c 'import fastapi, sqlalchemy, uvicorn' 2>/dev/null; then
  echo "GradVoice backend packages are missing." >&2
  echo "Run: $GRADVOICE_PYTHON -m pip install -r $GRADVOICE_DIR/requirements.txt" >&2
  exit 1
fi

if [[ ! "$GRADVOICE_PORT" =~ ^[0-9]+$ ]] || (( GRADVOICE_PORT < 1 || GRADVOICE_PORT > 65535 )); then
  echo "GRADVOICE_PORT must be a number from 1 through 65535." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node.js 20 or newer." >&2
  exit 1
fi

if [[ ! -d "$GRADVOICE_DIR/frontend/node_modules" ]]; then
  echo "Installing GradVoice frontend packages..."
  npm --prefix "$GRADVOICE_DIR/frontend" install
fi

cleanup_gradvoice_port() {
  local listener_pids pid command

  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  listener_pids="$(lsof -nP -tiTCP:"$GRADVOICE_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -z "$listener_pids" ]] && return

  for pid in $listener_pids; do
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command" != *"uvicorn"* || "$command" != *"backend.app.main:app"* ]]; then
      echo "Port $GRADVOICE_PORT is occupied by another application:" >&2
      echo "  PID $pid: $command" >&2
      echo "Stop that application or choose another GRADVOICE_PORT." >&2
      exit 1
    fi

    echo "Stopping the existing GradVoice server on port $GRADVOICE_PORT (PID $pid)..."
    kill -TERM "$pid"
  done

  # Give Uvicorn a moment to shut down cleanly before rebuilding and restarting.
  for _ in {1..50}; do
    if ! lsof -nP -tiTCP:"$GRADVOICE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      return
    fi
    sleep 0.1
  done

  # A stuck Uvicorn process may not complete its graceful shutdown. Re-check
  # every current listener before using SIGKILL so an unrelated replacement
  # process is never terminated accidentally.
  listener_pids="$(lsof -nP -tiTCP:"$GRADVOICE_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  for pid in $listener_pids; do
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command" != *"uvicorn"* || "$command" != *"backend.app.main:app"* ]]; then
      echo "Port $GRADVOICE_PORT is now occupied by another application:" >&2
      echo "  PID $pid: $command" >&2
      exit 1
    fi

    echo "GradVoice did not stop gracefully; force-stopping PID $pid..."
    kill -KILL "$pid"
  done

  for _ in {1..20}; do
    if ! lsof -nP -tiTCP:"$GRADVOICE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      return
    fi
    sleep 0.1
  done

  echo "GradVoice could not release port $GRADVOICE_PORT after being force-stopped." >&2
  exit 1
}

cleanup_gradvoice_port

echo "Building the GradVoice web interface..."
npm --prefix "$GRADVOICE_DIR/frontend" run build

cd "$GRADVOICE_DIR"
echo
echo "GradVoice is starting at http://$GRADVOICE_HOST:$GRADVOICE_PORT"
echo "Press Ctrl+C to stop it."
echo

exec "$GRADVOICE_PYTHON" -m uvicorn backend.app.main:app \
  --host "$GRADVOICE_HOST" \
  --port "$GRADVOICE_PORT"
