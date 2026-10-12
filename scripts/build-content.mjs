#!/usr/bin/env node
/**
 * Validates the content snapshot before the static build.
 *
 * The snapshot is the only content source for public pages. It is written by
 * the control panel (publish step) and committed to the repository, so the
 * build never needs D1 or network access. If the file is missing or malformed
 * the build stops here with a clear message instead of rendering empty pages.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(root, 'content/snapshot.json');

if (!existsSync(file)) {
  console.error('build-content: content/snapshot.json is missing.');
  process.exit(1);
}

let snapshot;
try {
  snapshot = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`build-content: snapshot is not valid JSON (${error.message}).`);
  process.exit(1);
}

const problems = [];
if (typeof snapshot.version !== 'number') problems.push('version');
if (!snapshot.profile || typeof snapshot.profile !== 'object') problems.push('profile');
for (const key of ['projects', 'apps', 'posts', 'skills', 'learning', 'experience', 'credentials', 'socials', 'services', 'pages', 'languages']) {
  if (!Array.isArray(snapshot[key])) problems.push(key);
}
if (problems.length) {
  console.error(`build-content: snapshot is missing or malformed: ${problems.join(', ')}.`);
  process.exit(1);
}

const counts = ['projects', 'apps', 'posts', 'pages', 'services'].map((key) => `${key}=${snapshot[key].length}`);
console.log(`build-content: snapshot ok (version ${snapshot.version}; ${counts.join(', ')}).`);
