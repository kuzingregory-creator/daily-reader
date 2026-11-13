import { defineConfig } from 'vitest/config';

// Tests need no build plugins (Preact, PWA): a bare config starts much faster.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
