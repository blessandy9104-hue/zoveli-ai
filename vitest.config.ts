import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '**/*.d.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        'tests/**',
        '**/vitest.*.ts',
        '**/tsdown.config.ts'
      ],
      // Enforced baseline (measured 2026-10-28 on the full suite):
      // lines 72.98, statements 71.24, functions 72.23, branches 59.67.
      // Keep a small margin for cross-platform variance; ratchet upward as
      // coverage improves.
      thresholds: {
        lines: 72,
        functions: 71,
        branches: 58,
        statements: 70
      }
    },
    testTimeout: 30000,
    hookTimeout: 10000,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 4
      }
    },
    reporters: ['verbose', 'json', 'html'],
    outputFile: {
      json: './test-results.json',
      html: './test-report.html'
    }
  },
  resolve: {
    // NOTE: `@zoveli/*` maps to local package sources; the old glob-based
    // mapping resolved to a literal `packages/*/src` path and never worked.
    alias: [
      {
        find: /^@zoveli\/([^/]+)\/src(.*)$/,
        replacement: path.resolve(__dirname, 'packages/$1/src$2'),
      },
    ],
  }
});