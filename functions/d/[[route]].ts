import { handleRequest, type PagesContext } from '../../src/api/app';

export const onRequest = (context: PagesContext) => handleRequest(context);
