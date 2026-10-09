# Test Structure

- `tests/node/**/*.node.test.ts`: pure services, utilities, SDK wrappers, and composables that do not need browser globals. Node is the default Vitest environment, so these files do not initialize jsdom.
- `tests/dom/**/*.dom.test.ts`: Vue components, browser storage, event, and DOM-dependent stores/composables. Each file starts with `// @vitest-environment jsdom`, making its browser dependency explicit while keeping all tests in one scheduler and Vite transform graph.
- `tests/scripts/validate-test-taxonomy.mjs`: enforces the directory/suffix convention and prevents Vue Test Utils or DOM globals in Node tests.

Use `pnpm run test:node` for fast non-DOM feedback, `pnpm run test:dom` for UI interactions, and `pnpm run test` for the complete suite. Every one of these scripts runs `pnpm run domain-views:generate` first, because `src/router/.gen/**` is a Git-ignored generated import that `src/locales/index.ts` and the site plugins load; without it all suites fail while transforming. CI runs change-scoped suites through `pnpm run test:related <changed-files>`.

The frontend suite uses Vitest worker threads with normal per-file isolation. It intentionally does not use process forks: starting one Node process per worker is substantially slower and competes with the backend suite during the root test command.
