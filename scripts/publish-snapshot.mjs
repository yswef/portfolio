#!/usr/bin/env node
/**
 * Checks that the publish flow is ready to run.
 *
 * Publishing itself happens inside the control panel ("نشر المحتوى"), which
 * writes content/snapshot.json to the repository through the GitHub API and
 * lets Cloudflare Pages rebuild. This script only validates the local state so
 * a broken snapshot is caught before it reaches the repository.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [resolve(root, 'scripts/build-content.mjs')], { stdio: 'inherit' });
console.log('publish-snapshot: ready. Use "نشر المحتوى" in the control panel to commit the snapshot.');
