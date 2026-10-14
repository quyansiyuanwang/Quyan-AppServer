import { describe, expect, it, vi } from "vitest";
import {
  ALL_PERMISSIONS,
  Permission,
  actionForPermission,
  IAM_ACTION_DEFINITIONS,
  IAM_AUTHENTICATED_SELF_ACTIONS,
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
  it("derives the narrow self-service baseline exclusively from registered catalog metadata", () => {
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).toEqual([
      "quyan:iam:GetCatalog",
      "quyan:remote_terminal:GetMyUnbindReminder",
      "quyan:remote_terminal:ListMyDevices",
      "quyan:remote_terminal:ListMyEntitlements",
      "quyan:remote_terminal:ClaimPublishedTemplate",
      "quyan:remote_terminal:GetMyInstallToken",
      "quyan:remote_terminal:RotateMyRegistrationToken",
      "quyan:permission:Manage",
      "quyan:user:GetHeartbeatConfig",
      "quyan:user:SendHeartbeat",
      "quyan:user:StopHeartbeat",
      "quyan:notification:ListInbox",
      "quyan:notification:MarkInboxRead",
      "quyan:notification:ConfirmPixelOpenedInboxRead",
      "quyan:remote_terminal:ListPublishedTemplates",
      "quyan:user:GetCurrentUser",
      "quyan:notification:ListEvents",
      "quyan:balance:GetAccount",
      "quyan:balance:GetUsage",
      "quyan:balance:GetTransferConfig",
      "quyan:balance:ListGiftCodes",
      "quyan:balance:CreateGiftCode",
      "quyan:balance:CancelGiftCode",
      "quyan:balance:CreateTransfer",
      "quyan:balance:ListTransactions",
      "quyan:auth:ListExternalIdentities",
      "quyan:auth:BindExternalIdentity",
      "quyan:auth:UnbindExternalIdentity",
      "quyan:auth:CreateCentralLoginFlow",
      "quyan:auth:ConsumeCentralLoginFlow",
      "quyan:auth:ScanQrLogin",
      "quyan:auth:ConfirmQrLogin",
      "quyan:oauth:ListScopes",
      "quyan:oauth:GetAuthorizationPreview",
      "quyan:oauth:DecideAuthorization",
      "quyan:auth_center:GetAuthorizationPreview",
      "quyan:auth_center:DecideAuthorization",
      "quyan:balance:RedeemCode",
    ]);
    for (const action of IAM_AUTHENTICATED_SELF_ACTIONS)
      expect(
        getIamActionDefinition(action)?.resourceTypes.some((id) =>
          IAM_RESOURCE_TYPE_CATALOG.some((type) => type.id === id && type.authenticatedSelfScope),
        ),
      ).toBe(true);
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).not.toContain("quyan:permission:Add");
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).not.toContain(actionForPermission(Permission.USER_ONLINE_MONITOR_READ));
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).not.toContain(
      actionForPermission(Permission.USER_ONLINE_MONITOR_FORCE_OFFLINE),
    );
    expect(IAM_AUTHENTICATED_SELF_ACTIONS.every((action) => !action.includes("*"))).toBe(true);
  });
  it("registers every relay channel operation with a channel resource target", () => {
    const relayPermissions = [
      Permission.RELAY_CHANNEL_CREATE,
      Permission.RELAY_CHANNEL_READ,
      Permission.RELAY_CHANNEL_UPDATE,
      Permission.RELAY_CHANNEL_DELETE,
      Permission.RELAY_CHANNEL_EXPORT,
      Permission.RELAY_CHANNEL_HEALTH_READ,
      Permission.RELAY_CHANNEL_POOL_METADATA_READ,
      Permission.RELAY_CHANNEL_PROBE_READ,
      Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE,
      Permission.RELAY_CHANNEL_MULTIPLIER_ADJUST,
      Permission.RELAY_CHANNEL_SUBMIT,
      Permission.RELAY_CHANNEL_REVIEW,
      Permission.RELAY_CHANNEL_PROVIDER_READ,
      Permission.RELAY_CHANNEL_PROVIDER_SETTLE,
    ];
    for (const permission of relayPermissions)
      expect(getIamActionDefinition(actionForPermission(permission))?.resourceTypes).toContain("relay/channel");
  });

  it("registers project API key creation on the project resource", () => {
    expect(getIamActionDefinition("quyan:developer:CreateProjectApiKey")).toMatchObject({
      accessLevel: "Write",
      resourceTypes: ["developer/project"],
      authorizationStage: "declared",
    });
  });

  it("registers self-scoped utility actions in the shared catalog", () => {
    for (const action of ["quyan:ojqa:GetUsage", "quyan:system:GetClientIp", "quyan:reurl:Generate"])
      expect(getIamActionDefinition(action)).toMatchObject({
        resourceTypes: ["quyan/user"],
        authorizationStage: "declared",
      });
  });

  it("declares real project actions without an implicit self-service project grant", () => {
    expect(getIamActionDefinition("quyan:developer:CreateProject")).toMatchObject({
      accessLevel: "Write",
      resourceTypes: ["quyan/user"],
    });
    for (const action of ["GetProject", "GetProjectUsage", "UpdateStatusPage"])
      expect(getIamActionDefinition("quyan:developer:" + action)?.resourceTypes).toEqual(["developer/project"]);
    expect(IAM_AUTHENTICATED_SELF_ACTIONS.some((action) => action.startsWith("quyan:developer:"))).toBe(false);
  });
  it("declares sensitive preference operations without a default self-service grant", () => {
    for (const [operation, accessLevel] of [
      ["GetPreferences", "Read"],
      ["UpdatePreferences", "Write"],
    ]) {
      const action = "quyan:notification:" + operation;
      expect(getIamActionDefinition(action)).toMatchObject({
        resourceTypes: ["quyan/user"],
        accessLevel,
        sensitive: true,
        authorizationStage: "declared",
        legacyPermission: Permission.NOTIFICATION_MANAGE,
      });
      expect(IAM_AUTHENTICATED_SELF_ACTIONS).not.toContain(action);
    }
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
    expect(service.listServices().map((service) => service.code)).toEqual(["ram", "remote_terminal"]);
    const connection = service.listActions("remote_terminal");
    expect(connection.map((action) => action.action)).toEqual(["quyan:remote_terminal:ConnectSession"]);
    expect(connection[0]?.authorizationTransport).toBe("websocket");
    expect(connection[0]?.apiRoutes).toEqual(getIamActionDefinition("quyan:remote_terminal:ConnectSession")?.apiRoutes);
    connection[0]!.apiRoutes.length = 0;
    expect(service.listActions("remote_terminal")[0]?.apiRoutes.length).toBe(2);
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
