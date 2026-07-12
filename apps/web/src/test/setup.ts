import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

vi.stubEnv('VITE_SERVER_URL', 'http://test.local');

afterEach(() => {
  cleanup();
});
