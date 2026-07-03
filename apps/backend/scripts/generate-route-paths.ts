import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type SwaggerOperation = {
  operationId?: string;
};

type SwaggerPathItem = Record<string, SwaggerOperation>;

type SwaggerDocument = {
  paths?: Record<string, SwaggerPathItem>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const swaggerPath = path.join(rootDir, "src/build/swagger.json");
const outFile = path.join(rootDir, "src/build/route-paths.ts");

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function segmentToName(segment: string): string {
  if (!segment) return "Root";

  const paramMatch = segment.match(/^\{(.+)\}$/);
  if (paramMatch) return `By${toPascalCase(paramMatch[1])}`;

  return toPascalCase(segment);
}

function pathToEnumKey(routePath: string): string {
  const parts = routePath.split("/").filter(Boolean).map(segmentToName);
  return parts.length > 0 ? parts.join("") : "Root";
}

function collectPathPrefixes(routePath: string): string[] {
  const segments = routePath.split("/").filter(Boolean);
  const prefixes: string[] = [];

  for (let i = 1; i < segments.length; i += 1) prefixes.push(`/${segments.slice(0, i).join("/")}`);

  return prefixes;
}

function readSwagger(): SwaggerDocument {
  if (!fs.existsSync(swaggerPath))
    throw new Error(`swagger.json not found at ${swaggerPath}. Run tsoa spec-and-routes first.`);

  return JSON.parse(fs.readFileSync(swaggerPath, "utf8")) as SwaggerDocument;
}

function buildRouteMeta(doc: SwaggerDocument) {
  const paths = Object.keys(doc.paths ?? {}).sort((a, b) => a.localeCompare(b));
  const usedNames = new Map<string, number>();

  return paths.map((routePath) => {
    const baseName = pathToEnumKey(routePath);
    const duplicateCount = usedNames.get(baseName) ?? 0;
    usedNames.set(baseName, duplicateCount + 1);
    const enumKey = duplicateCount === 0 ? baseName : `${baseName}${duplicateCount + 1}`;

    const operations = Object.entries(doc.paths?.[routePath] ?? {})
      .filter(([method]) => HTTP_METHODS.has(method.toLowerCase()))
      .map(([, operation]) => operation.operationId)
      .filter((operationId): operationId is string => Boolean(operationId))
      .sort((a, b) => a.localeCompare(b));

    return { enumKey, routePath, operations };
  });
}

function buildPrefixMeta(routeMeta: Array<{ enumKey: string; routePath: string; operations: string[] }>) {
  const routeKeyByPath = new Map(routeMeta.map(({ routePath, enumKey }) => [routePath, enumKey]));
  const prefixToRoutes = new Map<string, string[]>();

  for (const { routePath } of routeMeta)
    for (const prefix of collectPathPrefixes(routePath)) {
      const matchedRoutes = prefixToRoutes.get(prefix) ?? [];
      matchedRoutes.push(routePath);
      prefixToRoutes.set(prefix, matchedRoutes);
    }

  const prefixes = [...prefixToRoutes.entries()].sort(([a], [b]) => a.localeCompare(b));
  const usedNames = new Map<string, number>();

  return prefixes.map(([prefix, matchedRoutes]) => {
    const baseName = pathToEnumKey(prefix);
    const duplicateCount = usedNames.get(baseName) ?? 0;
    usedNames.set(baseName, duplicateCount + 1);
    const enumKey = duplicateCount === 0 ? baseName : `${baseName}${duplicateCount + 1}`;

    return {
      enumKey,
      prefix,
      matchedRoutes: [...new Set(matchedRoutes)]
        .sort((a, b) => a.localeCompare(b))
        .map((routePath) => ({ routePath, enumKey: routeKeyByPath.get(routePath) ?? pathToEnumKey(routePath) })),
    };
  });
}

function renderFile(
  routeMeta: Array<{ enumKey: string; routePath: string; operations: string[] }>,
  prefixMeta: Array<{ enumKey: string; prefix: string; matchedRoutes: Array<{ routePath: string; enumKey: string }> }>,
): string {
  const enumEntries = routeMeta
    .map(({ enumKey, routePath }) => `  ${enumKey} = ${JSON.stringify(routePath)},`)
    .join("\n");

  const prefixEnumEntries = prefixMeta
    .map(({ enumKey, prefix }) => `  ${enumKey} = ${JSON.stringify(prefix)},`)
    .join("\n");

  const operationEntries = routeMeta
    .map(({ enumKey, operations }) => {
      const renderedOps = operations.map((operationId) => `    ${JSON.stringify(operationId)},`).join("\n");
      return `  [ApiRoutePath.${enumKey}]: [\n${renderedOps}\n  ],`;
    })
    .join("\n");

  const prefixRouteEntries = prefixMeta
    .map(({ enumKey, matchedRoutes }) => {
      const renderedRoutes = matchedRoutes
        .map(({ enumKey: routeEnumKey }) => `    ApiRoutePath.${routeEnumKey},`)
        .join("\n");
      return `  [ApiRoutePathPrefix.${enumKey}]: [\n${renderedRoutes}\n  ],`;
    })
    .join("\n");

  return `/**\n * Auto-generated from src/build/swagger.json.\n * Do not edit manually. Re-run \`pnpm run openapi:generate\`.\n */\nexport enum ApiRoutePath {\n${enumEntries}\n}\n\nexport const ALL_API_ROUTE_PATHS = Object.values(ApiRoutePath) as ApiRoutePath[];\n\nexport const API_ROUTE_OPERATION_IDS: Record<ApiRoutePath, readonly string[]> = {\n${operationEntries}\n};\n\nexport enum ApiRoutePathPrefix {\n${prefixEnumEntries}\n}\n\nexport const ALL_API_ROUTE_PATH_PREFIXES = Object.values(ApiRoutePathPrefix) as ApiRoutePathPrefix[];\n\nexport const API_ROUTE_PREFIX_MATCHES: Record<ApiRoutePathPrefix, readonly ApiRoutePath[]> = {\n${prefixRouteEntries}\n};\n`;
}

function writeIfChanged(nextContent: string): boolean {
  const previousContent = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : null;
  if (previousContent === nextContent) return false;

  fs.writeFileSync(outFile, nextContent, "utf8");
  return true;
}

const swagger = readSwagger();
const routeMeta = buildRouteMeta(swagger);
const prefixMeta = buildPrefixMeta(routeMeta);
const updated = writeIfChanged(renderFile(routeMeta, prefixMeta));

if (updated) console.log(`[generate-route-paths] wrote ${path.relative(rootDir, outFile)}`);
else console.log(`[generate-route-paths] route-paths.ts 已是最新`);
