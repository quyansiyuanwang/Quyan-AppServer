import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformRelayChannelManagementReadIamService } from "@/services/relay/platform-relay-channel-management-read-iam.service";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { getIamActionDefinition, Permission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { list: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  resolver = { resolveChannelCapabilities: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = vi.fn(),
  visibility = vi.fn();
const service = new PlatformRelayChannelManagementReadIamService(iam, repository, snapshots, resolver, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    secure: true,
  }) as unknown as TypedRequest;
const list = () => service.list("actor", request(), {}, visibility, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  snapshots.recheck.mockResolvedValue(undefined);
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  visibility.mockResolvedValue(undefined);
  legacy.mockResolvedValue({ items: [], total: 7, page: 1, pageSize: 25 });
  repository.list.mockImplementation(async (_principal, _query, decide, recheck) => {
    await decide([platformRelayChannelArn("channel")]);
    await recheck();
    return { records: [], total: 1 };
  });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("Relay management collection authority", () => {
  it("declares a fixed Action and preserves the credential-free list wire format", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "GET /v1/relay-channels/management",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:ListManagementChannels"], issues: [] });
    expect(getIamActionDefinition("quyan:relay:ListManagementChannels")).toMatchObject({
      authorizationBoundary: "platform",
      legacyPermissions: [Permission.RELAY_CHANNEL_READ, Permission.RELAY_CHANNEL_REVIEW],
    });
    expect(await list()).toEqual({ items: [], total: 1, page: 1, pageSize: 25 });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:relay:ListManagementChannels" }),
    );
    expect(legacy).not.toHaveBeenCalled();
  });
  it("keeps visibility predicates and computes model any/all from the provided authorized graph", async () => {
    visibility.mockResolvedValue({ visibilityMode: "public" });
    resolver.resolveChannelCapabilities.mockResolvedValue([{ catalogModelName: "alpha" }]);
    const outcomes: boolean[] = [];
    repository.list.mockImplementation(async (_principal, query, _decide, _recheck, matches) => {
      expect(query.where.AND).toEqual([{ visibilityMode: "public" }]);
      outcomes.push(await matches("root", { graph: new Map(), modelCatalog: [] }));
      return { records: [], total: 0 };
    });
    await service.list("actor", request(), { models: ["alpha", "beta"], modelMatchMode: "any" }, visibility, legacy);
    await service.list("actor", request(), { models: ["alpha", "beta"], modelMatchMode: "all" }, visibility, legacy);
    expect(outcomes).toEqual([true, false]);
  });
  it("requires identity, qualification and stable policy fingerprints", async () => {
    await expect(service.list("actor", undefined, {}, visibility, legacy)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list("foreign", request(), {}, visibility, legacy)).rejects.toMatchObject({ statusCode: 403 });
    snapshots.recheck.mockRejectedValue(new Error("fixture revoked"));
    await expect(list()).rejects.toThrow();
    expect(repository.list).not.toHaveBeenCalled();
    snapshots.recheck.mockResolvedValue(undefined);
    iam.loadPolicies
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ policyId: "changed" }]);
    await expect(list()).rejects.toThrow();
  });
  it("rejects malformed filters and missing decision arrays", async () => {
    await expect(service.list("actor", request(), { pageSize: 101 }, visibility, legacy)).rejects.toMatchObject({
      statusCode: 400,
    });
    iam.authorizeMany.mockResolvedValue([]);
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)(
    "preserves either legacy read or review qualification in %s",
    async (selected) => {
      env.security.iamAuthorizationMode = selected;
      permissions.checkUserPermissions.mockImplementation(async (_actor, [permission]) => ({
        hasPermission: permission === Permission.RELAY_CHANNEL_REVIEW,
      }));
      repository.list.mockRejectedValue(new Error("fixture unavailable"));
      expect(await list()).toMatchObject({ total: 7 });
      permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
      await expect(list()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
});
