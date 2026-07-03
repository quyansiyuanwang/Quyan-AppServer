import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    name: 'app/files-to-lint',
    files: ['**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
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
