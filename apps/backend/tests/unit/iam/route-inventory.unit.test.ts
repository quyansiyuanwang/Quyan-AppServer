import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { collectIamRoutes, routeCoverageRegressions, summarizeIamRoutes } from "../../../scripts/iam/route-inventory";
const imports =
  'import { Route, Get, Security, Middlewares, NoSecurity } from "@tsoa/runtime"; import { Permission } from "@quyan/shared"; import { CheckPermission, PermissionCheckMode, RequirePermission } from "@/util/permission/permission-decorator"; import { iamAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";';
function inventory(method: string, classDecorators = "") {
  const project = new Project({ useInMemoryFileSystem: true });
  const source = project.createSourceFile(
    "/backend/src/api/controllers/example.ts",
    imports + ' @Route("test") ' + classDecorators + " class ExampleController { " + method + " }",
  );
  return collectIamRoutes([source], "/backend");
}
const explicit =
  '@Get("item") @Security("jwt") @Middlewares(iamAuthorizationMiddleware({action:"alidns:AddDomainRecord",resourceKind:"single-resource",resource:domainResource})) item() {}';
const legacy =
  '@Get("item") @Security("jwt") @CheckPermission(Permission.USER_READ,PermissionCheckMode.ALL,"jwt") item() {}';
describe("IAM import-aware route inventory", () => {
  it("finds explicit actions, resolver metadata and stable method/path identity", () => {
    const [entry] = inventory(explicit);
    expect(entry).toMatchObject({
      key: "GET /test/item",
      coverage: "explicit",
      actions: ["alidns:AddDomainRecord"],
      resourceKind: "single-resource",
      resolver: "domainResource",
      issues: [],
    });
  });
  it("derives bridge actions from the sole legacy permission map", () => {
    const [entry] = inventory(legacy);
    expect(entry.coverage).toBe("legacy");
    expect(entry.actions).toEqual(["quyan:user:Read"]);
    expect(entry.resourceKind).toBe("account");
  });
  it("handles class security, method overrides, NoSecurity and local-or-jwt", () => {
    const routes = inventory(
      '@Get("one") @RequirePermission(Permission.USER_READ) one() {} @Get("two") @NoSecurity() two() {} @Get("three") @Security("local-or-jwt") @RequirePermission(Permission.USER_READ,"local-or-jwt") three() {}',
      '@Security("jwt")',
    );
    expect(routes.map((entry) => entry.coverage)).toEqual(["legacy", "legacy", "public"]);
    expect(summarizeIamRoutes(routes)).toMatchObject({ jwtRoutes: 2, legacy: 2, missing: 0 });
  });
  it("resolves imported decorator aliases and namespaces without false positives from local names", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const source = project.createSourceFile(
      "/backend/src/api/controllers/aliases.ts",
      'import * as tsoa from "@tsoa/runtime"; import { RequirePermission as Require } from "@/util/permission/permission-decorator"; import { Permission as P } from "@quyan/shared"; @tsoa.Route("alias") class C { @tsoa.Get() @tsoa.Security("jwt") @Require(P.USER_READ) item() {} }',
    );
    expect(collectIamRoutes([source], "/backend")[0].coverage).toBe("legacy");
    const fake = project.createSourceFile(
      "/backend/src/api/controllers/fake.ts",
      'import { Route, Get, Security, Middlewares } from "@tsoa/runtime"; const iamAuthorizationMiddleware = () => {}; @Route("fake") class C { @Get() @Security("jwt") @Middlewares(iamAuthorizationMiddleware({action:"alidns:AddDomainRecord",resourceKind:"account",resource:resolver})) item() {} }',
    );
    expect(collectIamRoutes([fake], "/backend")[0].coverage).toBe("missing");
  });
  it.each([
    explicit.replace("alidns:AddDomainRecord", "invented:Action"),
    explicit.replace('resourceKind:"single-resource",', ""),
    explicit.replace('resourceKind:"single-resource"', 'resourceKind:"unknown"'),
    explicit.replace("resource:domainResource", 'resource:() => "*"'),
    explicit.replace('action:"alidns:AddDomainRecord"', "...clientDefinition,action:header.action"),
    legacy.replace('"jwt") item', '"local") item'),
    legacy.replace("Permission.USER_READ", "clientPermission"),
  ])("rejects unsafe/unverifiable action, resource and legacy metadata %#", (code) =>
    expect(inventory(code)[0].issues.length).toBeGreaterThan(0),
  );
  it("flags duplicates and dynamic route/security metadata", () => {
    expect(inventory(explicit + " " + explicit.replace("item() {}", "other() {}"))[1].issues).toContain(
      "Duplicate method/path",
    );
    expect(inventory("@Get(header.path) @Security(header.scheme) item() {}")[0].issues).toHaveLength(2);
  });
  it("ratchets actual base coverage without a grandfather allowlist", () => {
    const current = inventory(explicit),
      old = inventory(legacy),
      missing = inventory('@Get("item") @Security("jwt") item() {}');
    expect(routeCoverageRegressions(current, old)).toEqual([]);
    expect(routeCoverageRegressions(old, current)).not.toEqual([]);
    expect(routeCoverageRegressions(missing, old)).not.toEqual([]);
    expect(routeCoverageRegressions(missing, missing)).toEqual([]);
    expect(routeCoverageRegressions(old, [])).not.toEqual([]);
    expect(routeCoverageRegressions(current, [])).toEqual([]);
    expect(routeCoverageRegressions(inventory('@Get("item") item() {}'), old)).toContain(
      "GET /test/item: JWT protection removed",
    );
  });
});
