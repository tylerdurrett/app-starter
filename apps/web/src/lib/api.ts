const SERVER_URL = import.meta.env.VITE_SERVER_URL;
if (!SERVER_URL) {
  throw new Error('VITE_SERVER_URL environment variable is required');
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`API ${status}: ${body}`);
    this.name = 'ApiError';
  }

  /** Parse the JSON error body and return the `error` field, or null if unparseable. */
  get parsedMessage(): string | null {
    try {
      const parsed = JSON.parse(this.body);
      return parsed.error ?? null;
    } catch {
      return null;
    }
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      // Only set Content-Type when a body is present — Fastify rejects
      // Content-Type: application/json on body-less requests with a 400
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    throw new ApiError(res.status, await res.text());
  }

  if (res.status === 204) return undefined as T;

  return res.json();
}

/**
 * Structural view of a schema's parse method. Zod schemas satisfy this, so the
 * web layer can validate responses without taking a direct dependency on zod —
 * the schemas (and their inferred types) live in `@repo/shared`.
 */
export interface ResponseSchema<T> {
  parse(data: unknown): T;
}

/**
 * `apiFetch` variant that validates the JSON response against a schema and
 * throws if it does not match. Use for endpoints that return a body; body-less
 * (204) endpoints keep using {@link apiFetch}. Preserves all `apiFetch`
 * behavior (credentials, headers, `ApiError` on non-ok).
 */
export async function apiFetchParsed<T>(
  path: string,
  schema: ResponseSchema<T>,
  options?: RequestInit,
): Promise<T> {
  const json = await apiFetch<unknown>(path, options);
  return schema.parse(json);
}
