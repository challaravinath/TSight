import { defineConfig } from 'vitest/config';

// Tests write small projects, run git and parse TypeScript. Windows CI runners are much slower
// at all three than a laptop, so the 5 second default is too tight there.
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Test projects are written with LF line endings. Keep git on Windows from converting
    // them and printing a warning for every file.
    env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'false' },
  },
});
