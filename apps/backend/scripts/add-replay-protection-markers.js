import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const swaggerPath = path.join(__dirname, "../src/build/swagger.json");
const swagger = JSON.parse(fs.readFileSync(swaggerPath, "utf8"));

const controllersPath = path.join(__dirname, "../src/api/controllers");
const replayProtectedOperations = new Set();
const twoFactorChallengeOperations = new Map();

function findMatchingParen(source, openIndex) {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplateString = false;
  let escaped = false;

  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (inSingleQuote) {
      if (ch === "'") inSingleQuote = false;
      continue;
    }

    if (inDoubleQuote) {
      if (ch === '"') inDoubleQuote = false;
      continue;
    }

    if (inTemplateString) {
      if (ch === "`") inTemplateString = false;
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      continue;
    }

    if (ch === '"') {
      inDoubleQuote = true;
      continue;
    }

    if (ch === "`") {
      inTemplateString = true;
      continue;
    }

    if (ch === "(") {
      depth++;
      continue;
    }

    if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function findDecoratorCalls(content, decoratorName) {
  const calls = [];
  const marker = `@${decoratorName}`;

  let searchStart = 0;
  while (searchStart < content.length) {
    const markerIndex = content.indexOf(marker, searchStart);
    if (markerIndex < 0) break;

    let cursor = markerIndex + marker.length;
    while (cursor < content.length && /\s/.test(content[cursor])) cursor++;

    if (content[cursor] !== "(") {
      searchStart = cursor + 1;
      continue;
    }

    const closeIndex = findMatchingParen(content, cursor);
    if (closeIndex < 0) {
      searchStart = cursor + 1;
      continue;
    }

    calls.push({
      start: markerIndex,
      end: closeIndex + 1,
      args: content.slice(cursor + 1, closeIndex),
    });

    searchStart = closeIndex + 1;
  }

  return calls;
}

function findMethodNameAfter(content, fromIndex) {
  const after = content.slice(fromIndex);
  const methodMatch = after.match(/(?:^|\n)\s*(?:public\s+)?async\s+(\w+)\s*\(/m);
  if (!methodMatch) return null;
  return methodMatch[1];
}

function parseTwoFactorOptions(rawOptions) {
  const options = {
    required: true,
    purpose: "stepup",
    method: "code",
  };

  if (!rawOptions) return options;

  const purposeMatch = rawOptions.match(/purpose\s*:\s*["']([^"']+)["']/);
  if (purposeMatch && purposeMatch[1]) options.purpose = purposeMatch[1];

  const methodMatch = rawOptions.match(/method\s*:\s*["']([^"']+)["']/);
  if (methodMatch && methodMatch[1]) options.method = methodMatch[1];

  const redirectMatch = rawOptions.match(/redirect\s*:\s*["']([^"']+)["']/);
  if (redirectMatch && redirectMatch[1]) options.redirect = redirectMatch[1];

  return options;
}

function scanDirectory(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) scanDirectory(fullPath);
    else if (file.endsWith(".ts")) {
      const content = fs.readFileSync(fullPath, "utf8");

      if (content.includes("replayProtectionMiddleware")) {
        const classMatch = content.match(/export\s+class\s+(\w+Controller)/);
        if (!classMatch) continue;

        const controllerName = classMatch[1];

        const middlewareCalls = findDecoratorCalls(content, "Middlewares");
        for (const call of middlewareCalls) {
          if (!call.args.includes("replayProtectionMiddleware")) continue;

          const methodName = findMethodNameAfter(content, call.end);
          if (!methodName) continue;

          const operationId = `${controllerName}${methodName.charAt(0).toUpperCase() + methodName.slice(1)}`;
          replayProtectedOperations.add(operationId);
        }
      }

      if (content.includes("TwoFactorChallengeProtected")) {
        const classMatch = content.match(/export\s+class\s+(\w+Controller)/);
        if (!classMatch) continue;

        const controllerName = classMatch[1];
        const challengeCalls = findDecoratorCalls(content, "TwoFactorChallengeProtected");

        for (const call of challengeCalls) {
          const methodName = findMethodNameAfter(content, call.end);
          if (!methodName) continue;

          const operationId = `${controllerName}${methodName.charAt(0).toUpperCase() + methodName.slice(1)}`;
          twoFactorChallengeOperations.set(operationId, parseTwoFactorOptions(call.args));
        }
      }
    }
  }
}

scanDirectory(controllersPath);

let markedCount = 0;
let twoFactorMarkedCount = 0;
for (const [_pathKey, methods] of Object.entries(swagger.paths))
  for (const [_method, operation] of Object.entries(methods))
    if (replayProtectedOperations.has(operation.operationId)) {
      operation["X-Replay-Protected"] = true;
      markedCount++;
    }

for (const [_pathKey, methods] of Object.entries(swagger.paths))
  for (const [_method, operation] of Object.entries(methods)) {
    const marker = twoFactorChallengeOperations.get(operation.operationId);
    if (!marker) continue;

    operation["X-Two-Factor-Challenge"] = marker;
    twoFactorMarkedCount++;
  }

fs.writeFileSync(swaggerPath, JSON.stringify(swagger, null, "\t"));
console.log(`✓ Added X-Replay-Protected markers to ${markedCount} endpoints`);
console.log(`✓ Added X-Two-Factor-Challenge markers to ${twoFactorMarkedCount} endpoints`);
