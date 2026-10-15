import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayProbeMutationContext } from "@/store/relay/platform-relay-probe-mutation";
const { tx } = vi.hoisted(() => ({ tx: { relayChannel: { findFirst: vi.fn(), count: vi.fn(), findMany: vi.fn() } } }));
vi.mock("@/store/relay/platform-relay-probe-mutation", () => ({
  mutatePlatformRelayProbe: async (
    _permission: unknown,
    _principal: unknown,
    _snapshot: unknown,
    recheck: () => Promise<void>,
    operation: (client: unknown) => Promise<unknown>,
  ) => {
    const result = await operation(tx);
    await recheck();
    return result;
  },
}));
import { RelayProbeBatchTargetRepository } from "@/store/relay/relay-probe-batch-target.repository";
import { RELAY_PROBE_BATCH_POLICY } from "@/constant/relay-probe";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { Permission } from "@quyan/shared";
import { getIamActionDefinition } from "@quyan/shared";
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
const repository = new RelayProbeBatchTargetRepository();
beforeEach(() => {
  vi.resetAllMocks();
  authorize.mockResolvedValue(undefined);
  recheck.mockResolvedValue(undefined);
  visible.mockResolvedValue(true);
  tx.relayChannel.findFirst.mockResolvedValue({
    id: "pool",
    channelType: "pooled",
    visibilityMode: "public",
    visibilityConfig: null,
  });
  tx.relayChannel.count.mockResolvedValue(1);
  tx.relayChannel.findMany.mockResolvedValue([{ id: "member" }]);
});
describe("credential-free batch target discovery", () => {
  it("declares the same fixed CreateProbeRun Action for batch scheduling with HTTP safety guards", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const file = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel-probe.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channel-probes/runs/batch",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:CreateProbeRun"], issues: [] });
    const method = file.getClassOrThrow("RelayChannelProbeController").getMethodOrThrow("createRuns").getText();
    expect(method).toContain("@ReplayProtected()");
    expect(method).toContain("@TwoFactorChallengeProtected");
    expect(method).toContain("this.service.createRuns(body, request.user!.userId, request)");
    expect(getIamActionDefinition("quyan:relay:CreateProbeRun")).toMatchObject({
      legacyPermission: Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      apiRoutes: expect.arrayContaining(["POST /v1/relay-channel-probes/runs/batch"]),
    });
  });
  it("authorizes parent before reading even topology metadata", async () => {
    authorize.mockRejectedValue(new Error("denied"));
    await expect(repository.expand("pool", guard)).rejects.toThrow("denied");
    expect(tx.relayChannel.findFirst).not.toHaveBeenCalled();
  });
  it("uses only bounded id projections and current strict topology", async () => {
    expect(await repository.expand("pool", guard)).toEqual([{ channelId: "pool", memberChannelId: "member" }]);
    expect(tx.relayChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true },
        take: RELAY_PROBE_BATCH_POLICY.targets + 1,
        where: expect.objectContaining({ pooledParentId: "pool", pooledMemberEnabled: true }),
      }),
    );
    expect(tx.relayChannel.findFirst.mock.calls[0]![0].select).toEqual({
      id: true,
      channelType: true,
      visibilityMode: true,
      visibilityConfig: true,
    });
    expect(authorize).toHaveBeenCalledWith([platformRelayChannelArn("member")]);
    expect(recheck).toHaveBeenCalled();
  });
  it("only uses legacy membership when no strict row exists", async () => {
    tx.relayChannel.count.mockResolvedValue(0);
    await repository.expand("pool", guard);
    expect(tx.relayChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ memberOfPools: { some: { relayChannelId: "pool", enabled: true } } }),
      }),
    );
  });
  it("filters denied discovered ids and never returns them", async () => {
    tx.relayChannel.findMany.mockResolvedValue([{ id: "denied-member" }, { id: "allowed-member" }]);
    authorize.mockImplementation(async (resources) => {
      if (resources.includes(platformRelayChannelArn("denied-member"))) throw new Error("deny");
    });
    expect(await repository.expand("pool", guard)).toEqual([{ channelId: "pool", memberChannelId: "allowed-member" }]);
  });
  it("all denied/deleted/disabled strict members never trigger legacy fallback", async () => {
    tx.relayChannel.findMany.mockResolvedValue([]);
    await expect(repository.expand("pool", guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(tx.relayChannel.findMany).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized discovery before resource scheduling", async () => {
    tx.relayChannel.findMany.mockResolvedValue(
      Array.from({ length: RELAY_PROBE_BATCH_POLICY.targets + 1 }, (_, index) => ({ id: `member-${index}` })),
    );
    await expect(repository.expand("pool", guard)).rejects.toMatchObject({ statusCode: 400 });
    expect(authorize).toHaveBeenCalledTimes(1);
  });
  it("does not enumerate members when parent visibility is refused", async () => {
    visible.mockResolvedValue(false);
    await expect(repository.expand("pool", guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(tx.relayChannel.findMany).not.toHaveBeenCalled();
  });
  it("rechecks authorization before publishing discovered target ids", async () => {
    recheck.mockRejectedValue(new Error("revoked"));
    await expect(repository.expand("pool", guard)).rejects.toThrow("revoked");
  });
  it("handles standalone targets without looking at members", async () => {
    tx.relayChannel.findFirst.mockResolvedValue({ id: "standalone", channelType: "standalone" });
    expect(await repository.expand("standalone", guard)).toEqual([{ channelId: "standalone" }]);
    expect(tx.relayChannel.findMany).not.toHaveBeenCalled();
  });
});
