#!/usr/bin/env node
'use strict';

/*
 * Replaces the published Postman collection with the generated one.
 *
 *   node scripts/upload.js [--dry-run]
 *
 * Needs POSTMAN_API_KEY and POSTMAN_COLLECTION_UID. Without them the upload is skipped
 * with a notice. --dry-run prepares the request and prints it without sending anything.
 */

const fs = require('fs');
const path = require('path');

const COLLECTION_PATH = path.resolve(__dirname, '..', 'Mangools-API.postman_collection.json');
const dryRun = process.argv.includes('--dry-run');

const apiKey = process.env.POSTMAN_API_KEY;
const collectionUid = process.env.POSTMAN_COLLECTION_UID;

const missing = ['POSTMAN_API_KEY', 'POSTMAN_COLLECTION_UID'].filter((name) => !process.env[name]);
if (!dryRun && missing.length) {
	console.log(`::notice::${missing.join(' and ')} not set, skipping the Postman upload.`);
	process.exit(0);
}

const collection = JSON.parse(fs.readFileSync(COLLECTION_PATH, 'utf8'));

// A collection UID is "<owner id>-<collection id>", and PUT matches on the collection id.
if (collectionUid) collection.info._postman_id = collectionUid.slice(collectionUid.indexOf('-') + 1);

const body = JSON.stringify({ collection });

if (dryRun) {
	console.log(`dry run: would PUT ${(body.length / 1024).toFixed(0)} KiB to https://api.getpostman.com/collections/${collectionUid ? '<uid>' : '<POSTMAN_COLLECTION_UID>'}`);
	console.log(`dry run: collection "${collection.info.name}", ${collection.item.length} top-level folder(s), nothing was sent`);
	process.exit(0);
}

(async () => {
	const response = await fetch(`https://api.getpostman.com/collections/${encodeURIComponent(collectionUid)}`, {
		method: 'PUT',
		headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
		body,
	});
	const text = await response.text();
	if (!response.ok) {
		console.error(`Postman answered HTTP ${response.status}: ${text}`);
		process.exit(1);
	}
	console.log(`Uploaded the collection to Postman (HTTP ${response.status}).`);
})().catch((err) => {
	console.error(`Postman upload failed: ${err.message}`);
	process.exit(1);
});
