#!/usr/bin/env node
/**
 * Asks the deployed site for a health report and saves it to diagnose-report.json.
 *   SITE_URL=https://your-site.pages.dev BOOTSTRAP_TOKEN=... npm run diagnose
 * Needs BOOTSTRAP_TOKEN to be set as a Cloudflare secret (the same value).
 */
import { writeFileSync } from 'node:fs';

const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '');
const token = process.env.BOOTSTRAP_TOKEN || '';
if (!siteUrl || !token) {
  console.error('Set SITE_URL and BOOTSTRAP_TOKEN first.');
  process.exit(1);
}
const response = await fetch(`${siteUrl}/api/admin/diag`, { method: 'POST', headers: { 'x-diag-token': token } });
const text = await response.text();
const out = `status: ${response.status}\n${text}\n`;
writeFileSync('diagnose-report.json', out);
console.log(out);
console.log('Saved to diagnose-report.json');
