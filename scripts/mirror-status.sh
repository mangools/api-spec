#!/usr/bin/env bash
#
# Dry run of the mirror workflow's decision: downloads the live spec, normalises it as
# generate.sh does, and reports whether openapi.json would be updated. Writes nothing.

set -euo pipefail

cd "$(dirname "$0")/.."

WORK="$(mktemp -d -t api-spec-status.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

./scripts/generate.sh "${WORK}/openapi.json" >/dev/null

mirror_sha="$(shasum -a 256 openapi.json | cut -d' ' -f1)"
live_sha="$(shasum -a 256 "${WORK}/openapi.json" | cut -d' ' -f1)"

echo "mirror sha256: ${mirror_sha}"
echo "live sha256:   ${live_sha}"

if [ "$mirror_sha" = "$live_sha" ]; then
	echo "decision: nothing to commit"
else
	echo "decision: update openapi.json ($(diff "${WORK}/openapi.json" openapi.json | grep -c '^[<>]') changed lines)"
fi
