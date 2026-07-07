import { expect } from 'vitest';

interface ServiceErrorLike extends Error {
  code: string;
}

export function expectServiceError(
  error: unknown,
  code: string,
  options?: { messageIncludes?: string },
): ServiceErrorLike {
  expect(error).toBeInstanceOf(Error);

  const serviceError = error as Error & { code?: unknown };
  expect(serviceError.name).toBe('ServiceError');
  expect(serviceError.code).toBe(code);

  if (options?.messageIncludes) {
    expect(serviceError.message).toContain(options.messageIncludes);
  }

  return serviceError as ServiceErrorLike;
}

export function parseJsonBody<T>(response: { body: string }): T {
  return JSON.parse(response.body) as T;
}
