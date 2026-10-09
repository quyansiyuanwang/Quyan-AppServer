import { describe, expect, it, vi } from "vitest";
import {
  ALL_PERMISSIONS,
  actionForPermission,
  IAM_ACTION_DEFINITIONS,
  IAM_RESOURCE_TYPE_CATALOG,
  getIamActionDefinition,
} from "@quyan/shared";
import { actionRouteCatalog } from "../../../scripts/iam/action-route-catalog";
import type { IamRouteEntry } from "../../../scripts/iam/route-inventory";
vi.mock("../../../src/build/iam-action-routes", () => ({
  IAM_ACTION_ROUTES: { "quyan:ram:UpdateUser": ["PUT /v1/ram/users/{userId}"] },
}));
import { IamCatalogService } from "../../../src/iam/iam-catalog.service";
describe("IAM service and resource catalog", () => {
  it("retains distinct compatibility Actions and references registered resource types", () => {
    const resources = new Set(IAM_RESOURCE_TYPE_CATALOG.map((resource) => resource.id));
    expect(new Set(IAM_ACTION_DEFINITIONS.map((action) => action.action)).size).toBe(IAM_ACTION_DEFINITIONS.length);
    for (const permission of ALL_PERMISSIONS)
      expect(getIamActionDefinition(actionForPermission(permission))).toBeDefined();
    for (const action of IAM_ACTION_DEFINITIONS) {
      expect(action.resourceTypes.length).toBeGreaterThan(0);
      expect(action.resourceTypes.every((resource) => resources.has(resource))).toBe(true);
      expect(action.action.startsWith("quyan:")).toBe(true);
    }
    expect(getIamActionDefinition("quyan:ram:UpdateUser")).toMatchObject({
      sensitive: true,
      accessLevel: "Write",
      authorizationStage: "declared",
    });
    expect(getIamActionDefinition("quyan:ram:ReadUser")?.accessLevel).toBe("Read");
    expect(getIamActionDefinition("quyan:permission:Manage")?.accessLevel).toBe("Read");
  });
  it("derives API links, ignores invalid metadata and deduplicates deterministically", () => {
    const route = {
      key: "PUT /v1/ram/users/{userId}",
      coverage: "explicit",
      actions: ["quyan:ram:UpdateUser"],
      issues: [],
    } as unknown as IamRouteEntry;
    expect(actionRouteCatalog([route, route, { ...route, key: "invalid", issues: ["bad action"] }])).toEqual({
      "quyan:ram:UpdateUser": [route.key],
    });
  });
  it("serves linked actions without exposing mutable catalog arrays", () => {
    const service = IamCatalogService.getInstance();
    expect(service.listServices().map((service) => service.code)).toEqual(["ram"]);
    const actions = service.listActions("ram");
    expect(actions.map((action) => action.action)).toEqual(["quyan:ram:UpdateUser"]);
    actions[0].resourceTypes.length = 0;
    expect(service.listActions("ram")[0].resourceTypes).toContain("quyan/user");
    expect(() => service.listActions("alidns")).toThrow();
    expect(service.listResources().find((resource) => resource.id === "quyan/policy-version")?.identifierSegments).toBe(
      2,
    );
  });
});
