import { beforeEach, describe, expect, it, vi } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { RelayProbeMutationContext } from "@/store/relay/platform-relay-probe-mutation";
const { tx, lookup } = vi.hoisted(() => ({
  lookup: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    relayChannel: { findUniqueOrThrow: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    relayChannelProbeRun: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    relayChannelProbeProfile: { findFirst: vi.fn() },
    relayChannelProbeTargetConfig: { findUnique: vi.fn() },
    relayConfig: { findFirst: vi.fn() },
    modelPricing: { findMany: vi.fn() },
  },
}));
vi.mock("@/config/database", () => ({ prisma: { relayChannelProbeRun: { findUnique: lookup } } }));
vi.mock("@/store/relay/platform-relay-probe-mutation", () => ({
  mutatePlatformRelayProbe: async (
    _p: unknown,
    _u: unknown,
    _s: unknown,
    recheck: () => Promise<void>,
    fn: (tx: unknown) => Promise<unknown>,
  ) => {
    const result = await fn(tx);
    await recheck();
    return result;
  },
}));
vi.mock("@/store/relay/relay-probe-read-target", () => ({ relayProbeReadTarget: vi.fn() }));
import { RelayProbeRunApplyRepository } from "@/store/relay/relay-probe-run-apply.repository";
import { relayProbeReadTarget } from "@/store/relay/relay-probe-read-target";
import { buildProbePricingSnapshot, fingerprintProbePricing } from "@/services/relay/relay-probe-pricing";
import { platformRelayProbeRunArn } from "@/iam/resources/platform-relay-probe-resources";
import { projectRelayModelRates } from "@/services/relay/relay-configuration-projection";
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
const repo = new RelayProbeRunApplyRepository(),
  withLock = vi.fn(async (_id, fn) => fn());
const apply = (persist = true, value?: number, force = false) =>
  repo.apply("run", value, force, { ...guard, persist }, withLock);
const identity = { id: "run", relayChannelId: "channel", profileId: "profile", probeMemberChannelId: null };
const profile = {
  probeModel: "fixture-model",
  probeFormat: "openai-chat-completions",
  probeEndpoint: "openai-chat-completions",
  cacheMode: "cache-bust",
};
const billing = {
  multiplier: 1,
  updateTime: new Date(0),
  timePeriodMultipliers: null,
  contextLengthMultipliers: null,
  inputTokensIncludeCacheRead: false,
  modelMapping: null,
};
const pricing = {
  id: "pricing",
  model: "fixture-model",
  status: 1,
  createTime: new Date(0),
  updateTime: new Date(0),
  pricingType: "token-based",
  inputPrice: 1,
  outputPrice: 2,
  fixedPrice: null,
  cacheCreationMultiplier: 1.25,
  cacheReadMultiplier: 0.1,
  supportedFormats: null,
  provider: null,
};
const fingerprint = () =>
  fingerprintProbePricing(
    buildProbePricingSnapshot(profile, billing, null, projectRelayModelRates([pricing as never])[0]!, 1),
  );
beforeEach(() => {
  vi.resetAllMocks();
  authorize.mockResolvedValue(undefined);
  recheck.mockResolvedValue(undefined);
  visible.mockResolvedValue(true);
  lookup.mockResolvedValue(identity);
  vi.mocked(relayProbeReadTarget).mockResolvedValue({
    channel: { id: "channel", channelType: "standalone", visibilityMode: "public", visibilityConfig: null },
    members: new Set(),
  });
  tx.relayChannel.findUniqueOrThrow.mockResolvedValue(billing);
  tx.relayChannel.count.mockResolvedValue(0);
  tx.relayChannelProbeRun.findUnique.mockResolvedValue({
    ...identity,
    status: "succeeded",
    calibrationStatus: "verified",
    finishedAt: new Date(),
    suggestedMultiplier: 1.1,
    sourceChannelMultiplier: 1,
    pricingFingerprint: fingerprint(),
    appliedAt: null,
    updateTime: new Date(0),
  });
  tx.relayChannelProbeProfile.findFirst.mockResolvedValue(profile);
  tx.relayChannelProbeTargetConfig.findUnique.mockResolvedValue(null);
  tx.relayConfig.findFirst.mockResolvedValue({ globalMultiplier: 1 });
  tx.modelPricing.findMany.mockResolvedValue([pricing]);
  tx.relayChannel.updateMany.mockResolvedValue({ count: 1 });
  tx.relayChannelProbeRun.updateMany.mockResolvedValue({ count: 1 });
});
describe("probe result application trust boundaries", () => {
  it("declares a fixed server action while retaining replay and step-up guards", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const file = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel-probe.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channel-probes/runs/apply",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:ApplyProbeRun"], issues: [] });
    const method = file.getClassOrThrow("RelayChannelProbeController").getMethodOrThrow("applyRuns").getText();
    expect(method).toContain("@ReplayProtected()");
    expect(method).toContain("@TwoFactorChallengeProtected");
    expect(getIamActionDefinition("quyan:relay:ApplyProbeRun")).toMatchObject({
      legacyPermission: Permission.RELAY_CHANNEL_MULTIPLIER_ADJUST,
      resourceTypes: ["platform/relay-channel", "platform/relay-probe-profile", "platform/relay-probe-run"],
    });
  });
  it("reads identity only before authorization, never a full run or relation", async () => {
    authorize.mockRejectedValue(new Error("denied"));
    await expect(apply()).rejects.toThrow("denied");
    expect(lookup).toHaveBeenCalledWith({
      where: { id: "run" },
      select: { id: true, relayChannelId: true, probeMemberChannelId: true, profileId: true },
    });
    expect(withLock).not.toHaveBeenCalled();
    expect(tx.relayChannelProbeProfile.findFirst).not.toHaveBeenCalled();
  });
  it("shadow previews scopes without hydrating pricing, profile, payload or credentials", async () => {
    expect(await apply(false)).toBe(false);
    expect(tx.relayChannelProbeProfile.findFirst).not.toHaveBeenCalled();
    expect(tx.modelPricing.findMany).not.toHaveBeenCalled();
    expect(tx.relayChannel.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.relayChannel.updateMany).not.toHaveBeenCalled();
  });
  it("uses whitelisted profile, target, run and config projections", async () => {
    expect(await apply()).toBe(true);
    expect(tx.relayChannelProbeProfile.findFirst.mock.calls[0]![0].select).toEqual({
      probeModel: true,
      probeFormat: true,
      probeEndpoint: true,
      cacheMode: true,
    });
    expect(tx.relayChannelProbeTargetConfig.findUnique.mock.calls[0]![0].select).toEqual({
      probeModel: true,
      probeFormat: true,
    });
    expect(tx.relayConfig.findFirst.mock.calls[0]![0].select).toEqual({ globalMultiplier: true });
    const selected = tx.relayChannelProbeRun.findUnique.mock.calls[0]![0].select;
    for (const forbidden of [
      "samples",
      "balanceSnapshots",
      "upstreamUsage",
      "pricingSnapshot",
      "costBreakdown",
      "errorMessage",
    ])
      expect(selected).not.toHaveProperty(forbidden);
    expect(tx.relayChannelProbeRun.updateMany.mock.calls[0]![0].data).toMatchObject({
      appliedByUserId: "actor",
      appliedMultiplier: 1.1,
    });
  });
  it("rechecks authorization after writer wait and before hydration", async () => {
    recheck.mockRejectedValue(new Error("revoked"));
    await expect(apply()).rejects.toThrow("revoked");
    expect(tx.relayChannelProbeRun.findUnique).not.toHaveBeenCalled();
    expect(tx.modelPricing.findMany).not.toHaveBeenCalled();
  });
  it("rejects changed run identity before profile or pricing reads", async () => {
    tx.relayChannelProbeRun.findUnique.mockResolvedValue({ ...identity, relayChannelId: "foreign" });
    await expect(apply()).rejects.toMatchObject({ statusCode: 403 });
    expect(tx.relayChannelProbeProfile.findFirst).not.toHaveBeenCalled();
  });
  it("does not mark a run if the conditional channel write lost its race", async () => {
    tx.relayChannel.updateMany.mockResolvedValue({ count: 0 });
    await expect(apply()).rejects.toMatchObject({ statusCode: 403 });
    expect(tx.relayChannelProbeRun.updateMany).not.toHaveBeenCalled();
  });
  it("authorizes an independent run before reading its suggested multiplier", async () => {
    tx.relayChannelProbeRun.findFirst.mockResolvedValue({ id: "confirmation" });
    authorize.mockImplementation(async (resources) => {
      if (resources.includes(platformRelayProbeRunArn("channel", "confirmation")))
        throw new Error("denied confirmation");
    });
    await expect(apply(true, 1.5)).rejects.toThrow("denied confirmation");
    expect(tx.relayChannelProbeRun.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.relayChannelProbeRun.findFirst.mock.calls[0]![0].select).toEqual({ id: true });
    expect(tx.relayChannel.updateMany).not.toHaveBeenCalled();
  });
  it("never bypasses an invalid snapshot with forceLargeChange", async () => {
    tx.relayConfig.findFirst.mockResolvedValue({ globalMultiplier: 2 });
    await expect(apply(true, 1.5, true)).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.relayChannel.updateMany).not.toHaveBeenCalled();
  });
  it("does not silently fall back to default pricing if current configuration is unavailable", async () => {
    tx.relayConfig.findFirst.mockResolvedValue(null);
    await expect(apply()).rejects.toMatchObject({ statusCode: 403 });
    expect(tx.relayChannel.updateMany).not.toHaveBeenCalled();
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1001])(
    "rejects an invalid target multiplier %s before writes",
    async (value) => {
      await expect(apply(true, value, true)).rejects.toMatchObject({ statusCode: 400 });
      expect(tx.relayChannel.updateMany).not.toHaveBeenCalled();
    },
  );
  it("treats a missing profile relation as a closed authorization failure", async () => {
    lookup.mockResolvedValue({ ...identity, profileId: null });
    await expect(apply()).rejects.toMatchObject({ statusCode: 403 });
    expect(tx.relayChannelProbeRun.findUnique).not.toHaveBeenCalled();
  });
});
describe("shared probe pricing snapshot", () => {
  it("preserves the worker snapshot shape, field order and hash with no credentials", () => {
    const rate = projectRelayModelRates([pricing as never])[0]!;
    const snapshot = buildProbePricingSnapshot(profile, billing, null, rate, 1);
    expect(Object.keys(snapshot)).toEqual([
      "model",
      "modelMapping",
      "rate",
      "globalMultiplier",
      "timeMultiplier",
      "timePeriodMultipliers",
      "contextLengthMultipliers",
      "inputTokensIncludeCacheRead",
      "cacheMode",
      "endpoint",
    ]);
    expect(snapshot).toEqual({
      model: "fixture-model",
      modelMapping: {},
      rate,
      globalMultiplier: 1,
      timeMultiplier: 1,
      timePeriodMultipliers: [],
      contextLengthMultipliers: [],
      inputTokensIncludeCacheRead: false,
      cacheMode: "cache-bust",
      endpoint: "openai-chat-completions",
    });
    expect(fingerprintProbePricing(snapshot)).toBe(fingerprint());
    expect(fingerprintProbePricing({ ...snapshot, globalMultiplier: 2 })).not.toBe(fingerprint());
  });
});
