import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks', // required for native modules (better-sqlite3)
    include: ['../../tests/unit/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
