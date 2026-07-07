import baseConfig from '@repo/eslint-config/base';

// ESLint 9 resolves config from the package cwd, so each linted package needs
// this local wrapper even when all rules come from the shared workspace config.
export default [...baseConfig];
