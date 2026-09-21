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
const backendErrorsPath = path.join(__dirname, "src/util/errors.ts");
let backendMessageKeysCache = new Set();
let backendMessageKeysMtimeMs = -1;
let backendApiErrorClassesCache = null;
let backendErrorsMtimeMs = -1;

/**
 * 面向用户的 API 错误类集合，从 `src/util/errors.ts` 推导（单一事实来源）：
 * 取所有继承自 `ApiError` 的导出类，按继承关系求传递闭包。
 *
 * 刻意**不**按名字猜测——`src` 中还有继承裸 `Error` 的内部错误类
 * （例如 `CaptchaProviderUnavailableError`、`RelayFormatTransformError`），
 * 它们的消息不会到达客户端，不应被本规则约束。
 */
function loadBackendApiErrorClasses() {
  const source = readFileSync(backendErrorsPath, "utf8");
  const parents = new Map();
  for (const match of source.matchAll(/export class (\w+)(?:<[^>]*>)? extends (\w+)/g)) {
    parents.set(match[1], match[2]);
  }

  const isApiError = (name, seen = new Set()) => {
    if (name === "ApiError") return true;
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return isApiError(parents.get(name), seen);
  };

  return new Set([...parents.keys()].filter((name) => isApiError(name)));
}

function getBackendApiErrorClasses() {
  const mtimeMs = statSync(backendErrorsPath).mtimeMs;
  if (mtimeMs !== backendErrorsMtimeMs) {
    backendApiErrorClassesCache = loadBackendApiErrorClasses();
    backendErrorsMtimeMs = mtimeMs;
  }
  return backendApiErrorClassesCache;
}

/**
 * 构造函数内部就固定携带描述符的类：调用点无需再传 `messageKey`。
 * 与 `tests/unit/locales` 的口径、以及迁移统计脚本保持一致。
 */
const INTERNALLY_KEYED_ERROR_CLASSES = new Set([
  "ContentSafetyBlockedError",
  "TwoFactorRequiredError",
  "PolicyConsentRequiredError",
]);

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

/** 不带插值的模板字面量 `\`text\`` 视为静态原文 */
function isStaticLiteralText(node) {
  if (!node) return false;
  if (node.type === "Literal" && typeof node.value === "string") return true;
  return node.type === "TemplateLiteral" && node.expressions.length === 0;
}

/** 该调用/构造是否在任意实参里携带了消息描述符 */
function carriesMessageDescriptor(node) {
  return node.arguments.some((argument) => {
    if (!argument) return false;
    // backendI18n.errorOptions("key") / createMessageOptions("key")，含成员调用形式
    if (argument.type === "CallExpression") {
      const callee = argument.callee;
      const name =
        callee.type === "Identifier"
          ? callee.name
          : callee.type === "MemberExpression"
            ? getStaticPropertyName(callee.property)
            : undefined;
      if (name && ["errorOptions", "createMessageOptions"].includes(name)) return true;
    }
    if (argument.type !== "ObjectExpression") return false;
    return argument.properties.some(
      (property) =>
        property.type === "Property" && getStaticPropertyName(property.key) === "messageKey",
    );
  });
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

    /**
     * P13 门禁：禁止新增「不带消息描述符的原文错误」。
     *
     * 旧机制（`translateKnownMessage` 原文反查 + 前缀猜测）已在 P13 删除，
     * 因此 `throw new XxxError("中文/英文原文")` 这类调用点，其文案将原样发给
     * 客户端且不随语言变化。本规则让「新增旧式调用」在静态检查阶段就被挡住。
     *
     * 允许的形状：
     *  - 任意实参中出现 `{ messageKey }`，或 `backendI18n.errorOptions("key")`；
     *  - 错误类默认文案（无参数构造）；
     *  - 动态传入（非字面量）的消息，例如被调用方决定的 `rawMessage` 兜底。
     */
    "no-raw-error-message": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Require an i18n message descriptor on business errors instead of a raw text literal.",
        },
        schema: [],
        messages: {
          rawMessage:
            "Business errors must carry a message descriptor. Add `{ messageKey: \"<domain.key>\" }` (with `messageParams` when the template has placeholders) instead of the raw literal '{{text}}'.",
        },
      },
      create(context) {
        return {
          NewExpression(node) {
            if (node.callee.type !== "Identifier") return;
            const className = node.callee.name;
            // 只约束面向用户的 API 错误类；内部错误类（继承裸 Error）不在范围内
            if (!getBackendApiErrorClasses().has(className)) return;
            if (INTERNALLY_KEYED_ERROR_CLASSES.has(className)) return;
            const first = node.arguments[0];
            if (!isStaticLiteralText(first)) return;
            if (carriesMessageDescriptor(node)) return;

            const text = getStaticString(first) ?? first.quasis?.[0]?.value?.raw ?? "<template>";
            context.report({ node, messageId: "rawMessage", data: { text: String(text).slice(0, 60) } });
          },
        };
      },
    },

    /** P13 门禁：旧译文机制已删除，任何重新引入都会被捕获 */
    "no-legacy-i18n-api": {
      meta: {
        type: "problem",
        docs: {
          description: "Forbid the removed legacy raw-message translation APIs.",
        },
        schema: [],
        messages: {
          legacy:
            "'{{name}}' was removed in P13 (raw-text reverse lookup and prefix guessing). Use `messageKey` descriptors and `translateMessage` instead.",
        },
      },
      create(context) {
        const LEGACY = new Set(["translateKnownMessage", "getLegacyRawMessageEntries"]);
        return {
          CallExpression(node) {
            const name =
              node.callee.type === "Identifier"
                ? node.callee.name
                : node.callee.type === "MemberExpression"
                  ? getStaticPropertyName(node.callee.property)
                  : undefined;
            if (!name || !LEGACY.has(name)) return;
            context.report({ node, messageId: "legacy", data: { name } });
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
      "backend-i18n/no-legacy-i18n-api": "error",
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
    name: "app/src-i18n-descriptor-required",
    // 仅约束生产代码：测试会**有意**构造无描述符的错误，用来固定兜底路径的行为。
    files: ["src/**/*.ts"],
    rules: {
      "backend-i18n/no-raw-error-message": "error",
    },
  },

  {
    name: "app/test-unit-prisma-boundary",
    files: ["tests/unit/**/*.unit.test.ts"],    rules: {
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
