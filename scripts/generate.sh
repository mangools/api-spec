#!/usr/bin/env bash
#
# Downloads the live OpenAPI document and writes it to openapi.json in the form the
# mirror keeps it: parsed, then re-serialised with two-space indentation.
#
#   ./scripts/generate.sh [output-path]
#
# SPEC_URL overrides the source.

set -euo pipefail

cd "$(dirname "$0")/.."
OUT="${1:-openapi.json}"
SPEC_URL="${SPEC_URL:-https://api.mangools.com/v3/openapi.json}"

WORK="$(mktemp -d -t api-spec-fetch.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

if ! curl -fsSL "$SPEC_URL" -o "${WORK}/spec.json"; then
	echo "Could not download ${SPEC_URL}" >&2
	exit 1
fi

node -e '
	const fs = require("fs");
	let spec;
	try { spec = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
	catch (e) { console.error("The downloaded document is not valid JSON: " + e.message); process.exit(1); }
	const paths = spec && spec.paths && typeof spec.paths === "object" && !Array.isArray(spec.paths) ? Object.keys(spec.paths).length : 0;
	if (!spec || typeof spec.openapi !== "string" || paths === 0) {
		console.error("Not an OpenAPI document: needs an openapi version and at least one path.");
		process.exit(1);
	}
	fs.writeFileSync(process.argv[2], JSON.stringify(spec, null, 2) + "\n");
' "${WORK}/spec.json" "$OUT"

echo "Wrote ${OUT} from ${SPEC_URL}"
