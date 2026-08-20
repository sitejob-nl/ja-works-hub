#!/usr/bin/env bash
# Draait de QA-ronde van 20-08 tegen de dev-server van deze worktree.
# Leest het demo-org account uit .env.local zodat er geen wachtwoord in beeld komt.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
# shellcheck disable=SC1091
. ./.env
# shellcheck disable=SC1091
. ./.env.local
set +a

export TEST_EMAIL="${DEMO_ORG_EMAIL}"
export TEST_PASSWORD="${DEMO_ORG_PASSWORD}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:8080}"

mkdir -p scripts/.qa
npx playwright test --config=scripts/playwright.config.ts "$@"
