#!/usr/bin/env node
/**
 * Creates the first administrator on a fresh deployment.
 *
 * Usage (values are read from the environment or prompted, never stored):
 *   SITE_URL=https://example.pages.dev BOOTSTRAP_TOKEN=... node scripts/create-admin.mjs
 *
 * The server only accepts this once (while the users table is empty) and only
 * with the BOOTSTRAP_TOKEN secret that is also set in Cloudflare. The response
 * contains the TOTP secret and recovery codes, which must be stored safely.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '');
const token = process.env.BOOTSTRAP_TOKEN || '';
if (!siteUrl) {
  console.error('Set SITE_URL to the deployed address first.');
  process.exit(1);
}
if (!token) {
  console.error('Set BOOTSTRAP_TOKEN (the same value stored as a Cloudflare secret).');
  process.exit(1);
}

const rl = createInterface({ input: stdin, output: stdout });
const username = process.env.ADMIN_USERNAME || (await rl.question('Username: ')).trim();
const password = process.env.ADMIN_PASSWORD || (await rl.question('Password (12+ characters, mixed): ')).trim();
rl.close();

const response = await fetch(`${siteUrl}/api/admin/bootstrap`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password, bootstrapSecret: token }),
});
const body = await response.json().catch(() => ({}));

if (!response.ok) {
  console.error(`Failed (${response.status}): ${body.error || 'unknown error'}`);
  if (body.problems) console.error(`Password issues: ${body.problems.join(', ')}`);
  process.exit(1);
}

console.log('\nAdministrator created. Next steps:');
console.log('1. Add the TOTP secret below to an authenticator app (Google Authenticator, Microsoft Authenticator, ...).');
console.log(`   Secret: ${body.totpSecret}`);
console.log(`   Link:   ${body.otpauthUrl}`);
console.log('2. Save these recovery codes somewhere private. Each works once.');
for (const code of body.recoveryCodes ?? []) console.log(`   ${code}`);
console.log('3. Remove BOOTSTRAP_TOKEN from Cloudflare secrets now that the account exists.');
