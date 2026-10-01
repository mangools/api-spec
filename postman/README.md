# Mangools API: Postman collection

The tooling that builds the public Mangools API Postman collection from `../openapi.json`,
validates it, and uploads it to the Postman workspace. The collection itself is a build
output. It is not stored in git.

| Path | What it is |
| --- | --- |
| `config/openapi-to-postman.json` | Converter options and post-processing settings. |
| `scripts/generate.js` | Converts `../openapi.json` into `Mangools-API.postman_collection.json` (gitignored). |
| `scripts/validate.js` | Checks the generated collection against the spec. |
| `scripts/newman-smoke.sh` | Runs every request with newman against a closed port. |
| `scripts/newman-assert.js` | Checks the newman report: every request built, every variable resolved and every request refused on the closed port. |
| `scripts/upload.js` | Replaces the published collection through the Postman API. |
| `vendor/postman-collection-v2.1.0.schema.json` | Official collection schema, vendored so validation works offline. |

The Postman toolchain has its own `node_modules` on purpose: hoisting `ajv` to the repository
root breaks the copy that `spectral` compiles its rulesets with.

## Commands

Run them from this directory.

```sh
npm ci
npm run generate                 # ../openapi.json -> Mangools-API.postman_collection.json
npm run validate                 # schema, coverage, auth, variables, examples
npm run smoke                    # newman builds every request against a closed port
npm run build                    # generate + validate
npm run upload -- --dry-run      # prepare the upload request, send nothing
```

`npm run upload` without `--dry-run` needs two environment variables:

- `POSTMAN_API_KEY`: a Postman API key with write access to the collection.
- `POSTMAN_COLLECTION_UID`: the UID of the published collection, in the form `<owner id>-<collection id>`.

Without them the upload is skipped with a notice. The `mirror` workflow runs it after every spec
change, with both values taken from repository secrets.

## Variables

The collection declares two variables:

| Variable | Value | Why |
| --- | --- | --- |
| `base_url` | `servers[0].url` from the spec | Every request and saved example resolves its host from `{{base_url}}`. |
| `api_key` | empty | Filled in by the user. The validator fails if a value is shipped. |

## Authentication

The spec declares one scheme, `ApiKeyAuth`, an API key in the `x-access-token` header. The
converter maps it onto a Postman `apikey` block and the collection carries the same block at the
top level. Operations that the spec marks `"security": []` hold no block of their own and inherit
the collection-level one, so every request sends the header.

## Converter configuration

| Option | Value | Why |
| --- | --- | --- |
| `folderStrategy` | `Paths` | `Tags` duplicates every multi-tagged operation into each tag folder. |
| `requestNameSource` | `Fallback` | Names requests after the operation `summary`, which states the intent. |
| `parametersResolution` | `Example` | Prefers a declared `example` over a faked value. |
| `alwaysInheritAuthentication` | `false` | `true` strips the per-request blocks and leaves the collection without authentication. |
| `includeDeprecated` | `true` | Keeps a deprecated operation visible instead of silently dropped. |

The `postProcess` block is read by `scripts/generate.js`. It renames the converter's variables to
`base_url` and `api_key`, injects the collection-level auth block and derives stable ids. It also
sets `_postman_previewlanguage` from each example's own `Content-Type`, because
`openapi-to-postmanv2` leaves `text/html` examples on its plain-text fallback.

`npm run generate` is deterministic: the converter's `json-schema-faker` instance is seeded and
its `date-time` and `date` generators are pinned, so the same spec always yields the same
collection.

## What the validator checks

`npm run validate` exits non-zero on any failure.

1. The collection validates against the vendored Postman Collection v2.1.0 schema.
2. `postman-collection` parses it and enumerates every request.
3. Coverage is 1:1 with the spec, with no missing, extra or duplicated operation. Each request's
   query keys, path variables and request-body presence match what the spec declares.
4. The collection-level auth block is `apikey` / `x-access-token` / `{{api_key}}` / header. Every
   explicit request block matches it, and a request without one is an operation the spec marks
   `"security": []`.
5. Every request and saved example resolves its host from `{{base_url}}`, and the collection's
   `base_url` matches `servers[0].url`.
6. Every saved example previews in the language its own `Content-Type` declares: JSON, HTML, or
   text for anything else.
7. The collection declares `api_key` with an empty value.
