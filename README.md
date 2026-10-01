# Mangools API — OpenAPI specification

The official machine-readable description of the [Mangools API](https://mangools.com/api):
keyword research (KWFinder), SERP analysis (SERPChecker), rank tracking (SERPWatcher),
backlink analysis (LinkMiner), site metrics (SiteProfiler) and AI Search Watcher.

`openapi.json` in this repository is an **OpenAPI 3.0.3** document. It is a mirror of the
live API description: a scheduled workflow downloads it every day and commits it when it
changed. **Do not edit `openapi.json` by hand**, the next run overwrites it.

- Live document: <https://api.mangools.com/v3/openapi.json>
- API documentation: <https://apidocs.mangools.com>
- Postman workspace: <https://www.postman.com/mangools-7057526/mangools-api>

## Where to get it

The API serves the document itself, at two URLs that return **the same bytes**:

```bash
curl -sS https://api.mangools.com/v3/openapi.json -o openapi.json   # canonical
curl -sS https://api.mangools.com/v3/swagger.json -o openapi.json   # the older name, same document
```

Either one is live and always current. The copy in this repository is the same document,
kept here so that it can be browsed, diffed and linked to.

## Authentication

Every non-public operation takes an API key in the **`x-access-token`** request header:

```bash
curl -sS https://api.mangools.com/v3/kwfinder/requests \
  -H "x-access-token: $MANGOOLS_API_KEY"
```

This is a plain API key, **not** an RFC 6750 `Authorization: Bearer` token. Generated
clients must be configured to send the `x-access-token` header — the spec declares this as
the `ApiKeyAuth` security scheme, so most generators wire it up for you.

Use an operation that requires a key, like the one above, when you want to check that a key
works. `GET /kwfinder/limits` is not that operation: its authentication is optional, so it
answers a request with a missing or unrecognised key with HTTP 200 and every limit reported
as zero. Anything that treats a 2xx as proof of a valid key will pass on a broken one.

Keys are issued in your Mangools account. Never commit one.

## Consuming the spec

### Generate a client

```bash
# TypeScript / JavaScript
npx @openapitools/openapi-generator-cli generate \
  -i https://api.mangools.com/v3/openapi.json \
  -g typescript-fetch -o ./mangools-client

# Python
npx @openapitools/openapi-generator-cli generate \
  -i https://api.mangools.com/v3/openapi.json \
  -g python -o ./mangools-client

# Go
npx @openapitools/openapi-generator-cli generate \
  -i https://api.mangools.com/v3/openapi.json \
  -g go -o ./mangools-client
```

Every operation carries an `operationId`, which is what generators turn into method
names. They are tool-prefixed (`get-kwfinder-serps`, `get-serpchecker-serps`) because the
same resource name appears under several tools. Generators re-case them to fit the target
language — `getKwfinderSerps` in TypeScript, `get_kwfinder_serps` in Python.

### Import into Postman or Insomnia

The collection is built from `openapi.json` and published in the
[Postman workspace](https://www.postman.com/mangools-7057526/mangools-api), where it is updated
whenever the spec changes. Set the collection variable `api_key` to your key.

To build one yourself instead, in Postman choose **Import → Link →**
`https://api.mangools.com/v3/openapi.json`. Insomnia: **Create → Import From → URL**, same URL.

### Official SDKs

Published SDKs wrap this spec and handle authentication and errors for you:

- TypeScript: [`mangools-api-client`](https://www.npmjs.com/package/mangools-api-client), source at <https://github.com/mangools/api-client-typescript>.
- Python: [`mangools`](https://pypi.org/project/mangools/), source at <https://github.com/mangools/sdk-python>.

## How this repository is built

The API server assembles its OpenAPI description at runtime and serves it at
`/v3/openapi.json`. That served document is the only place the description is written. This
repository never holds a second editable copy.

- `.github/workflows/mirror.yml` runs daily at 04:00 UTC. It downloads the live document with
  `scripts/generate.sh`, lints it, and commits `openapi.json` when the content changed.
- The same workflow builds the Postman collection from the fetched spec and uploads it to the
  Postman workspace. The collection is a build output and is not stored in git.
- `.github/workflows/spec-ci.yml` lints the mirror and builds the collection on every pull
  request and on every push to `main`.

## Running the checks locally

```bash
npm ci
npm run generate          # download the live spec into openapi.json
npm run mirror:status     # report whether openapi.json differs from the live API
npm run lint              # redocly (strict) + spectral, zero errors and zero warnings
npm ci --prefix postman
npm run postman:dry-run   # build and validate the collection, upload nothing
npm run postman:smoke     # newman builds every request against a closed port
```

The Postman toolchain lives in [`postman/`](postman/README.md) and keeps its own
`node_modules` on purpose: hoisting `ajv` to the root breaks the copy that `spectral` bundles.

## Reporting a problem with the spec

If the description does not match what the API does, such as a wrong type, a missing property
or an operation that is documented but rejected, write to
[support@mangools.com](mailto:support@mangools.com) with the `operationId` or the path and
method, the request you sent (**with the API key redacted**) and what the API returned. This
repository is maintained by the Mangools team and does not accept external pull requests or
issues.

## Licence

The specification is published under the [Apache License 2.0](LICENSE). Use of the API
itself is governed by the [Mangools terms and conditions](https://mangools.com/conditions).
