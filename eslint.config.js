import baseConfig from './packages/eslint-config/src/base.js';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**'],
  },
  ...baseConfig,
];
