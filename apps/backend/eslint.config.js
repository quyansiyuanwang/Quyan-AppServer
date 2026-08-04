import js from "@eslint/js";
import globals from "globals";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import configPrettier from "eslint-config-prettier";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const backendLocalePath = path.join(__dirname, "src/locales/en.ts");
let backendMessageKeysCache = new Set();
let backendMessageKeysMtimeMs = -1;

function loadBackendMessageKeys() {
  const localesSource = readFileSync(backendLocalePath, "utf8");
  const enMessagesMatch = localesSource.match(/const en = \{([\s\S]*?)\n\} as const;/);
  if (!enMessagesMatch) return new Set();

  const keys = new Set();
  const stack = [];

  for (const line of enMessagesMatch[1].split("\n")) {
    const indent = line.match(/^ */)?.[0].length ?? 0;
    const level = indent / 2 - 1;
    const propertyMatch = line.match(/^\s*([A-Za-z_$][\w$]*|"(?:\\.|[^"])+"):\s*(.*)$/);
    if (!propertyMatch) continue;

    const rawKey = propertyMatch[1];
    const key = rawKey.startsWith('"') ? JSON.parse(rawKey) : rawKey;
    stack[level] = key;
    stack.length = level + 1;

    if (!propertyMatch[2].trim().startsWith("{")) keys.add(stack.join("."));
  }

  return keys;
}

function getBackendMessageKeys() {
  const mtimeMs = statSync(backendLocalePath).mtimeMs;
  if (mtimeMs !== backendMessageKeysMtimeMs) {
    backendMessageKeysCache = loadBackendMessageKeys();
    backendMessageKeysMtimeMs = mtimeMs;
  }

  return backendMessageKeysCache;
}

function getStaticPropertyName(node) {
  if (!node) return undefined;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return undefined;
}

function getStaticString(node) {
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
}

function isBackendI18nMember(node, methodNames) {
  if (!node || node.type !== "MemberExpression") return false;
  if (node.object.type !== "Identifier" || node.object.name !== "backendI18n") return false;
  return methodNames.has(getStaticPropertyName(node.property));
}

function getObjectPropertyStringValue(node, propertyName) {
  if (!node || node.type !== "ObjectExpression") return undefined;

  const property = node.properties.find(
    (item) => item.type === "Property" && getStaticPropertyName(item.key) === propertyName,
  );
  return property?.type === "Property" ? getStaticString(property.value) : undefined;
}

const backendI18nPlugin = {
  rules: {
    "known-message-key": {
      meta: {
        type: "problem",
        docs: {
          description: "Require backend i18n keys to exist in the locale catalog.",
        },
        schema: [],
        messages: {
          unknownKey: "Backend i18n key '{{key}}' does not exist in apps/backend/src/locales/en.ts.",
        },
      },
      create(context) {
        function reportIfUnknown(node, key) {
          if (!key || getBackendMessageKeys().has(key)) return;
          context.report({ node, messageId: "unknownKey", data: { key } });
        }

        return {
          Property(node) {
            const propertyName = getStaticPropertyName(node.key);
            if (propertyName !== "messageKey") return;

            reportIfUnknown(node.value, getStaticString(node.value));
          },
          CallExpression(node) {
            if (node.callee.type === "Identifier") {
              if (["translateMessage", "setResponseMessageKey"].includes(node.callee.name))
                reportIfUnknown(node.arguments[0], getStaticString(node.arguments[0]));
              if (node.callee.name === "translateDescriptor")
                reportIfUnknown(node.arguments[0], getObjectPropertyStringValue(node.arguments[0], "key"));
              if (["createMessageDescriptor", "createMessageOptions"].includes(node.callee.name))
                reportIfUnknown(node.arguments[0], getStaticString(node.arguments[0]));
              return;
            }

            if (isBackendI18nMember(node.callee, new Set(["t", "descriptor", "errorOptions"])))
              reportIfUnknown(node.arguments[0], getStaticString(node.arguments[0]));
          },
        };
      },
    },
  },
};

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
      parserOptions: {
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "backend-i18n": backendI18nPlugin,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "backend-i18n/known-message-key": "error",
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
    name: "app/test-unit-prisma-boundary",
    files: ["tests/unit/**/*.unit.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/config/database",
              message: "Pure unit tests must mock persistence boundaries instead of importing the Prisma runtime.",
            },
          ],
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
