#!/usr/bin/env node
'use strict';

/*
 * Gate for the generated collection. Exits non-zero on
 * any failure so it can run unchanged in CI.
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv-draft-04');
const addFormats = require('ajv-formats');
const { Collection } = require('postman-collection');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const spec = JSON.parse(fs.readFileSync(path.resolve(ROOT, '..', 'openapi.json'), 'utf8'));
const collection = read('Mangools-API.postman_collection.json');
const config = read('config/openapi-to-postman.json');
const pp = config.postProcess;
const API_KEY_TOKEN = `{{${pp.apiKeyVariable}}}`;
const BASE_URL_TOKEN = `{{${pp.baseUrlVariable}}}`;

// Operations the spec leaves unauthenticated; any other request without an auth block is a defect.
const isPublic = (op) => (op.security ? op.security.length === 0 : !spec.security);
const EXPECTED_UNAUTHENTICATED = new Set(
	Object.entries(spec.paths).flatMap(([specPath, pathItem]) =>
		['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
			.filter((method) => pathItem[method] && isPublic(pathItem[method]))
			.map((method) => `${method.toUpperCase()} ${specPath}`),
	),
);


const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);
const note = (msg) => notes.push(msg);

/* ---------- 1. Postman Collection v2.1.0 JSON Schema ---------- */

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);
const schema = read('vendor/postman-collection-v2.1.0.schema.json');
const validateSchema = ajv.compile(schema);
if (validateSchema(collection)) {
	note(`schema     : valid against Postman Collection v2.1.0 (${schema.$id || schema.id})`);
} else {
	fail(`schema     : ${validateSchema.errors.length} violation(s)`);
	for (const err of validateSchema.errors.slice(0, 20)) fail(`             ${err.instancePath || '/'} ${err.message}`);
}

if (collection.info.schema !== 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json') {
	fail(`schema     : info.schema is "${collection.info.schema}", expected the v2.1.0 collection schema URL`);
}

/* ---------- 2. postman-collection SDK parse ---------- */

let sdkRequestCount = 0;
try {
	const parsed = new Collection(collection);
	parsed.forEachItem(() => sdkRequestCount++);
	note(`sdk parse  : postman-collection loaded the document, ${sdkRequestCount} request(s) enumerated`);
} catch (err) {
	fail(`sdk parse  : ${err.message}`);
}

/* ---------- 3. Coverage: every spec operation present exactly once ---------- */

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const specOperations = new Set();
const specShapes = new Map();
for (const [specPath, pathItem] of Object.entries(spec.paths)) {
	for (const method of HTTP_METHODS) {
		const operation = pathItem[method];
		if (!operation) continue;
		const key = `${method.toUpperCase()} ${specPath}`;
		specOperations.add(key);
		const parameters = [...(pathItem.parameters || []), ...(operation.parameters || [])];
		const names = (where) => [...new Set(parameters.filter((p) => p.in === where).map((p) => p.name))].sort();
		specShapes.set(key, { query: names('query'), path: names('path'), body: Boolean(operation.requestBody) });
	}
}

const requests = [];
(function walk(items, trail) {
	for (const item of items) {
		if (item.item) walk(item.item, trail.concat(item.name));
		else if (item.request) requests.push({ item, trail });
	}
})(collection.item, []);

const seen = new Map();
for (const { item } of requests) {
	const segments = (item.request.url.path || []).map((s) => (s.startsWith(':') ? `{${s.slice(1)}}` : s));
	const key = `${item.request.method} /${segments.join('/')}`;
	seen.set(key, (seen.get(key) || 0) + 1);
}

const missing = [...specOperations].filter((op) => !seen.has(op));
const extra = [...seen.keys()].filter((op) => !specOperations.has(op));
const duplicated = [...seen.entries()].filter(([, n]) => n > 1);

if (requests.length !== specOperations.size) {
	fail(`coverage   : ${requests.length} request(s) for ${specOperations.size} spec operation(s)`);
}
for (const op of missing) fail(`coverage   : spec operation missing from collection — ${op}`);
for (const op of extra) fail(`coverage   : collection request not in spec — ${op}`);
for (const [op, n] of duplicated) fail(`coverage   : ${op} appears ${n} times`);
if (!failures.length) {
	note(`coverage   : ${requests.length}/${specOperations.size} operations across ${Object.keys(spec.paths).length} paths, 1:1`);
}

// Matching METHOD and path is not enough: a parameter can move between query, path
// and body without either set changing. Compare the shapes too.
let shapeMismatches = 0;
const sameSet = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
for (const { item } of requests) {
	const url = item.request.url;
	const segments = (url.path || []).map((s) => (s.startsWith(':') ? `{${s.slice(1)}}` : s));
	const key = `${item.request.method} /${segments.join('/')}`;
	const shape = specShapes.get(key);
	if (!shape) continue;
	const query = [...new Set((url.query || []).map((q) => q.key))].sort();
	const pathVars = [...new Set((url.variable || []).map((v) => v.key))].sort();
	const hasBody = Boolean(item.request.body && item.request.body.mode);
	if (!sameSet(query, shape.query)) {
		fail(`coverage   : ${key} query is [${query}], spec declares [${shape.query}]`);
		shapeMismatches++;
	}
	if (!sameSet(pathVars, shape.path)) {
		fail(`coverage   : ${key} path variables are [${pathVars}], spec declares [${shape.path}]`);
		shapeMismatches++;
	}
	if (hasBody !== shape.body) {
		fail(`coverage   : ${key} ${hasBody ? 'carries' : 'has no'} request body, spec says ${shape.body ? 'it should' : 'it should not'}`);
		shapeMismatches++;
	}
}
if (!shapeMismatches) {
	note(`coverage   : every request's query, path variables and request body match the spec's parameter placement`);
}

/* ---------- 4. Auth wiring ---------- */

function apiKeyAuthProblem(auth) {
	if (!auth) return 'no auth block';
	if (auth.type !== 'apikey') return `auth.type is "${auth.type}"`;
	const entries = Object.fromEntries((auth.apikey || []).map((e) => [e.key, e.value]));
	if (entries.key !== pp.apiKeyHeader) return `header name is "${entries.key}"`;
	if (entries.value !== API_KEY_TOKEN) return `value is "${entries.value}"`;
	if (entries.in !== 'header') return `sent in "${entries.in}"`;
	return null;
}

const collectionAuthProblem = apiKeyAuthProblem(collection.auth);
if (collectionAuthProblem) fail(`auth       : collection-level auth — ${collectionAuthProblem}`);
else note(`auth       : collection-level apikey ${pp.apiKeyHeader}=${API_KEY_TOKEN}`);

// An item with no auth block inherits the collection's; only an explicit block can
// diverge from it, so "no block" is a pass and `noauth` is a failure.
const inheriting = [];
let explicit = 0;
for (const { item } of requests) {
	const segments = (item.request.url.path || []).map((s) => (s.startsWith(':') ? `{${s.slice(1)}}` : s));
	const key = `${item.request.method} /${segments.join('/')}`;
	if (item.request.auth === null || item.request.auth === undefined) {
		inheriting.push(key);
		continue;
	}
	const problem = apiKeyAuthProblem(item.request.auth);
	if (problem) fail(`auth       : ${key} — ${problem}`);
	else explicit++;
}

for (const key of inheriting.filter((k) => !EXPECTED_UNAUTHENTICATED.has(k))) {
	fail(`auth       : ${key} has no explicit auth block and is not a known "security": [] operation`);
}
for (const key of [...EXPECTED_UNAUTHENTICATED].filter((k) => !inheriting.includes(k))) {
	fail(`auth       : ${key} is marked "security": [] in the spec but carries an auth block`);
}
if (!collectionAuthProblem) {
	note(`auth       : ${explicit + inheriting.length}/${requests.length} requests send ${pp.apiKeyHeader}=${API_KEY_TOKEN} (${explicit} explicit, ${inheriting.length} inherited)`);
}
for (const key of inheriting) {
	if (EXPECTED_UNAUTHENTICATED.has(key)) note(`auth       : ${key} inherits ${pp.apiKeyHeader} — spec says "security": []`);
}

/* ---------- 5. Base URL wiring ---------- */

const declared = new Set((collection.variable || []).map((v) => v.key));
if (!declared.has(pp.baseUrlVariable)) fail(`variables  : collection does not declare ${pp.baseUrlVariable}`);

let badHosts = 0;
for (const { item } of requests) {
	const host = (item.request.url.host || []).join('');
	if (host !== BASE_URL_TOKEN) {
		fail(`variables  : ${item.request.method} ${item.name} — host is "${host}", expected ${BASE_URL_TOKEN}`);
		badHosts++;
	}
	for (const example of item.response || []) {
		const exampleHost = ((example.originalRequest || {}).url || {}).host;
		if (exampleHost && exampleHost.join('') !== BASE_URL_TOKEN) {
			fail(`variables  : saved example "${example.name}" — host is "${exampleHost.join('')}"`);
			badHosts++;
		}
	}
}
if (!badHosts) note(`variables  : every request and saved example resolves its host from ${BASE_URL_TOKEN}`);

const baseUrlVar = (collection.variable || []).find((v) => v.key === pp.baseUrlVariable);
if (baseUrlVar && baseUrlVar.value !== spec.servers[0].url) {
	fail(`variables  : collection ${pp.baseUrlVariable}="${baseUrlVar.value}" but spec servers[0].url="${spec.servers[0].url}"`);
}

/* ---------- 6. Saved-example preview languages ---------- */

// The converter leaves a text/html example on its 'text' fallback; generate.js corrects it.
const previewLanguage = (type) => (type === 'text/html' ? 'html' : type.includes('json') ? 'json' : 'text');
let badPreview = 0;
const previewCounts = new Map();
for (const { item } of requests) {
	for (const example of item.response || []) {
		const contentType = (example.header || []).find((h) => String(h.key).toLowerCase() === 'content-type');
		const type = contentType ? contentType.value.split(';')[0].trim().toLowerCase() : '(none)';
		const expected = previewLanguage(type);
		previewCounts.set(type, (previewCounts.get(type) || 0) + 1);
		if (example._postman_previewlanguage !== expected) {
			fail(`examples   : ${item.request.method} ${item.name} — ${type} example previews as "${example._postman_previewlanguage}", expected "${expected}"`);
			badPreview++;
		}
	}
}
if (!badPreview) {
	const census = [...previewCounts].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n}x ${t}`).join(', ');
	note(`examples   : every saved example previews in the language its Content-Type declares (${census})`);
}

/* ---------- 7. Collection variables ---------- */

const apiKeyVar = (collection.variable || []).find((v) => v.key === pp.apiKeyVariable);
if (!apiKeyVar) fail(`variables  : collection does not declare ${pp.apiKeyVariable}`);
else if (apiKeyVar.value !== '') fail(`variables  : collection ships a non-empty ${pp.apiKeyVariable}`);
else note(`variables  : collection declares ${pp.apiKeyVariable} with an empty value`);

/* ---------- report ---------- */

for (const line of notes) console.log(`ok   ${line}`);
for (const line of failures) console.error(`FAIL ${line}`);
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
