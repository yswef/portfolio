import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle is used as the typed query layer for Cloudflare D1.
 *
 * Migrations are generated into `migrations/` and applied with Wrangler
 * (`npm run db:apply:remote`), which means no Cloudflare API token has to sit
 * on a developer machine.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
  strict: true,
  verbose: false,
});
