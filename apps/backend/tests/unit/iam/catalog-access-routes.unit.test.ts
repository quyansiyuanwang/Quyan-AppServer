import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { Permission, getIamActionDefinition, isIamActionForLegacyPermission } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";

const backendRoot = fileURLToPath(new URL("../../../", import.meta.url));
const project = new Project({ skipAddingFilesFromTsConfig: true });
const routes = collectIamRoutes(
  project.addSourceFilesAtPaths(
    ["src/api/controllers/v1/iam/iam-catalog.controller.ts", "src/api/controllers/v1/users/ram.controller.ts"].map(
      (path) => backendRoot + path,
    ),
  ),
  backendRoot,
);
const keys = [
  "GET /v1/iam/catalog/services",
  "GET /v1/iam/catalog/services/{service}/actions",
  "GET /v1/iam/catalog/resources",
  "GET /v1/iam/catalog/policy-schema",
  "GET /v1/iam/catalog/condition-keys",
  "GET /v1/ram/iam/actions",
];

describe("IAM catalog access boundary", () => {
  it("registers a narrow catalog read Action with the existing legacy gate", () => {
    expect(getIamActionDefinition("quyan:iam:GetCatalog")).toMatchObject({
      service: "iam",
      accessLevel: "Read",
      resourceTypes: ["quyan/user"],
      defaultAuthorizationScope: "self",
      sensitive: false,
      apiRoutes: keys,
    });
    expect(isIamActionForLegacyPermission("quyan:iam:GetCatalog", Permission.RAM_POLICY_READ)).toBe(true);
  });
  it.each(keys)("protects %s with server-owned subject resource metadata", (key) => {
    expect(routes.find((route) => route.key === key)).toMatchObject({
      security: ["jwt"],
      coverage: "explicit",
      actions: ["quyan:iam:GetCatalog"],
      resourceKind: "single-resource",
      resolver: "iamAuthenticatedUserResourceResolver",
      issues: [],
    });
  });
});
