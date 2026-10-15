vi.mock("@/services/relay/relay-channel.service", () => ({ RelayChannelService: { getInstance: vi.fn() } }));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { RelayProbeMutationIamService } from "@/services/relay/relay-probe-mutation-iam.service";
import { platformRelayProbeRunArn } from "@/iam/resources/platform-relay-probe-resources";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { getIamActionDefinition, isIamActionResourceCompatible, Permission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  channels = { canAccessChannelMetadata: vi.fn() },
  legacy = vi.fn(),
  mutate = vi.fn(),
  service = new RelayProbeMutationIamService(iam, snapshots, permissions, channels);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    secure: true,
  }) as unknown as TypedRequest;
const clear = (req = request(), actor = "actor") =>
  service.mutate("quyan:relay:ClearProbeHistory", actor, req, mutate, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  channels.canAccessChannelMetadata.mockResolvedValue(true);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  mutate.mockImplementation(async ({ authorize, recheck, persist }) => {
    await authorize([platformRelayChannelArn("channel"), platformRelayProbeRunArn("channel", "run")]);
    await recheck();
    return { deleted: persist ? 1 : 0 };
  });
  legacy.mockResolvedValue({ deleted: 2 });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("probe history cleanup authorization", () => {
  it("declares the fixed action and retains replay and step-up middleware", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const file = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel-probe.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "DELETE /v1/relay-channel-probes/{channelId}/runs",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:ClearProbeHistory"], issues: [] });
    const method = file.getClassOrThrow("RelayChannelProbeController").getMethodOrThrow("clearRunHistory").getText();
    expect(method).toContain("@ReplayProtected()");
    expect(method).toContain("@TwoFactorChallengeProtected");
    expect(getIamActionDefinition("quyan:relay:ClearProbeHistory")).toMatchObject({
      accessLevel: "Write",
      legacyPermission: Permission.RELAY_CHANNEL_PROBE_EXECUTE,
    });
    expect(
      isIamActionResourceCompatible("quyan:relay:ClearProbeHistory", platformRelayProbeRunArn("channel", "run")),
    ).toBe(true);
  });
  it("authorizes all resources using a server-fixed action", async () => {
    expect(await clear()).toEqual({ deleted: 1 });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:relay:ClearProbeHistory" }),
    );
    expect(legacy).not.toHaveBeenCalled();
  });
  it("rejects any deny among related resources", async () => {
    iam.authorizeMany.mockResolvedValue([{ decision: "Allow" }, { decision: "ExplicitDeny" }]);
    await expect(clear()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a grant revoked at the final check", async () => {
    let evaluated = false;
    iam.authorizeMany.mockImplementation(async ({ resources }) => {
      const rows = resources.map(() => ({ decision: evaluated ? "ExplicitDeny" : "Allow" }));
      evaluated = true;
      return rows;
    });
    await expect(clear()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)(
    "previews without writes and keeps permission enforcement in %s",
    async (selected) => {
      env.security.iamAuthorizationMode = selected;
      expect(await clear()).toEqual({ deleted: 2 });
      expect(legacy).toHaveBeenCalledOnce();
      if (selected === "shadow") expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ persist: false }));
      else expect(mutate).not.toHaveBeenCalled();
      permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
      await expect(clear()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it.each(["delegated", "oauth", "actor"])("rejects an unsafe %s identity", async (kind) => {
    const req = request();
    if (kind === "delegated") req.authContext!.principalUserId = "issuer";
    if (kind === "oauth") req.oauthAccessToken = {} as TypedRequest["oauthAccessToken"];
    await expect(clear(req, kind === "actor" ? "other" : "actor")).rejects.toMatchObject({ statusCode: 403 });
    expect(mutate).not.toHaveBeenCalled();
  });
  it("requires a trusted request outside legacy", async () => {
    await expect(
      service.mutate("quyan:relay:ClearProbeHistory", "actor", undefined, mutate, legacy),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
