#!/usr/bin/env bash
# Headed QA-ronde 21-08 over de vijf punten van de buglijst van 20-08.
# Draait standaard tegen de live omgeving; overschrijf met E2E_BASE_URL.
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
export E2E_BASE_URL="${E2E_BASE_URL:-https://ats.sitejob.nl}"
export PLAYWRIGHT_SKIP_WEBSERVER=1
export HEADED=1

echo "QA headed tegen: $E2E_BASE_URL"
mkdir -p scripts/.qa-headed
rm -f scripts/.auth-state.json
npx playwright test --config=scripts/playwright.config.ts qa-headed-20260821 --headed "$@"
