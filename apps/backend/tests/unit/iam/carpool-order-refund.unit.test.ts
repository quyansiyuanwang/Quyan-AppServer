import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformCarpoolOrderRefundIamService } from "@/services/billing/platform-carpool-order-refund-iam.service";
import {
  platformCarpoolOrderArn,
  platformCarpoolRefundAccountArn,
  platformCarpoolRefundLedgerArn,
} from "@/iam/resources/platform-carpool-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { getIamActionDefinition, isIamActionResourceCompatible, Permission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  iam = { authorizeMany: vi.fn(), loadPolicies: vi.fn() },
  repository = { findOrderRefundTarget: vi.fn(), findRefundCustomerTargets: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformCarpoolOrderRefundIamService(iam, repository, snapshots, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    secure: true,
  }) as unknown as TypedRequest;
const prepare = () => service.prepare("actor", request(), "order", "Fixture refund");
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
  repository.findOrderRefundTarget.mockResolvedValue({
    id: "order",
    state: "accepted",
    status: 1,
    members: [{ id: "member", userId: "payer", state: "confirmed", reservation: null }],
  });
  repository.findRefundCustomerTargets.mockResolvedValue([
    { id: "payer", status: 1, accountOwnerId: null, updateTime: new Date(0) },
  ]);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("carpool refund resource authority", () => {
  it("registers the fixed Action and bounds money writes to real platform resources", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/billing/carpool.controller.ts");
    const action = "quyan:carpool:FailOrder";
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/carpools/admin/{id}/fail",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], issues: [] });
    expect(getIamActionDefinition(action)).toMatchObject({
      authorizationBoundary: "platform",
      legacyPermission: Permission.CARPOOL_ORDER_FULFILL,
    });
    const guard = await prepare();
    await guard!.checkLedger("payer", "ledger");
    for (const resource of [
      platformCarpoolOrderArn("order"),
      platformUserArn("payer"),
      platformCarpoolRefundAccountArn("payer"),
      platformCarpoolRefundLedgerArn("payer", "ledger"),
    ]) {
      expect(isIamActionResourceCompatible(action, resource)).toBe(true);
      expect(iam.authorizeMany.mock.calls.some(([input]) => input.resources.includes(resource))).toBe(true);
    }
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === action)).toBe(true);
  });
  it("authorizes the order before reading its source", async () => {
    denied.add(platformCarpoolOrderArn("order"));
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.findOrderRefundTarget).not.toHaveBeenCalled();
  });
  it.each(["user", "account"])("does not hydrate denied %s targets", async (resource) => {
    denied.add(resource === "user" ? platformUserArn("payer") : platformCarpoolRefundAccountArn("payer"));
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.findRefundCustomerTargets).not.toHaveBeenCalled();
  });
  it("requires a ledger grant and rejects unknown recipients, invalid IDs and duplicate entries", async () => {
    const guard = await prepare();
    denied.add(platformCarpoolRefundLedgerArn("payer", "denied"));
    await expect(guard!.checkLedger("payer", "denied")).rejects.toMatchObject({ statusCode: 403 });
    expect(guard!.ledgers).toEqual([]);
    await expect(guard!.checkLedger("other", "ledger")).rejects.toMatchObject({ statusCode: 403 });
    await expect(guard!.checkLedger("payer", "../invalid")).rejects.toMatchObject({ statusCode: 403 });
    denied.clear();
    await guard!.checkLedger("payer", "ledger");
    await expect(guard!.checkLedger("payer", "duplicate")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed on missing context, invalid reasons and absent decisions", async () => {
    await expect(service.prepare("actor", undefined, "order", "reason")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.prepare("actor", request(), "order", "")).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeMany.mockResolvedValue([]);
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    env.security.iamAuthorizationMode = "unknown" as typeof mode;
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires persisted management qualification", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("fixture no qualification"));
    await expect(prepare()).rejects.toThrow();
    expect(repository.findOrderRefundTarget).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("retains legacy enforcement in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    iam.authorizeMany.mockRejectedValue(new Error("fixture native unavailable"));
    expect(await prepare()).toBeUndefined();
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith(
      "actor",
      [Permission.CARPOOL_ORDER_FULFILL],
      expect.anything(),
    );
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
  });
});
