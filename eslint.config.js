import { URL, fileURLToPath } from 'node:url'
import js from '@eslint/js'

export default [
  {
    name: 'app/files-to-lint',
    files: ['**/*.{js,mjs,cjs,ts}'],
  },
  {
    name: 'app/files-to-ignore',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-ssr/**',
      '**/coverage/**',
      '**/*.local',
      'pnpm-lock.yaml',
      'apps/**',
    ],
  },
  js.configs.recommended,
]
