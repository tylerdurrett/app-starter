import { describe, expect, it } from 'vitest';

import vitestConfig from '../vitest.config.js';

describe('server test lifecycle configuration', () => {
  it('unwinds file hooks before shared setup-file teardown', () => {
    expect(vitestConfig).toMatchObject({
      test: {
        fileParallelism: false,
        sequence: { hooks: 'stack' },
      },
    });
  });
});
