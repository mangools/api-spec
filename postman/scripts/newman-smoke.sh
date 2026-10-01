#!/usr/bin/env bash
#
# Structural smoke test: newman parses the collection, resolves every variable and
# builds every request. base_url is forced to the discard port so nothing can
# reach api.mangools.com — every request must fail with ECONNREFUSED.
#
set -euo pipefail

cd "$(dirname "$0")/.."

DEAD_HOST="http://127.0.0.1:9"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT
REPORT="${WORKDIR}/newman.json"

echo "newman run -> ${DEAD_HOST} (no network egress, no API key)"
npx --no-install newman run Mangools-API.postman_collection.json \
	--env-var "base_url=${DEAD_HOST}" \
	--timeout-request 2000 \
	--suppress-exit-code \
	--reporters json \
	--reporter-json-export "${REPORT}" \
	>/dev/null 2>&1

node scripts/newman-assert.js "${REPORT}"
