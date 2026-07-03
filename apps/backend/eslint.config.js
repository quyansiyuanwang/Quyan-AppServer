import js from "@eslint/js";
import globals from "globals";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

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
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  {
    name: "app/general-rules",
    rules: {
      // complexity: ["warn", 30],
      quotes: ["warn", "double", { allowTemplateLiterals: true, avoidEscape: true }],
      semi: ["warn", "always"],
      indent: ["warn", 2, { SwitchCase: 1 }],
      "no-trailing-spaces": "warn",
      "no-unused-vars": "off",
      "arrow-spacing": ["warn", { before: true, after: true }],
      "no-var": "warn",
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

  {
    rules: {
      curly: ["warn", "multi"],
    },
  },
];
