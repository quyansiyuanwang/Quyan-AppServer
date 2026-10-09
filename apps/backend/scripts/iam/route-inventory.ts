import path from "node:path";
import { Node } from "ts-morph";
import type { Decorator, Expression, SourceFile } from "ts-morph";
import { Permission, actionForPermission, isKnownIamAction, IAM_RESOURCE_KINDS } from "@quyan/shared";

export interface IamRouteEntry {
  key: string;
  file: string;
  controller: string;
  method: string;
  line: number;
  security: string[];
  coverage: "explicit" | "legacy" | "missing" | "public";
  actions: string[];
  resourceKind?: string;
  resolver?: string;
  issues: string[];
}
const verbs = new Set(["Get", "Post", "Put", "Patch", "Delete", "Head", "Options"]);
const legacyNames = new Set(["CheckPermission", "RequirePermission", "RequireAllPermissions", "RequireAnyPermission"]);
const tsoaModules = new Set(["tsoa", "@tsoa/runtime"]);
const permissionModule = "src/util/permission/permission-decorator";
const iamModule = "src/iam/middleware/iam-authorization.middleware";
function modulePath(source: SourceFile, specifier: string, backendRoot: string): string {
  if (specifier.startsWith("@/")) return "src/" + specifier.slice(2);
  if (specifier.startsWith("."))
    return path
      .relative(backendRoot, path.resolve(path.dirname(source.getFilePath()), specifier))
      .replaceAll("\\", "/")
      .replace(/\.ts$/, "");
  return specifier;
}
/** Resolve named/namespace import aliases, never trust a coincidentally named local function. */
function imported(node: Node, source: SourceFile, root: string): { name: string; module: string } | undefined {
  for (const declaration of source.getImportDeclarations()) {
    const module = modulePath(source, declaration.getModuleSpecifierValue(), root);
    if (Node.isIdentifier(node)) {
      const named = declaration
        .getNamedImports()
        .find((item) => (item.getAliasNode()?.getText() ?? item.getName()) === node.getText());
      if (named) return { name: named.getName(), module };
    }
    if (
      Node.isPropertyAccessExpression(node) &&
      declaration.getNamespaceImport()?.getText() === node.getExpression().getText()
    )
      return { name: node.getName(), module };
  }
  return undefined;
}
function decoratorInfo(decorator: Decorator, source: SourceFile, root: string) {
  const expression = decorator.getExpression();
  const info = imported(Node.isCallExpression(expression) ? expression.getExpression() : expression, source, root);
  return info && { ...info, args: decorator.getArguments() as Expression[] };
}
function literal(node: Node | undefined): string | undefined {
  return node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
    ? node.getLiteralText()
    : undefined;
}
export function isJwtRoute(entry: IamRouteEntry): boolean {
  return entry.security.some((scheme) => scheme === "jwt" || scheme === "local-or-jwt");
}
export function collectIamRoutes(sources: readonly SourceFile[], backendRoot: string): IamRouteEntry[] {
  const entries: IamRouteEntry[] = [];
  for (const source of sources)
    for (const controller of source.getClasses()) {
      const classDecorators = controller
        .getDecorators()
        .map((item) => decoratorInfo(item, source, backendRoot))
        .filter((item) => item !== undefined);
      const route = classDecorators.find((item) => tsoaModules.has(item.module) && item.name === "Route");
      if (!route) continue;
      for (const method of controller.getMethods()) {
        const decorators = method
          .getDecorators()
          .map((item) => decoratorInfo(item, source, backendRoot))
          .filter((item) => item !== undefined);
        const verb = decorators.find((item) => tsoaModules.has(item.module) && verbs.has(item.name));
        if (!verb) continue;
        const issues: string[] = [];
        const prefix = literal(route.args[0]),
          suffix = verb.args.length ? literal(verb.args[0]) : "";
        if (prefix === undefined || suffix === undefined) issues.push("Route paths must be static strings");
        const routePath =
          "/" + [prefix ?? "<dynamic>", suffix ?? "<dynamic>"].join("/").split("/").filter(Boolean).join("/");
        const noSecurity = decorators.some((item) => tsoaModules.has(item.module) && item.name === "NoSecurity");
        const methodSecurity = decorators.filter((item) => tsoaModules.has(item.module) && item.name === "Security");
        const schemes = noSecurity
          ? []
          : methodSecurity.length
            ? methodSecurity
            : classDecorators.filter((item) => tsoaModules.has(item.module) && item.name === "Security");
        const security = schemes.map((item) => literal(item.args[0]) ?? "<dynamic>");
        if (security.includes("<dynamic>")) issues.push("Security schemes must be static strings");
        const entry: IamRouteEntry = {
          key: verb.name.toUpperCase() + " " + routePath,
          file: path.relative(backendRoot, source.getFilePath()).replaceAll("\\", "/"),
          controller: controller.getName() ?? "<anonymous>",
          method: method.getName(),
          line: method.getStartLineNumber(),
          security,
          coverage: security.some((value) => value === "jwt" || value === "local-or-jwt") ? "missing" : "public",
          actions: [],
          issues,
        };
        if (isJwtRoute(entry)) {
          let hasLegacy = false,
            hasExplicit = false;

          const addExplicitDefinition = (definition: Node | undefined, expectedAction?: string) => {
            if (!definition || !Node.isObjectLiteralExpression(definition)) {
              issues.push("IAM definition must be a static object");
              return;
            }
            const properties = new Map(
              definition
                .getProperties()
                .filter(Node.isPropertyAssignment)
                .map((item) => [item.getName(), item.getInitializer()]),
            );
            const action = literal(properties.get("action")),
              kind = literal(properties.get("resourceKind")),
              resolver = properties.get("resource");
            if (definition.getProperties().some(Node.isSpreadAssignment))
              issues.push("IAM definitions cannot contain spreads");
            if (!action || !isKnownIamAction(action)) issues.push("IAM action must be a static Action Catalog entry");
            if (!kind || !IAM_RESOURCE_KINDS.some((value) => value === kind))
              issues.push("IAM resourceKind is missing or unsupported");
            if (!resolver || (!Node.isIdentifier(resolver) && !Node.isPropertyAccessExpression(resolver)))
              issues.push("IAM resource must reference a named server resolver");
            if (expectedAction && action !== expectedAction)
              issues.push("IAM action must match its legacy Permission mapping");
            if (action) entry.actions.push(action);
            entry.resourceKind = kind;
            entry.resolver = resolver?.getText();
            if (
              (!expectedAction || action === expectedAction) &&
              action &&
              isKnownIamAction(action) &&
              kind &&
              IAM_RESOURCE_KINDS.some((value) => value === kind) &&
              resolver &&
              (Node.isIdentifier(resolver) || Node.isPropertyAccessExpression(resolver))
            )
              hasExplicit = true;
          };
          for (const definition of decorators.filter(
            (item) => item.module === permissionModule && legacyNames.has(item.name),
          )) {
            const expressions = Node.isArrayLiteralExpression(definition.args[0])
              ? definition.args[0].getElements()
              : [definition.args[0]];
            const permissions = expressions.map((expression) => {
              if (!expression || !Node.isPropertyAccessExpression(expression)) return undefined;
              const symbol = imported(expression.getExpression(), source, backendRoot);
              if (
                symbol?.name !== "Permission" ||
                !["src/constant/permission", "@quyan/shared"].includes(symbol.module)
              )
                return undefined;
              return Permission[expression.getName() as keyof typeof Permission];
            });
            const schemeIndex = definition.name === "CheckPermission" ? 2 : 1;
            const scheme = definition.args[schemeIndex]
              ? literal(definition.args[schemeIndex])
              : definition.name === "CheckPermission"
                ? undefined
                : "jwt";
            if (!scheme || (scheme !== "jwt" && scheme !== "local-or-jwt")) {
              issues.push("Legacy permission decorator does not enforce JWT");
              continue;
            }
            if (!permissions.length || permissions.some((value) => !value)) {
              issues.push("Legacy permissions must use mapped Permission enum members");
              continue;
            }
            if (definition.name === "CheckPermission") {
              const mode = definition.args[1];
              if (
                !mode ||
                !Node.isPropertyAccessExpression(mode) ||
                !["ALL", "ANY"].includes(mode.getName()) ||
                imported(mode.getExpression(), source, backendRoot)?.name !== "PermissionCheckMode"
              ) {
                issues.push("Legacy permission mode must be ALL or ANY");
                continue;
              }
            }
            entry.actions.push(...permissions.map((value) => actionForPermission(value!)));
            hasLegacy = true;
            const metadata = definition.name === "CheckPermission" ? definition.args[3] : undefined;
            if (metadata) {
              const entries = Node.isArrayLiteralExpression(metadata) ? metadata.getElements() : [metadata];
              if (entries.length !== permissions.length) issues.push("IAM metadata must cover every legacy permission");
              else
                entries.forEach((item, index) => addExplicitDefinition(item, actionForPermission(permissions[index]!)));
            }
          }
          const middlewares = [...classDecorators, ...decorators].filter(
            (item) => tsoaModules.has(item.module) && item.name === "Middlewares",
          );
          for (const middleware of middlewares.flatMap((item) => item.args)) {
            if (!Node.isCallExpression(middleware)) continue;
            const symbol = imported(middleware.getExpression(), source, backendRoot);
            if (
              symbol?.module !== iamModule ||
              ![
                "iamAuthorizationMiddleware",
                "iamAuthenticatedAuthorizationMiddleware",
                "iamCollectionAuthorizationMiddleware",
              ].includes(symbol.name)
            )
              continue;
            addExplicitDefinition(middleware.getArguments()[0]);
          }
          entry.coverage = hasExplicit ? "explicit" : hasLegacy ? "legacy" : "missing";
          if (!hasExplicit && hasLegacy) entry.resourceKind = "account";
        }
        entry.actions = [...new Set(entry.actions)].sort();
        entries.push(entry);
      }
    }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key)) entry.issues.push("Duplicate method/path");
    seen.add(entry.key);
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}
/** No hand-maintained grandfather list: compare the real base-commit Controller metadata. */
export function routeCoverageRegressions(current: readonly IamRouteEntry[], base: readonly IamRouteEntry[]): string[] {
  const failures: string[] = [],
    previous = new Map(base.map((entry) => [entry.key, entry]));
  const rank = { public: 0, missing: 0, legacy: 1, explicit: 2 };
  for (const entry of current) {
    const old = previous.get(entry.key);
    for (const issue of entry.issues) failures.push(entry.key + ": " + issue);
    if (old && isJwtRoute(old) && !isJwtRoute(entry)) failures.push(entry.key + ": JWT protection removed");
    if (!isJwtRoute(entry)) continue;
    if ((!old || !isJwtRoute(old)) && entry.coverage !== "explicit")
      failures.push(entry.key + ": new JWT endpoints require explicit IAM metadata");
    if (old && isJwtRoute(old) && rank[entry.coverage] < rank[old.coverage])
      failures.push(entry.key + ": authorization coverage regressed");
    if (old?.coverage === "explicit" && old.actions.some((action) => !entry.actions.includes(action)))
      failures.push(entry.key + ": explicit IAM action was removed or changed; review migration separately");
  }
  return failures;
}
export function summarizeIamRoutes(entries: readonly IamRouteEntry[]) {
  const jwt = entries.filter(isJwtRoute);
  return {
    totalRoutes: entries.length,
    jwtRoutes: jwt.length,
    explicit: jwt.filter((entry) => entry.coverage === "explicit").length,
    legacy: jwt.filter((entry) => entry.coverage === "legacy").length,
    missing: jwt.filter((entry) => entry.coverage === "missing").length,
    invalid: entries.filter((entry) => entry.issues.length).length,
  };
}
