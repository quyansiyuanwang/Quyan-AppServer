#!/usr/bin/env bash
set -euo pipefail

# Called from the deployment root, after prisma migrate deploy. Preflight is read-only.
# Back up the database and pause OTHER writers before opting into this maintenance step.
# A failed apply deliberately leaves the backend stopped; do not serve partially verified data.
NODE_ENV=production bun ./dist/iam-migrate.cjs --all-accounts
pm2 stop backend
NODE_ENV=production bun ./dist/iam-migrate.cjs --all-accounts --apply
# The deploy workflow reloads PM2 only after this script succeeds. No mode or secret is changed.
