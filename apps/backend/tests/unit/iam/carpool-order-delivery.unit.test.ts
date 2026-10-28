import { platformMonthlyPassArn } from "@/iam/resources/platform-monthly-pass-resources";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformCarpoolOrderDeliveryIamService } from "@/services/billing/platform-carpool-order-delivery-iam.service";
import { platformCarpoolOrderArn, platformCarpoolDeliveryTokenArn } from "@/iam/resources/platform-carpool-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { getIamActionDefinition, isIamActionResourceCompatible, Permission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  iam = { authorizeMany: vi.fn(), loadPolicies: vi.fn() },
  repository = {
    findOrderManagementTarget: vi.fn(),
    findRefundCustomerTargets: vi.fn(),
    findDeliveryTemplateId: vi.fn(),
  },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformCarpoolOrderDeliveryIamService(iam, repository, snapshots, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    secure: true,
  }) as unknown as TypedRequest;
const prepare = () => service.prepare("actor", request(), "order", "channel");
let denied: Set<string>;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  denied = new Set();
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map((resource: string) => ({
      decision: denied.has(resource) ? "ExplicitDeny" : "Allow",
      reason: "fixture",
      matchedStatements: [],
    })),
  );
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  snapshots.recheck.mockResolvedValue(undefined);
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  repository.findOrderManagementTarget.mockResolvedValue({
    id: "order",
    packageTemplateId: "package",
    state: "accepted",
    status: 1,
    members: [{ id: "member", userId: "payer", state: "confirmed", reservation: null }],
  });
  repository.findDeliveryTemplateId.mockResolvedValue("template");
  repository.findRefundCustomerTargets.mockResolvedValue([
    { id: "payer", status: 1, accountOwnerId: null, updateTime: new Date(0) },
  ]);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("carpool delivery resource authority", () => {
  it("fixes the endpoint Action and evaluates source, recipient and generated resources", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/billing/carpool.controller.ts");
    const action = "quyan:carpool:FulfillOrder";
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/carpools/admin/{id}/fulfill",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], issues: [] });
    expect(getIamActionDefinition(action)).toMatchObject({
      authorizationBoundary: "platform",
      legacyPermission: Permission.CARPOOL_ORDER_FULFILL,
    });
    const guard = await prepare();
    await guard!.checkDelivery("payer", "pass", "token");
    for (const resource of [
      platformCarpoolOrderArn("order"),
      platformRelayChannelArn("channel"),
      platformTemplateArn("carpool", "package"),
      platformTemplateArn("monthly-pass", "template"),
      platformUserArn("payer"),
      platformMonthlyPassArn("payer", "pass"),
      platformCarpoolDeliveryTokenArn("payer", "token"),
    ]) {
      expect(isIamActionResourceCompatible(action, resource)).toBe(true);
      expect(iam.authorizeMany.mock.calls.some(([input]) => input.resources.includes(resource))).toBe(true);
    }
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === action)).toBe(true);
  });
  it("rejects denied orders before source hydration", async () => {
    denied.add(platformCarpoolOrderArn("order"));
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.findOrderManagementTarget).not.toHaveBeenCalled();
  });
  it.each(["channel", "package"])("authorizes %s before looking up the source template", async (kind) => {
    denied.add(kind === "channel" ? platformRelayChannelArn("channel") : platformTemplateArn("carpool", "package"));
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.findDeliveryTemplateId).not.toHaveBeenCalled();
  });
  it("authorizes recipients and template before hydrating customer identities", async () => {
    denied.add(platformUserArn("payer"));
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.findRefundCustomerTargets).not.toHaveBeenCalled();
    denied.clear();
    denied.add(platformTemplateArn("monthly-pass", "template"));
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.findRefundCustomerTargets).not.toHaveBeenCalled();
  });
  it("rejects denied generated resources, malformed IDs and duplicate recipients", async () => {
    const guard = await prepare();
    denied.add(platformCarpoolDeliveryTokenArn("payer", "denied"));
    await expect(guard!.checkDelivery("payer", "pass", "denied")).rejects.toMatchObject({ statusCode: 403 });
    expect(guard!.deliveries).toEqual([]);
    await expect(guard!.checkDelivery("other", "pass", "token")).rejects.toMatchObject({ statusCode: 403 });
    await expect(guard!.checkDelivery("payer", "../invalid", "token")).rejects.toMatchObject({ statusCode: 403 });
    denied.clear();
    await guard!.checkDelivery("payer", "pass", "token");
    await expect(guard!.checkDelivery("payer", "new-pass", "new-token")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed on missing context, malformed channels and missing decisions", async () => {
    await expect(service.prepare("actor", undefined, "order", "channel")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.prepare("actor", request(), "order", "../channel")).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeMany.mockResolvedValue([]);
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("preserves legacy enforcement in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    iam.authorizeMany.mockRejectedValue(new Error("fixture unavailable"));
    expect(await prepare()).toBeUndefined();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
  });
});
