import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayProbeMutationContext } from "@/store/relay/platform-relay-probe-mutation";
const { tx } = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    relayChannel: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), count: vi.fn() },
    relayChannelProbeProfile: { findMany: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
    relayChannelProbeRun: { count: vi.fn() },
    relayChannelProbeTargetConfig: { findMany: vi.fn(), upsert: vi.fn() },
  },
}));
vi.mock("@/store/relay/platform-relay-probe-mutation", () => ({
  mutatePlatformRelayProbe: async (
    _p: unknown,
    _u: unknown,
    _s: unknown,
    recheck: () => Promise<void>,
    callback: (client: unknown) => Promise<unknown>,
  ) => {
    const result = await callback(tx);
    await recheck();
    return result;
  },
}));
vi.mock("@/store/relay/relay-probe-read-target", () => ({
  relayProbeReadTarget: vi.fn(),
  relayProbeUpstreamConfigured: vi.fn(),
}));
vi.mock("@/store/users/platform-management-principal", () => ({ platformManagementGroupSnapshot: vi.fn() }));
import { RelayProbeTargetConfigureRepository } from "@/store/relay/relay-probe-target-configure.repository";
import { relayProbeReadTarget, relayProbeUpstreamConfigured } from "@/store/relay/relay-probe-read-target";
import { relayProbeProfileTemplateSelect } from "@/store/relay/relay-probe-profile-template";
import { getIamActionDefinition, Permission } from "@quyan/shared";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const authorize = vi.fn(),
  recheck = vi.fn(),
  visible = vi.fn();
const guard: RelayProbeMutationContext = {
  principal: { subjectUserId: "actor", principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
  snapshot: { group: { id: "global", updateTime: new Date(0) }, users: [] },
  authorize,
  recheck,
  visible,
  persist: true,
  authorizeAccountUnbind: vi.fn(),
  authorizeBoundProfileEdit: vi.fn(),
};
const repo = new RelayProbeTargetConfigureRepository(),
  target = { channelId: "target", probeModel: "override-model", probeGroup: "group" };
const configure = (persist = true) =>
  repo.configure(target, "source", "reserved-profile", false, { ...guard, persist });
beforeEach(() => {
  vi.resetAllMocks();
  authorize.mockResolvedValue(undefined);
  recheck.mockResolvedValue(undefined);
  visible.mockResolvedValue(true);
  vi.mocked(relayProbeReadTarget).mockResolvedValue({
    channel: { id: "target", channelType: "standalone", visibilityMode: "public", visibilityConfig: null },
    members: new Set(),
  });
  vi.mocked(relayProbeUpstreamConfigured).mockResolvedValue(true);
  tx.relayChannel.findFirst.mockResolvedValue({
    id: "source",
    channelType: "standalone",
    visibilityMode: "public",
    visibilityConfig: null,
  });
  tx.relayChannel.findUniqueOrThrow.mockResolvedValue({ allowedFormats: null, allowedModels: null });
  tx.relayChannelProbeRun.count.mockResolvedValue(0);
  tx.relayChannelProbeProfile.findMany.mockResolvedValue([
    { id: "source-profile", relayChannelId: "source", updateTime: new Date(0) },
  ]);
  tx.relayChannelProbeProfile.findUniqueOrThrow.mockResolvedValue({
    probeFormat: "openai-chat-completions",
    probeModel: "fixture-model",
    probePayload: {},
    workflow: [],
  });
  tx.relayChannelProbeTargetConfig.findMany.mockResolvedValue([]);
  tx.relayChannelProbeTargetConfig.upsert.mockResolvedValue({
    id: "config",
    profileId: "reserved-profile",
    targetChannelId: "target",
    probeFormat: null,
    probeModel: "override-model",
    probePayload: null,
    probeGroup: "group",
  });
});
describe("probe per-target configuration boundaries", () => {
  it("declares the fixed action and its bound-account edit dependency", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const file = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel-probe.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channel-probes/targets/configure",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:ConfigureProbeTarget"], issues: [] });
    const method = file.getClassOrThrow("RelayChannelProbeController").getMethodOrThrow("configureTargets").getText();
    expect(method).toContain("@ReplayProtected()");
    expect(method).toContain("@TwoFactorChallengeProtected");
    expect(getIamActionDefinition("quyan:relay:ConfigureProbeTarget")).toMatchObject({
      legacyPermission: Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      conditionalActions: ["quyan:relay:ModifyBoundProbeProfile"],
    });
  });
  it("shadow previews no source settings, payload or ciphertext", async () => {
    await expect(configure(false)).resolves.toBeUndefined();
    expect(tx.relayChannelProbeProfile.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.relayChannelProbeTargetConfig.upsert).not.toHaveBeenCalled();
  });
  it("selects only shareable source settings and writes profile plus target together", async () => {
    expect(await configure()).toEqual({ channelId: "target", probeModel: "override-model", probeGroup: "group" });
    expect(tx.relayChannelProbeProfile.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "source-profile", updateTime: new Date(0) },
      select: relayProbeProfileTemplateSelect,
    });
    expect(tx.relayChannelProbeProfile.create.mock.calls[0]![0].data).not.toHaveProperty("encryptedCredentials");
    expect(tx.relayChannelProbeTargetConfig.upsert.mock.calls[0]![0].update).toEqual({
      probeModel: "override-model",
      probeGroup: "group",
    });
    expect(tx.relayChannelProbeTargetConfig.upsert.mock.calls[0]![0].select).not.toHaveProperty("accountId");
  });
  it("resource denial precedes any profile hydration", async () => {
    authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    await expect(configure()).rejects.toThrow("denied");
    expect(tx.relayChannelProbeProfile.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("requires current source visibility", async () => {
    visible.mockResolvedValue(false);
    await expect(configure()).rejects.toMatchObject({ statusCode: 403 });
    expect(tx.relayChannelProbeProfile.findMany).not.toHaveBeenCalled();
  });
  it("requires every sibling for a shared profile replacement, not only the requested member", async () => {
    vi.mocked(relayProbeReadTarget).mockResolvedValue({
      channel: { id: "target", channelType: "pooled", visibilityMode: "public", visibilityConfig: null },
      members: new Set(["member", "sibling"]),
    });
    tx.relayChannel.count.mockResolvedValue(1);
    tx.relayChannelProbeProfile.findMany.mockResolvedValue([
      { id: "source-profile", relayChannelId: "source", updateTime: new Date(0) },
      { id: "target-profile", relayChannelId: "target", updateTime: new Date(0) },
    ]);
    authorize.mockImplementation(async (resources) => {
      if (resources.includes(platformRelayChannelArn("sibling"))) throw new Error("sibling denied");
    });
    await expect(
      repo.configure({ ...target, memberChannelId: "member" }, "source", "reserved", true, guard),
    ).rejects.toThrow("sibling denied");
    expect(tx.relayChannelProbeProfile.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("format changes without payload never leave a partially created profile", async () => {
    await expect(
      repo.configure({ ...target, probeFormat: "anthropic" }, "source", "reserved", false, guard),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(tx.relayChannelProbeProfile.create).not.toHaveBeenCalled();
    expect(tx.relayChannelProbeTargetConfig.upsert).not.toHaveBeenCalled();
  });
  it("active runs reject before source/template loading", async () => {
    tx.relayChannelProbeRun.count.mockResolvedValue(1);
    await expect(configure()).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.relayChannelProbeProfile.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("rechecks before source hydration and before persistence", async () => {
    recheck.mockRejectedValue(new Error("revoked"));
    await expect(configure()).rejects.toThrow("revoked");
    expect(tx.relayChannelProbeProfile.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.relayChannelProbeTargetConfig.upsert).not.toHaveBeenCalled();
  });
});
