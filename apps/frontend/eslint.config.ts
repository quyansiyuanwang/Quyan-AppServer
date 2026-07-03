import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'

import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**', 'src/client/**', 'vite.config.d.ts', 'vite.config.js', 'openapi-ts.config.js', 'openapi-ts.config.d.ts', 'auto-imports.d.ts', 'components.d.ts', 'eslint.config.d.ts', '**/*.vue.d.ts', '**/*.vue.js']),

  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      // 禁止使用 @deprecated 标记的 API
      '@typescript-eslint/no-deprecated': 'error',

      curly: ['warn', 'multi'],
    },
  },

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'vite.config.ts',
            'vitest.config.ts',
            'eslint.config.ts',
            'openapi-ts.config.ts',
            'scripts/plugins/vite-plugin-auto-route-types.ts',
          ],
          defaultProject: './tsconfig.node.json',
        },
      },
    },
  },

  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
  },

  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      '@typescript-eslint/no-deprecated': 'off',
    },
  },

  skipFormatting,
)
