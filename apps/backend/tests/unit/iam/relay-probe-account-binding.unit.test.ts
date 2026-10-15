import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayProbeMutationContext } from "@/store/relay/platform-relay-probe-mutation";
const { tx } = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    relayChannel: { findFirst: vi.fn(), count: vi.fn() },
    relayChannelProbeProfile: { findUnique: vi.fn() },
    relayChannelProbeRun: { count: vi.fn() },
    relayChannelProbeTargetConfig: { findUnique: vi.fn(), upsert: vi.fn() },
    relayChannelProbeAccount: { findUnique: vi.fn() },
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
import { RelayProbeAccountBindingRepository } from "@/store/relay/relay-probe-account-binding.repository";
import { platformRelayProbeAccountArn } from "@/iam/resources/platform-relay-probe-resources";
import { getIamActionDefinition, Permission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const authorize = vi.fn(),
  unbind = vi.fn(),
  recheck = vi.fn(),
  visible = vi.fn();
const guard: RelayProbeMutationContext = {
  principal: { subjectUserId: "actor", principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
  snapshot: { group: { id: "global", updateTime: new Date(0) }, users: [] },
  authorize,
  recheck,
  visible,
  persist: true,
  authorizeAccountUnbind: unbind,
  authorizeBoundProfileEdit: vi.fn(),
};
const repo = new RelayProbeAccountBindingRepository(),
  target = { channelId: "channel", accountId: "new-account" };
beforeEach(() => {
  vi.resetAllMocks();
  authorize.mockResolvedValue(undefined);
  unbind.mockResolvedValue(undefined);
  recheck.mockResolvedValue(undefined);
  visible.mockResolvedValue(true);
  tx.relayChannel.findFirst.mockResolvedValue({
    id: "channel",
    channelType: "standalone",
    visibilityMode: "public",
    visibilityConfig: null,
  });
  tx.relayChannelProbeProfile.findUnique.mockResolvedValue({ id: "profile" });
  tx.relayChannelProbeRun.count.mockResolvedValue(0);
  tx.relayChannelProbeTargetConfig.findUnique.mockResolvedValue({ id: "config", accountId: "old-account" });
  tx.relayChannelProbeAccount.findUnique.mockImplementation(async ({ where }) => ({ id: where.id }));
  tx.relayChannelProbeTargetConfig.upsert.mockResolvedValue({
    id: "config",
    profileId: "profile",
    targetChannelId: "channel",
    accountId: "new-account",
  });
});
describe("probe binding permission boundaries", () => {
  it("declares account-management action with explicit old-account unbind dependency", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const file = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel-probe.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channel-probes/accounts/bindings",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:BindProbeAccount"], issues: [] });
    const method = file.getClassOrThrow("RelayChannelProbeController").getMethodOrThrow("bindAccounts").getText();
    expect(method).toContain("@ReplayProtected()");
    expect(method).toContain("@TwoFactorChallengeProtected");
    expect(getIamActionDefinition("quyan:relay:BindProbeAccount")).toMatchObject({
      legacyPermission: Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE,
      conditionalActions: ["quyan:relay:UnbindProbeAccount"],
    });
  });
  it("requires distinct old and new account grants before an atomic replacement", async () => {
    expect(await repo.bind(target, guard)).toEqual(target);
    expect(unbind).toHaveBeenCalledWith([platformRelayProbeAccountArn("old-account")]);
    expect(authorize).toHaveBeenCalledWith([platformRelayProbeAccountArn("new-account")]);
    expect(tx.relayChannelProbeTargetConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { accountId: "new-account" } }),
    );
  });
  it("never reads account ciphertext or workflow configuration", async () => {
    await repo.bind(target, guard);
    for (const [input] of tx.relayChannelProbeAccount.findUnique.mock.calls) expect(input.select).toEqual({ id: true });
    expect(tx.relayChannelProbeProfile.findUnique).toHaveBeenCalledWith({
      where: { relayChannelId: "channel" },
      select: { id: true },
    });
    expect(tx.relayChannelProbeTargetConfig.findUnique.mock.calls[0]![0].select).toEqual({ id: true, accountId: true });
    expect(tx.relayChannelProbeTargetConfig.upsert.mock.calls[0]![0].select).toEqual({
      id: true,
      profileId: true,
      targetChannelId: true,
      accountId: true,
    });
  });
  it("a denied old-account unbind prevents looking up or writing the new account", async () => {
    unbind.mockRejectedValue(new Error("old account denied"));
    await expect(repo.bind(target, guard)).rejects.toThrow("old account denied");
    expect(tx.relayChannelProbeAccount.findUnique).not.toHaveBeenCalled();
    expect(tx.relayChannelProbeTargetConfig.upsert).not.toHaveBeenCalled();
  });
  it("an idempotent bind does not request an unrelated unbind", async () => {
    tx.relayChannelProbeTargetConfig.findUnique.mockResolvedValue({ id: "config", accountId: "new-account" });
    await repo.bind(target, guard);
    expect(unbind).not.toHaveBeenCalled();
  });
  it("shadow checks all grants without writing bindings", async () => {
    await expect(repo.bind(target, { ...guard, persist: false })).resolves.toBeUndefined();
    expect(unbind).toHaveBeenCalled();
    expect(tx.relayChannelProbeTargetConfig.upsert).not.toHaveBeenCalled();
  });
  it("active work prevents binding mutation", async () => {
    tx.relayChannelProbeRun.count.mockResolvedValue(1);
    await expect(repo.bind(target, guard)).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.relayChannelProbeTargetConfig.upsert).not.toHaveBeenCalled();
  });
  it("cannot bind without a matching persisted profile", async () => {
    tx.relayChannelProbeProfile.findUnique.mockResolvedValue(null);
    await expect(repo.bind(target, guard)).rejects.toMatchObject({ statusCode: 400 });
    expect(tx.relayChannelProbeAccount.findUnique).not.toHaveBeenCalled();
  });
  it("a refused parent visibility blocks profile/binding reads", async () => {
    visible.mockResolvedValue(false);
    await expect(repo.bind(target, guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(tx.relayChannelProbeProfile.findUnique).not.toHaveBeenCalled();
  });
  it("current authority is checked again before persistence", async () => {
    recheck.mockRejectedValue(new Error("revoked"));
    await expect(repo.bind(target, guard)).rejects.toThrow("revoked");
    expect(tx.relayChannelProbeTargetConfig.upsert).not.toHaveBeenCalled();
  });
});
