// Starts the backend with the process-level overrides required by the
// privilege-free localhost development mode. The committed .env keeps the
// multi-domain values so `pnpm run dev:domains` stays unchanged.
//
// This file is an entry point only and runs at import time; the shared values
// live in `scripts/lib/dev-local-env.mjs`.

import { localBackendOverrides } from './lib/dev-local-env.mjs'
import { resolvePnpmInvocation, spawnForeground } from './lib/platform.mjs'

const invocation = resolvePnpmInvocation()

const exitCode = await spawnForeground(
  invocation.command,
  [...invocation.arguments, '--filter', '@quyan/backend', 'run', 'dev'],
  { env: localBackendOverrides, shell: invocation.shell },
)

process.exitCode = exitCode
