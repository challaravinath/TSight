import { defineConfig } from 'vitest/config';

// Tests write small projects, run git and parse TypeScript. Windows CI runners are much slower
// at all three than a laptop, so the 5 second default is too tight there.
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
