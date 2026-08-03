import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Node is the inexpensive default. DOM files declare jsdom themselves so all
    // tests share one Vite transform graph and one worker scheduler.
    environment: 'node',
    globals: true,
    // Keep each test file isolated while avoiding a Node process per worker.
    // This matters when the root command runs backend tests at the same time.
    pool: 'threads',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/node/**/*.node.test.ts', 'tests/dom/**/*.dom.test.ts'],
    // Passing tests must not stream application debug output. Vitest still prints
    // that output for a failing test, where it is actionable.
    silent: 'passed-only',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
  },
})
