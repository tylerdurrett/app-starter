import type { FastifyRequest } from 'fastify';
import { auth } from '../auth.js';

/**
 * Extract the authenticated session from a Fastify request using Better Auth.
 * Returns { session, user } or null if unauthenticated.
 */
export async function getSessionFromRequest(req: FastifyRequest) {
  // Better Auth needs Web Standards Headers; Fastify provides plain-object headers.
  return auth.api.getSession({ headers: new Headers(req.headers as HeadersInit) });
}
