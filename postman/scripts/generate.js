#!/usr/bin/env node
'use strict';

/*
 * Generates Mangools-API.postman_collection.json from the repository's openapi.json.
 *
 * Run via `npm run generate`. The collection is a build output and is not committed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Required before openapi-to-postmanv2 fakes any value: the converter shares this
// json-schema-faker instance, and unseeded it emits a different collection per run.
const schemaFaker = require('openapi-to-postmanv2/assets/json-schema-faker.js');
const converter = require('openapi-to-postmanv2');

const ROOT = path.resolve(__dirname, '..');
const SPEC_PATH = path.resolve(ROOT, '..', 'openapi.json');
const CONFIG_PATH = path.join(ROOT, 'config', 'openapi-to-postman.json');
const OUT_PATH = path.join(ROOT, 'Mangools-API.postman_collection.json');

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const { options, postProcess: pp } = config;

function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function uuidFrom(input) {
	const h = crypto.createHash('sha1').update(input).digest('hex');
	return [h.slice(0, 8), h.slice(8, 12), '5' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
}

const stats = {
	requests: 0,
	folders: 0,
	baseUrlTokens: 0,
	apiKeyTokens: 0,
	exampleAuthHeaders: 0,
	requestsWithAuth: 0,
	requestsWithoutAuth: [],
	savedExamples: 0,
	previewLanguageFixed: 0,
};

function eachItem(items, visit, trail = []) {
	for (const item of items) {
		if (item.item) {
			stats.folders++;
			visit(item, trail, 'folder');
			eachItem(item.item, visit, trail.concat(item.name));
		} else if (item.request) {
			stats.requests++;
			visit(item, trail, 'request');
		}
	}
}

function retokeniseUrl(url) {
	if (!url) return;
	if (Array.isArray(url.host)) {
		url.host = url.host.map((h) => {
			if (h === '{{baseUrl}}') {
				stats.baseUrlTokens++;
				return `{{${pp.baseUrlVariable}}}`;
			}
			return h;
		});
	}
	if (typeof url.raw === 'string' && url.raw.includes('{{baseUrl}}')) {
		url.raw = url.raw.split('{{baseUrl}}').join(`{{${pp.baseUrlVariable}}}`);
	}
}

function retokeniseAuth(auth) {
	if (!auth || auth.type !== 'apikey' || !Array.isArray(auth.apikey)) return false;
	for (const entry of auth.apikey) {
		if (entry.key === 'value' && entry.value === '{{apiKey}}') {
			entry.value = `{{${pp.apiKeyVariable}}}`;
			stats.apiKeyTokens++;
		}
	}
	return true;
}

function retokeniseExampleHeaders(headers) {
	if (!Array.isArray(headers)) return;
	for (const header of headers) {
		if (String(header.key).toLowerCase() === pp.apiKeyHeader && header.value === '<API Key>') {
			header.value = `{{${pp.apiKeyVariable}}}`;
			stats.exampleAuthHeaders++;
		}
	}
}

// openapi-to-postmanv2 declares PREVIEW_LANGUAGE.HTML but assigns it nowhere —
// getHeaderFamily() only recognises json and xml — so a text/html example is left
// on the 'text' fallback and Postman shows its body unhighlighted.
function fixPreviewLanguage(example) {
	const contentType = (example.header || []).find((h) => String(h.key).toLowerCase() === 'content-type');
	if (contentType && /^text\/html\b/i.test(contentType.value) && example._postman_previewlanguage !== 'html') {
		example._postman_previewlanguage = 'html';
		stats.previewLanguageFixed++;
	}
}

function convert(spec) {
	return new Promise((resolve, reject) => {
		schemaFaker.option({ random: mulberry32(pp.fakerSeed) });
		// json-schema-faker derives date-time/date from the wall clock, so pin them too.
		schemaFaker.format('date-time', () => pp.fakedDateTime);
		schemaFaker.format('date', () => pp.fakedDate);

		converter.convert({ type: 'string', data: spec }, options, (err, result) => {
			if (err) return reject(err);
			if (!result.result) return reject(new Error(`conversion failed: ${result.reason}`));
			resolve(result);
		});
	});
}

async function main() {
	const spec = fs.readFileSync(SPEC_PATH, 'utf8');

	const validation = converter.validate({ type: 'string', data: spec });
	console.log(`spec validation : result=${validation.result}${validation.reason ? ` reason=${validation.reason}` : ''}`);

	const conversion = await convert(spec);
	const collection = conversion.output[0].data;

	collection.info.name = pp.collectionName;
	collection.info._postman_id = pp.collectionId;

	collection.auth = {
		type: 'apikey',
		apikey: [
			{ key: 'key', value: pp.apiKeyHeader, type: 'string' },
			{ key: 'value', value: `{{${pp.apiKeyVariable}}}`, type: 'string' },
			{ key: 'in', value: 'header', type: 'string' },
		],
	};

	collection.variable = [
		{ key: pp.baseUrlVariable, value: JSON.parse(spec).servers[0].url, type: 'string' },
		{ key: pp.apiKeyVariable, value: '', type: 'string' },
	];

	eachItem(collection.item, (item, trail, kind) => {
		const id = `${trail.join('/')}/${kind}:${item.name}`;
		item.id = uuidFrom(id);
		if (kind !== 'request') return;

		retokeniseUrl(item.request.url);
		if (retokeniseAuth(item.request.auth)) {
			stats.requestsWithAuth++;
		} else {
			stats.requestsWithoutAuth.push(`${item.request.method} /${trail.join('/')} — ${item.name}`);
		}

		for (const [index, example] of (item.response || []).entries()) {
			stats.savedExamples++;
			example.id = uuidFrom(`${id}#response:${index}:${example.name}`);
			retokeniseUrl(example.originalRequest && example.originalRequest.url);
			retokeniseExampleHeaders(example.originalRequest && example.originalRequest.header);
			fixPreviewLanguage(example);
		}
	});

	fs.writeFileSync(OUT_PATH, JSON.stringify(collection, null, 2) + '\n');

	console.log(`written        : ${path.relative(ROOT, OUT_PATH)}`);
	console.log(`requests       : ${stats.requests}`);
	console.log(`folders        : ${stats.folders}`);
	console.log(`saved examples : ${stats.savedExamples}`);
	console.log(`{{base_url}}   : ${stats.baseUrlTokens} url hosts retokenised`);
	console.log(`{{api_key}}    : ${stats.apiKeyTokens} request auth blocks + ${stats.exampleAuthHeaders} example headers retokenised`);
	console.log(`preview lang   : ${stats.previewLanguageFixed} text/html example(s) moved off the converter's 'text' fallback`);
	console.log(`auth explicit  : ${stats.requestsWithAuth}/${stats.requests}`);
	if (stats.requestsWithoutAuth.length) {
		console.log(`auth inherited : ${stats.requestsWithoutAuth.length} (spec declares "security": [], so they fall back to the collection-level block)`);
		for (const line of stats.requestsWithoutAuth) console.log(`  - ${line}`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
