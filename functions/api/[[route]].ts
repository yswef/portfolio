/**
 * Pages Function entry point for `/api/*`.
 * Static assets are unaffected: Pages only calls this when nothing matches.
 */
import { handleRequest, type PagesContext } from '../../src/api/app';

export const onRequest = (context: PagesContext) => handleRequest(context);
