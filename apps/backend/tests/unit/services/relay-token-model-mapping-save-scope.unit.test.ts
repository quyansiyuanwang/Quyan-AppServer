import { describe, expect, it, vi } from "vitest";
import { validateRelayTokenSavedModelMappingScope } from "@/services/relay/relay-token-update-preparation";
import type { RelayTokenRoutingSource } from "@/store/relay/relay-token-update-admission.repository";
import type { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), paths: vi.fn(), scopes: vi.fn() }));
vi.mock("@/store/relay/relay-token-update-admission.repository", () => ({
  RelayTokenUpdateAdmissionRepository: { getInstance: () => ({ mappingScopeSnapshot: mocks.snapshot }) },
}));
vi.mock("@/services/relay/relay-pool-resolver.service", () => ({
  RelayPoolResolverService: { getInstance: () => ({ resolveCapabilityLeafCandidates: mocks.paths }) },
}));
vi.mock("@/services/relay/relay-token-model-mapping.service", () => ({
  validateRelayTokenModelMappingScopes: mocks.scopes,
}));

function token(overrides: Record<string, unknown> = {}) {
  return {
    id: "root-token",
    userId: "user",
    status: 1,
    expiresAt: null,
    routingMode: "ordered",
    channelId: "logical",
    channelConfigs: [],
    memberTokenConfigs: [],
    automaticProxyPoolChannelId: null,
    blockedAutomaticProxyPoolChannelIds: null,
    modelMappingRules: [{ source: "*", target: "mapped", preference: "mapping-first", channelIds: ["logical"] }],
    ...overrides,
  };
}

describe("saved token mapping scope validation", () => {
  it("uses injected dependencies and passes the transaction and channel admission through", async () => {
    const root = token();
    const snapshot = vi.fn().mockResolvedValue({
      root,
      tokens: [root],
      channels: { sources: [], graph: new Map([["logical", { channelType: "standalone" }]]) },
    });
    const paths = vi.fn().mockResolvedValue([{ routingChannelIds: ["logical"] }]);
    const tx = {} as Prisma.TransactionClient;
    const admit = vi.fn();
    const source = root as unknown as RelayTokenRoutingSource;
    await validateRelayTokenSavedModelMappingScope(source, {}, tx, admit, {
      repository: { mappingScopeSnapshot: snapshot },
      pools: { resolveCapabilityLeafCandidates: paths },
    });
    expect(snapshot).toHaveBeenCalledExactlyOnceWith(source, {}, tx, admit);
    expect(paths).toHaveBeenCalledOnce();
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.paths).not.toHaveBeenCalled();
    expect(mocks.scopes).toHaveBeenCalledExactlyOnceWith(root.modelMappingRules, new Set(["logical"]));
  });
  it("uses the transaction snapshot and excludes physical member IDs", async () => {
    const root = token();
    const channels = {
      sources: [{ id: "logical" }],
      graph: new Map([
        ["logical", { channelType: "pooled" }],
        ["physical", { channelType: "pooled-member" }],
      ]),
    };
    mocks.snapshot.mockResolvedValue({ root, tokens: [root], channels });
    mocks.paths.mockResolvedValue([{ routingChannelIds: ["logical", "physical"] }]);
    const source = root as unknown as RelayTokenRoutingSource;
    const proof = await validateRelayTokenSavedModelMappingScope(source, {});
    expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(source, {}, undefined, undefined);
    expect(mocks.scopes).toHaveBeenCalledExactlyOnceWith(root.modelMappingRules, new Set(["logical"]));
    expect(proof).toBe(JSON.stringify({ members: [], channels: channels.sources }));
  });

  it("does not acquire snapshots for global rules, omitted rules or explicit clear", async () => {
    const source = token() as unknown as RelayTokenRoutingSource;
    await validateRelayTokenSavedModelMappingScope(source, { modelMappingRules: null });
    await validateRelayTokenSavedModelMappingScope(source, { modelMappingRules: [] });
    await validateRelayTokenSavedModelMappingScope(source, {
      modelMappingRules: [{ source: "*", target: "mapped", preference: "mapping-first" }],
    });
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.scopes).not.toHaveBeenCalled();
  });

  it("walks enabled unchanged members and excludes blocked routes", async () => {
    const root = token({
      routingMode: "composite",
      channelId: null,
      memberTokenConfigs: [
        { tokenId: "enabled", priority: 0, enabled: true },
        { tokenId: "disabled", priority: 1, enabled: false },
      ],
    });
    const member = token({ id: "enabled", blockedAutomaticProxyPoolChannelIds: ["blocked"] });
    const disabled = token({ id: "disabled", channelId: "unselected" });
    const tokens = structuredClone([root, member, disabled]);
    mocks.snapshot.mockResolvedValue({
      root,
      tokens: [root, member, disabled],
      channels: {
        sources: [],
        graph: new Map([
          ["logical", { channelType: "pooled" }],
          ["blocked", { channelType: "standalone" }],
          ["allowed", { channelType: "standalone" }],
        ]),
      },
    });
    mocks.paths.mockResolvedValue([
      { routingChannelIds: ["logical", "blocked"] },
      { routingChannelIds: ["logical", "allowed"] },
    ]);
    await validateRelayTokenSavedModelMappingScope(root as unknown as RelayTokenRoutingSource, {});
    expect(mocks.paths).toHaveBeenCalledTimes(1);
    expect(mocks.scopes).toHaveBeenCalledExactlyOnceWith(root.modelMappingRules, new Set(["logical", "allowed"]));
    expect([root, member, disabled]).toEqual(tokens);
  });

  it("propagates scope rejection before persistence", async () => {
    const root = token();
    mocks.snapshot.mockResolvedValue({ root, tokens: [root], channels: { sources: [], graph: new Map() } });
    mocks.paths.mockResolvedValue([]);
    mocks.scopes.mockImplementation(() => {
      throw new Error("scope unavailable");
    });
    await expect(
      validateRelayTokenSavedModelMappingScope(root as unknown as RelayTokenRoutingSource, {}),
    ).rejects.toThrow("scope unavailable");
  });
});
