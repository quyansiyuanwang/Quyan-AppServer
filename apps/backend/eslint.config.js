import js from "@eslint/js";
import globals from "globals";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import configPrettier from "eslint-config-prettier";

export default [
  {
    name: "app/files-to-lint",
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  {
    name: "app/files-to-ignore",
    ignores: ["**/dist/**", "**/dist-ssr/**", "**/coverage/**", "**/*.local", "**/*.tsx", "**/*.vue"],
  },

  js.configs.recommended,

  {
    name: "app/typescript",
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    name: "app/code-quality",
    rules: {
      "no-var": "warn",
      curly: ["warn", "multi"],
    },
  },

  {
    name: "app/javascript",
    files: ["**/*.{js,mjs,cjs}"],
    rules: {
      "no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    name: "app/src-prisma-boundary",
    files: ["src/**/*.ts"],
    ignores: ["src/store/**/*.ts", "src/config/database.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/config/database",
              message: "Only store layer may import prisma from config/database.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='prisma']",
          message: "Only store layer may access prisma.*",
        },
        {
          selector: "NewExpression[callee.name='PrismaClient']",
          message: "Only src/config/database.ts may instantiate PrismaClient",
        },
      ],
    },
  },

  {
    name: "app/src-service-layer-boundary",
    files: ["src/services/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/config/database",
              message: "Service layer must access persistence via stores, not prisma client directly.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='prisma']",
          message: "Service layer must not access prisma.* directly.",
        },
        {
          selector: "NewExpression[callee.name='PrismaClient']",
          message: "Service layer must not instantiate PrismaClient.",
        },
      ],
    },
  },

  configPrettier,
];
