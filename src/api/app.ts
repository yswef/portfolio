/**
 * The single Hono application behind every Pages Function entry point.
 *
 * Routing note: Cloudflare Pages only invokes a function when no static asset
 * matches the request, and each entry point is scoped to one URL prefix
 * (`/api`, `/dl`, `/p`, `/d`). Pre-rendered pages therefore stay on the CDN and
 * never consume a Worker request.
 */
import { Hono } from 'hono';
import { createAdminRoutes, finalizeAdminResponse } from './admin';
import { createPublicRoutes } from './public';
import { adminPath, type Env } from '../server/env';
import { securityHeaders } from '../server/http';

export interface PagesContext {
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
  passThroughOnException?: () => void;
}

const app = new Hono<{ Bindings: Env }>();

app.onError((error, c) => {
  const message = error instanceof Error ? error.message : 'unexpected';
  // The detail stays in the logs; the client gets a short code.
  console.error('api error', { message, path: new URL(c.req.url).pathname });
  return new Response(JSON.stringify({ ok: false, error: 'internal_error' }), {
    status: 500,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
});

app.notFound((c) =>
  new Response(JSON.stringify({ ok: false, error: 'not_found', path: new URL(c.req.url).pathname }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  }),
);

app.route('/api/admin', createAdminRoutes());
app.route('/', createPublicRoutes());

/** Builds the response for one Pages Function invocation. */
export async function handleRequest(context: PagesContext): Promise<Response> {
  const env = context.env;
  const request = context.request;

  const executionCtx = {
    waitUntil: context.waitUntil ?? ((promise: Promise<unknown>) => void promise),
    passThroughOnException: context.passThroughOnException ?? (() => undefined),
    props: {},
  } as unknown as ExecutionContext;

  const response = await app.fetch(request, env, executionCtx);

  const headers = securityHeaders(env, {
    frameable: /^\/(api\/docs|p|d)\//.test(new URL(request.url).pathname),
  });
  // CORS is unnecessary: the site and the API share an origin.
  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) {
    if (!merged.has(key)) merged.set(key, value);
  }

  const finalized = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });

  // Control-panel responses additionally get a no-store policy.
  if (new URL(request.url).pathname.startsWith('/api/admin')) {
    return finalizeAdminResponse(finalized, env);
  }
  return finalized;
}

export function isControlPanelRequest(request: Request, env: Env): boolean {
  return new URL(request.url).pathname.includes(`/${adminPath(env)}`);
}

export { app };
