#!/usr/bin/env node
'use strict';

/*
 * Asserts on the JSON report scripts/newman-smoke.sh produces. Every request is
 * expected to fail: the run points at a closed port, which is what proves the
 * collection never reaches the live API.
 */

const fs = require('fs');
const path = require('path');

const EXPECTED_HOST = '127.0.0.1';
const AUTH_HEADER = 'x-access-token';

const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'openapi.json'), 'utf8'));
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const EXPECTED_REQUESTS = Object.values(spec.paths).reduce(
	(sum, pathItem) => sum + HTTP_METHODS.filter((method) => pathItem[method]).length,
	0,
);

const report = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
const executions = report.run.executions || [];

const failures = [];
const outcomes = new Map();
const offHost = [];
const missingAuthHeader = [];
const unresolved = [];

for (const execution of executions) {
	const outcome = execution.requestError
		? execution.requestError.code || execution.requestError.message
		: `HTTP ${execution.response ? execution.response.code : '?'}`;
	outcomes.set(outcome, (outcomes.get(outcome) || 0) + 1);

	const request = execution.request || {};
	const label = `${request.method} /${((request.url || {}).path || []).join('/')}`;

	const host = ((request.url || {}).host || []).join('.');
	if (host !== EXPECTED_HOST) offHost.push(`${label} → ${host}`);

	const headers = (request.header || []).map((h) => String(h.key).toLowerCase());
	if (!headers.includes(AUTH_HEADER)) missingAuthHeader.push(label);

	const tokens = JSON.stringify(request).match(/\{\{[^}]+\}\}/g);
	if (tokens) unresolved.push(`${label} → ${[...new Set(tokens)].join(', ')}`);
}

if (executions.length !== EXPECTED_REQUESTS) {
	failures.push(`newman built ${executions.length} request(s), expected ${EXPECTED_REQUESTS}`);
}
for (const line of offHost) failures.push(`request left ${EXPECTED_HOST}: ${line}`);
for (const line of missingAuthHeader) failures.push(`no ${AUTH_HEADER} on the wire: ${line}`);
for (const line of unresolved) failures.push(`unresolved variable: ${line}`);
for (const [outcome, count] of outcomes) {
	if (outcome !== 'ECONNREFUSED') failures.push(`${count} request(s) ended in ${outcome}, expected ECONNREFUSED`);
}

console.log(`requests built     : ${executions.length}`);
console.log(`host on the wire   : ${[...new Set(executions.map((e) => ((e.request || {}).url || {}).host?.join('.')))].join(', ')}`);
console.log(`${AUTH_HEADER} sent : ${executions.length - missingAuthHeader.length}/${executions.length}`);
console.log(`unresolved {{vars}} : ${unresolved.length}`);
console.log('outcomes           :');
for (const [outcome, count] of outcomes) console.log(`  ${count}x ${outcome}`);

if (failures.length) {
	for (const line of failures) console.error(`FAIL ${line}`);
	console.log(`\nFAIL structural smoke — ${failures.length} problem(s)`);
	process.exit(1);
}
console.log('\nPASS structural smoke — every request built, every variable resolved, nothing left the loopback');
