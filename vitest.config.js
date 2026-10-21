import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 30000,
    // Tests share real database rows, so run files one after another.
    fileParallelism: false,
  },
});
