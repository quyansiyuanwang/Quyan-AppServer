#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_LINES="${DEPLOY_LOG_LINES:-200}"
SKIP_INSTALL=false
SKIP_LOGS=false

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-bun-pm2.sh [options]

Options:
  --no-install   Skip pnpm install --frozen-lockfile
  --no-logs      Skip final pm2 logs output
  -h, --help     Show help

Environment:
  DEPLOY_LOG_LINES   Number of final PM2 log lines to print (default: 200)

Behavior:
  1. Install dependencies (optional)
  2. Generate Prisma client
  3. Generate OpenAPI routes/spec
  4. Build production artifact
  5. Run Bun deployment preflight
  6. Reload existing PM2 backend or start a new one
  7. Show PM2 status and recent logs
EOF
}

while (($# > 0)); do
  case "$1" in
    --no-install)
      SKIP_INSTALL=true
      ;;
    --no-logs)
      SKIP_LOGS=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

step() {
  echo ""
  echo "==> $1"
}

ensure_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This script is intended for Linux servers only." >&2
  exit 1
fi

ensure_command pnpm
ensure_command node
ensure_command bun

cd "$ROOT_DIR"

step "Project root"
pwd

if [[ "$SKIP_INSTALL" != true ]]; then
  step "Install dependencies"
  pnpm install --frozen-lockfile
fi

step "Generate Prisma client"
pnpm run db:generate

step "Generate OpenAPI routes and spec"
pnpm run openapi:generate

step "Build production artifact"
pnpm run build:prod

step "Run Bun deployment preflight"
pnpm run deploy:preflight

if pnpm exec pm2 describe backend >/dev/null 2>&1; then
  step "Reload existing PM2 backend"
  pnpm exec pm2 reload ecosystem.config.cjs --env production
else
  step "Start new PM2 backend"
  pnpm run pm2:start:prod
fi

step "PM2 status"
pnpm run pm2:status

if [[ "$SKIP_LOGS" != true ]]; then
  step "Recent PM2 logs"
  pnpm exec pm2 logs backend --lines "$LOG_LINES" --nostream
fi

step "Deployment finished"
echo "Bun + PM2 deployment flow completed."