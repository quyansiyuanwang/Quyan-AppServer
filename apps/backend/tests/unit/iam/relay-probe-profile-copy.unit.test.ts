import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayProbeMutationContext } from "@/store/relay/platform-relay-probe-mutation";
const { tx } = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    relayChannel: { findMany: vi.fn(), findUniqueOrThrow: vi.fn(), count: vi.fn() },
    relayChannelProbeProfile: { findMany: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
    relayChannelProbeRun: { count: vi.fn() },
    relayChannelProbeTargetConfig: { findMany: vi.fn() },
  },
}));
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
vi.mock("@/store/users/platform-management-principal", () => ({ platformManagementGroupSnapshot: vi.fn() }));
import { RelayProbeProfileCopyRepository } from "@/store/relay/relay-probe-profile-copy.repository";
import { relayProbeProfileTemplateSelect, copyProbeProfileSettings } from "@/store/relay/relay-probe-profile-template";
import { getIamActionDefinition, Permission } from "@quyan/shared";
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
const repository = new RelayProbeProfileCopyRepository();
const copy = (persist = true) =>
  repository.copy("source", "target", "reserved-profile", true, { ...guard, persist }, (row) => row.id);
beforeEach(() => {
  vi.resetAllMocks();
  authorize.mockResolvedValue(undefined);
  recheck.mockResolvedValue(undefined);
  visible.mockResolvedValue(true);
  tx.relayChannel.findMany.mockResolvedValue(
    ["source", "target"].map((id) => ({
      id,
      channelType: "standalone",
      visibilityMode: "public",
      visibilityConfig: null,
    })),
  );
  tx.relayChannelProbeProfile.findMany.mockResolvedValue([
    { id: "source-profile", relayChannelId: "source", updateTime: new Date(0) },
  ]);
  tx.relayChannelProbeRun.count.mockResolvedValue(0);
  tx.relayChannel.count.mockResolvedValue(1);
  tx.relayChannel.findUniqueOrThrow.mockResolvedValue({ allowedFormats: null, allowedModels: null });
  tx.relayChannelProbeProfile.findUniqueOrThrow.mockResolvedValue({
    probeFormat: "openai",
    probeModel: "fixture-model",
    probePayload: {},
    workflow: [],
  });
  tx.relayChannelProbeProfile.create.mockResolvedValue({ id: "reserved-profile", relayChannelId: "target" });
});
describe("probe profile copy policy boundary", () => {
  it("declares CopyProbeProfile and preserves replay/step-up controls", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const file = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel-probe.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channel-probes/profiles/batch-copy",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:CopyProbeProfile"], issues: [] });
    const method = file.getClassOrThrow("RelayChannelProbeController").getMethodOrThrow("copyProfile").getText();
    expect(method).toContain("@ReplayProtected()");
    expect(method).toContain("@TwoFactorChallengeProtected");
    expect(getIamActionDefinition("quyan:relay:CopyProbeProfile")).toMatchObject({
      legacyPermission: Permission.RELAY_CHANNEL_PROBE_EXECUTE,
      conditionalActions: ["quyan:relay:ModifyBoundProbeProfile"],
    });
  });
  it("source template projection and conversion never contain ciphertext or bindings", () => {
    expect(Object.keys(relayProbeProfileTemplateSelect).some((key) => /credential|account|target/i.test(key))).toBe(
      false,
    );
    const keys = Object.keys(
      copyProbeProfileSettings({
        ...Object.fromEntries(Object.keys(relayProbeProfileTemplateSelect).map((key) => [key, null])),
        encryptedCredentials: "fixture-never-copy",
      } as unknown as Parameters<typeof copyProbeProfileSettings>[0]),
    );
    expect(keys).toEqual(Object.keys(relayProbeProfileTemplateSelect));
  });
  it("does not hydrate settings or source credentials for shadow previews", async () => {
    await expect(copy(false)).resolves.toBeUndefined();
    expect(tx.relayChannelProbeProfile.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.relayChannelProbeProfile.create).not.toHaveBeenCalled();
  });
  it("authorizes both profiles before selecting the shareable source projection", async () => {
    await expect(copy()).resolves.toBe("reserved-profile");
    expect(tx.relayChannelProbeProfile.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "source-profile", updateTime: new Date(0) },
      select: relayProbeProfileTemplateSelect,
    });
    expect(tx.relayChannelProbeProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: "reserved-profile", relayChannelId: "target" }) }),
    );
    expect(tx.relayChannelProbeProfile.create.mock.calls[0]![0].data).not.toHaveProperty("encryptedCredentials");
    expect(recheck).toHaveBeenCalled();
  });
  it("refuses denied source/target resources before full template selection", async () => {
    authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    await expect(copy()).rejects.toThrow("denied");
    expect(tx.relayChannelProbeProfile.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("cannot hide an active target behind a copy operation", async () => {
    tx.relayChannelProbeRun.count.mockResolvedValue(1);
    await expect(copy()).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.relayChannelProbeProfile.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("rejects stale or foreign target bindings", async () => {
    tx.relayChannelProbeProfile.findMany.mockResolvedValue([
      { id: "source-profile", relayChannelId: "source", updateTime: new Date(0) },
      { id: "target-profile", relayChannelId: "target", updateTime: new Date(0) },
    ]);
    tx.relayChannelProbeTargetConfig.findMany.mockResolvedValue([{ targetChannelId: "foreign", accountId: null }]);
    await expect(copy()).rejects.toMatchObject({ statusCode: 403 });
    expect(tx.relayChannelProbeProfile.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("checks source/target visibility independently", async () => {
    visible.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(copy()).rejects.toMatchObject({ statusCode: 403 });
    expect(tx.relayChannelProbeProfile.findMany).not.toHaveBeenCalled();
  });
  it("refuses aliasing source and target before taking a lock", async () => {
    await expect(repository.copy("same", "same", "reserved", true, guard, (row) => row.id)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
