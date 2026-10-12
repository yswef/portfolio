/**
 * Serves the control-panel shell at the private path (ADMIN_PATH).
 *
 * Pages only calls this function when no static file matches, so the public
 * site never pays for it. The shell itself holds no data: every API call still
 * needs a logged-in session with a second factor and a CSRF token.
 */
import { adminPath, type Env } from '../src/server/env';

interface PanelEnv extends Env {
  ASSETS: { fetch(input: Request | URL | string, init?: RequestInit): Promise<Response> };
}

export const onRequest = async (context: { request: Request; env: PanelEnv }): Promise<Response> => {
  const url = new URL(context.request.url);
  const base = `/${adminPath(context.env)}`;

  if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) {
    return context.env.ASSETS.fetch(context.request);
  }

  const shell = await context.env.ASSETS.fetch(new URL('/admin-app/', url));
  const headers = new Headers(shell.headers);
  headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  headers.set('cache-control', 'no-store');
  return new Response(shell.body, { status: shell.status, headers });
};
