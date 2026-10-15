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
import { RelayProbeLatestRunReadIamService } from "@/services/relay/relay-probe-latest-run-read-iam.service";
import { platformRelayProbeRunArn } from "@/iam/resources/platform-relay-probe-resources";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { getIamActionDefinition, isIamActionResourceCompatible, Permission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { latest: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  map = vi.fn(),
  legacy = vi.fn(),
  channels = { canAccessChannelMetadata: vi.fn() },
  service = new RelayProbeLatestRunReadIamService(iam, repository, snapshots, permissions, channels);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    secure: true,
  }) as unknown as TypedRequest;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  channels.canAccessChannelMetadata.mockResolvedValue(true);
  repository.latest.mockImplementation(async (_p, targets, decide, recheck, visible) => {
    await decide([
      platformRelayChannelArn(targets[0].channelId),
      platformRelayProbeRunArn(targets[0].channelId, "run"),
    ]);
    if (!(await visible({ visibilityMode: "public", visibilityConfig: null })))
      throw Object.assign(new Error("fixture denied"), { statusCode: 403 });
    await recheck();
    return [{ channelId: targets[0].channelId, latestRun: "native" }];
  });
  legacy.mockResolvedValue([{ channelId: "channel", latestRun: "legacy" }]);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
const body = { targets: [{ channelId: "channel" }] };
const latest = () => service.latest("actor", body, request(), map, legacy);
describe("probe latest-run polling authorization", () => {
  it("registers the fixed operation and channel/run resource types", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel-probe.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channel-probes/runs/latest",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:ListLatestProbeRuns"], issues: [] });
    expect(getIamActionDefinition("quyan:relay:ListLatestProbeRuns")).toMatchObject({
      authorizationBoundary: "platform",
      resourceTypes: ["platform/relay-channel", "platform/relay-probe-run"],
      legacyPermission: Permission.RELAY_CHANNEL_PROBE_READ,
    });
    expect(
      isIamActionResourceCompatible("quyan:relay:ListLatestProbeRuns", platformRelayProbeRunArn("channel", "run")),
    ).toBe(true);
  });
  it("evaluates the server action and preserves the shared channel visibility rules", async () => {
    expect(await latest()).toEqual([{ channelId: "channel", latestRun: "native" }]);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:relay:ListLatestProbeRuns" }),
    );
    expect(channels.canAccessChannelMetadata).toHaveBeenCalledWith(
      { visibilityMode: "public", visibilityConfig: null },
      "actor",
      undefined,
    );
    expect(legacy).not.toHaveBeenCalled();
  });
  it("rejects a failed visibility gate", async () => {
    channels.canAccessChannelMetadata.mockResolvedValue(false);
    await expect(latest()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([
    { targets: [] },
    { targets: [{ channelId: "channel" }, { channelId: "channel" }] },
    { targets: Array.from({ length: 201 }, (_v, i) => ({ channelId: String(i) })) },
  ])("rejects invalid polling batches", async (invalid) => {
    await expect(service.latest("actor", invalid, request(), map, legacy)).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.latest).not.toHaveBeenCalled();
  });
  it("rejects an unsafe resource identifier before loading run data", async () => {
    await expect(
      service.latest("actor", { targets: [{ channelId: "../foreign" }] }, request(), map, legacy),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.latest).not.toHaveBeenCalled();
  });
  it("requires platform qualification and a stable policy set", async () => {
    snapshots.snapshot.mockRejectedValueOnce(new Error("fixture revoked"));
    await expect(latest()).rejects.toThrow();
    snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
    snapshots.recheck.mockRejectedValue(new Error("fixture changed"));
    await expect(latest()).rejects.toThrow();
  });
  it.each([undefined, "delegated", "oauth", "wrong-actor"])("rejects invalid principal context %s", async (kind) => {
    const req = kind === undefined ? undefined : request();
    if (kind === "delegated") req!.authContext!.principalUserId = "issuer";
    if (kind === "oauth") req!.oauthAccessToken = {} as TypedRequest["oauthAccessToken"];
    await expect(
      service.latest(kind === "wrong-actor" ? "other" : "actor", body, req, map, legacy),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("keeps legacy permission enforcement in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    repository.latest.mockRejectedValue(new Error("fixture denied"));
    expect(await latest()).toEqual([{ channelId: "channel", latestRun: "legacy" }]);
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(latest()).rejects.toMatchObject({ statusCode: 403 });
  });
});
