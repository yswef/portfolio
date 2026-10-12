# Portfolio

Bilingual (Arabic / English) portfolio, application downloads and private control
panel. Static pages are pre-rendered with Astro; dynamic parts run as Cloudflare
Pages Functions on D1 and KV.

- Deployment guide (Arabic, step by step): [`docs/DEPLOY.ar.md`](docs/DEPLOY.ar.md)
- Windows build template for PyInstaller projects: [`templates/build-windows.yml`](templates/build-windows.yml)

## Stack

Astro, TypeScript, Svelte 5 (interactive parts and the control panel), Hono (API),
Drizzle with D1, Three.js (background scene), marked (Markdown).

## Development

```bash
npm ci
npm run dev        # local preview on http://localhost:4321
npm run build      # validates content/snapshot.json, then builds dist/
npm test           # unit and route tests
npx astro check    # type checks, including Svelte components
```

The Functions (`/api`, `/dl`, `/p`, `/d` and the control panel) run only on Cloudflare
(or `wrangler pages dev`), not in `astro dev`.

## Layout

- `src/pages`, `src/views`, `src/components`: public site
- `src/admin`: control panel (Svelte 5), served at the private `ADMIN_PATH`
- `src/api`: Hono routes (`admin.ts`, `public.ts`), mounted by `functions/`
- `src/server`: auth, sync with GitHub, analytics, downloads, pages storage
- `migrations/`: D1 schema; `content/snapshot.json`: the content the static build uses
- `scripts/`: content validation, first administrator, publish check
- `tests/`: critical paths (auth, guards, routing, sync helpers, downloads)
