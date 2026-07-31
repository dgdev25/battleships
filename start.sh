#!/usr/bin/env bash
# start.sh — abyssal-battleships development launcher
#
# Single process:
#   node src/server.mjs  — game API + static front-end (ruvector memory on disk)
#
# Usage:
#   ./start.sh               # start the server
#   ./start.sh --rebuild     # force a fresh npm install
#   ./start.sh --wipe-memory # delete the AI's stored episodes, then start
#   ./start.sh --stop        # stop the server
#   ./start.sh --reset-ports # clear the saved port; next run picks a new one

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${SCRIPT_DIR}"
LOG_DIR="${PROJECT_ROOT}/logs"
LOG_APP="${LOG_DIR}/server.log"
DATA_DIR="${PROJECT_ROOT}/data"

# ── Helpers ──────────────────────────────────────────────────────────────────
info()   { echo "  ${*}"; }
ok()     { echo "  [ok] ${*}"; }
warn()   { echo "  [warn] ${*}"; }
die()    { echo "[fail] ${*}" >&2; exit 1; }
header() { echo; echo "── ${*}"; }

# ── Ports — assigned once on first run, then hardcoded into this script ───────
# To pick a new port: ./start.sh --reset-ports
find_free_port() {
  local start="${1}" end="${2}" port
  for port in $(seq "${start}" "${end}"); do
    if ! ss -tln 2>/dev/null | grep -q ":${port} " && \
       ! lsof -i tcp:"${port}" &>/dev/null 2>&1; then
      echo "${port}"; return 0
    fi
  done
  die "No free port found in range ${start}–${end}"
}

APP_PORT="47801"   # assigned on first run

if [[ -z "${APP_PORT}" ]]; then
  APP_PORT="$(find_free_port 47800 47899)"
  sed -i "s/^APP_PORT=\"\"/APP_PORT=\"${APP_PORT}\"/" "${BASH_SOURCE[0]}"
  info "Port assigned and saved (app=${APP_PORT})"
fi

export PORT="${APP_PORT}"
export APP_URL="http://localhost:${APP_PORT}"

# ── Flags ────────────────────────────────────────────────────────────────────
STOP_ONLY=false
FORCE_REBUILD=false
WIPE_MEMORY=false
for arg in "$@"; do
  case "${arg}" in
    --stop)        STOP_ONLY=true ;;
    --rebuild)     FORCE_REBUILD=true ;;
    --wipe-memory) WIPE_MEMORY=true ;;
    --reset-ports)
      sed -i 's/^APP_PORT="[0-9]*"/APP_PORT=""/' "${BASH_SOURCE[0]}"
      ok "Port reset — next run will assign a new one"; exit 0 ;;
    *) echo "Unknown flag: ${arg}" >&2; exit 1 ;;
  esac
done

kill_port() {
  local port="${1}"
  local pids
  pids="$(lsof -ti tcp:"${port}" 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    kill ${pids} 2>/dev/null || true
    local retries=10
    while [[ ${retries} -gt 0 ]] && lsof -ti tcp:"${port}" &>/dev/null; do
      sleep 0.3; retries=$((retries - 1))
    done
    pids="$(lsof -ti tcp:"${port}" 2>/dev/null || true)"
    [[ -n "${pids}" ]] && { kill -9 ${pids} 2>/dev/null || true; sleep 0.2; }
    ok "Stopped process on port ${port}"
  else
    info "Port ${port} was not in use"
  fi
}

# A bound socket is not a serving app — curl the real endpoint instead.
wait_for_http() {
  local url="${1}" label="${2}" log="${3:-}" timeout=30 elapsed=0
  while ! curl -sf --max-time 2 "${url}" &>/dev/null; do
    sleep 0.5; elapsed=$((elapsed + 1))
    if [[ ${elapsed} -ge $((timeout * 2)) ]]; then
      local hint=""; [[ -n "${log}" ]] && hint=" — check ${log}"
      die "${label} did not respond at ${url} after ${timeout}s${hint}"
    fi
  done
}

npm_needs_install() {
  [[ ! -d "${PROJECT_ROOT}/node_modules" ]] && return 0
  [[ "${PROJECT_ROOT}/package.json" -nt "${PROJECT_ROOT}/node_modules/.package-lock.json" ]]
}

# ── 0. Resolved ports ────────────────────────────────────────────────────────
info "Port: app=${APP_PORT}"

# ── 1. Dependency checks ─────────────────────────────────────────────────────
header "1. Checking dependencies"
command -v node &>/dev/null || die "node not found — install Node 20+ (this project uses ruvector's native bindings)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "${NODE_MAJOR}" -ge 20 ]] || die "Node ${NODE_MAJOR} is too old — ruvector requires Node >= 20"
ok "Node: $(node --version)"
command -v npm &>/dev/null || die "npm not found — install it with Node"
ok "npm: $(npm --version)"
command -v curl &>/dev/null || die "curl not found — required for HTTP readiness checks"
ok "curl: $(curl --version | head -1 | cut -d' ' -f1-2)"
command -v lsof &>/dev/null || warn "lsof not found — port cleanup falls back to pkill"

# ── 2. Stop running services ─────────────────────────────────────────────────
header "2. Stopping services"
if command -v lsof &>/dev/null; then
  kill_port "${APP_PORT}"
else
  pkill -f "battleships/src/server.mjs" 2>/dev/null || true
  sleep 1
  info "Sent pkill to any running server"
fi

[[ "${STOP_ONLY}" == true ]] && { echo; ok "All services stopped."; exit 0; }

# ── 3. Build ─────────────────────────────────────────────────────────────────
header "3. Building"
mkdir -p "${LOG_DIR}"

if [[ "${FORCE_REBUILD}" == true ]] || npm_needs_install; then
  info "Installing npm dependencies (ruvector ships native bindings — this can take a minute)..."
  npm install --prefix "${PROJECT_ROOT}" --silent
  ok "Dependencies installed"
else
  ok "Dependencies up to date — skipping install (use --rebuild to force)"
fi

node --check "${PROJECT_ROOT}/src/server.mjs" || die "src/server.mjs failed to parse"
ok "Server sources parse"

if [[ "${WIPE_MEMORY}" == true ]]; then
  rm -rf "${DATA_DIR}"
  ok "AI memory wiped — the opponent starts from scratch"
elif [[ -f "${DATA_DIR}/placement.jsonl" ]]; then
  ok "AI memory found: $(wc -l < "${DATA_DIR}/placement.jsonl") board + $(wc -l < "${DATA_DIR}/shots.jsonl" 2>/dev/null || echo 0) shot episodes"
else
  info "No AI memory yet — the opponent will play blind until you finish a game"
fi

# ── 4. Start services ────────────────────────────────────────────────────────
header "4. Starting services"
info "Starting game server (port ${APP_PORT})..."
( cd "${PROJECT_ROOT}" && exec node src/server.mjs ) >"${LOG_APP}" 2>&1 &
APP_PID=$!
wait_for_http "${APP_URL}/api/config" "Game server" "${LOG_APP}"
kill -0 "${APP_PID}" 2>/dev/null || die "Game server exited immediately — check ${LOG_APP}"
ok "Game server running (PID ${APP_PID}, ${APP_URL})"

BACKEND_LINE="$(grep -m1 '^memory:' "${LOG_APP}" || true)"
[[ -n "${BACKEND_LINE}" ]] && info "${BACKEND_LINE}"

# ── Done ─────────────────────────────────────────────────────────────────────
echo
printf "┌──────────────────────────────────────────────────────────────────┐\n"
printf "│  abyssal-battleships is running                                  │\n"
printf "├──────────────────────────────────────────────────────────────────┤\n"
printf "│  Game      ──  %-49s │\n" "${APP_URL}"
printf "│  API       ──  %-49s │\n" "${APP_URL}/api/config"
printf "├──────────────────────────────────────────────────────────────────┤\n"
printf "│  Logs:   %-55s │\n" "${LOG_DIR}/"
printf "│  Memory: %-55s │\n" "${DATA_DIR}/"
printf "│  Stop:   ./start.sh --stop                                       │\n"
printf "│  Wipe:   ./start.sh --wipe-memory                                │\n"
printf "└──────────────────────────────────────────────────────────────────┘\n"
echo
