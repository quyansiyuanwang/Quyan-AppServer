import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { RelayTokenCapabilitySnapshot } from "@/store/relay/relay-token-capability.repository";
import type { RelayCatalogSnapshot, RelayCatalogSource } from "@/store/relay/relay-channel-catalog-read.repository";
import type { RelayTokenInspectionTarget } from "@/store/relay/relay-token-inspection.repository";
import type { RelayTokenInspectionIamService } from "@/services/relay/relay-token-inspection-iam.service";
import type { RelayCapabilityGraphNode } from "@/services/relay/relay-pool-resolver.service";
import type { RelayTokenModelMappingDraftDto } from "@/api/dto/relay/relay-token-model-mapping.dto";

vi.mock("@/services/relay/relay-token-inspection-iam.service", () => ({
  RelayTokenInspectionIamService: { getInstance: vi.fn() },
}));
vi.mock("@/services/relay/relay-channel-catalog-iam.service", () => ({
  RelayChannelCatalogIamService: { getInstance: vi.fn() },
}));
vi.mock("@/store/relay/relay-token-capability.repository", () => ({
  RelayTokenCapabilityRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/relay/relay-pool-resolver.service", () => ({ RelayPoolResolverService: { getInstance: vi.fn() } }));
vi.mock("@/store/relay/relay-channel.repository", () => ({
  RelayChannelRepository: { getInstance: () => ({}) },
}));
vi.mock("@/store/users/iam-account-principal", () => ({ iamAccountDenied: () => new Error("scope denied") }));
vi.mock("@/services/relay/relay-request-format-transform.service", () => ({
  resolveRelayRequestFormatTransform: (rules: unknown, source: string) =>
    Array.isArray(rules) ? rules.find((rule) => rule.sourceFormat === source) : undefined,
}));
import {
  RelayTokenModelMappingService,
  validateRelayTokenModelMappingScopes,
} from "@/services/relay/relay-token-model-mapping.service";

const now = new Date(0);
function token(id: string, overrides: Partial<RelayTokenCapabilitySnapshot> = {}): RelayTokenCapabilitySnapshot {
  return {
    id,
    userId: "actor",
    status: 1,
    createTime: now,
    updateTime: now,
    expiresAt: null,
    routingMode: "ordered",
    channelId: "logical",
    channelConfigs: [],
    automaticProxyPoolChannelId: null,
    blockedAutomaticProxyPoolChannelIds: null,
    allowedModels: null,
    modelMapping: null,
    modelMappingRules: null,
    requestFormatTransforms: null,
    memberTokenConfigs: [],
    failoverConfig: null,
    ...overrides,
  };
}
const edge = (tokenId: string, priority = 0, enabled = true) => ({
  id: "edge_" + tokenId,
  status: 1,
  updateTime: now,
  tokenId,
  priority,
  enabled,
});
const node = (id: string, channelType = "standalone"): RelayCapabilityGraphNode => ({
  id,
  name: id === "physical" ? "PRIVATE PHYSICAL NAME" : id,
  channelType,
  status: 1,
  providerServiceEnabled: true,
  allowedFormats: "openai-chat-completions",
  allowedModels: null,
  modelMapping: null,
  routingConfig: null,
  poolMembers: [],
});

describe("model mapping draft service authorization and projections", () => {
  let rows: RelayTokenCapabilitySnapshot[], admitted: string[], snapshot: RelayCatalogSnapshot;
  const inspection = { modelMapping: vi.fn<RelayTokenInspectionIamService["modelMapping"]>() };
  const channels = { withRoutingSnapshot: vi.fn() };
  const repository = { tokens: vi.fn(), catalog: vi.fn() };
  const pools = { resolveCapabilityLeafCandidates: vi.fn() };
  const service = new RelayTokenModelMappingService(
    {
      modelMapping: ((...args: Parameters<RelayTokenInspectionIamService["modelMapping"]>) =>
        inspection.modelMapping(...args)) as RelayTokenInspectionIamService["modelMapping"],
    },
    channels,
    repository,
    pools,
  );
  const draft: RelayTokenModelMappingDraftDto = { channelId: "logical" };
  const preview = (input: RelayTokenModelMappingDraftDto = draft) =>
    service.preview("actor", { draft: input, requestModel: "alias", requestFormat: "openai-chat-completions" });
  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    admitted = [];
    const graph = new Map(
      [node("logical", "pooled"), node("physical", "pooled-member"), node("unrelated")].map((row) => [row.id, row]),
    );
    snapshot = {
      sources: [...graph.values()] as unknown as RelayCatalogSource[],
      context: {
        graph,
        modelCatalog: [{ model: "target", provider: "", supportedFormats: "openai-chat-completions" }],
      },
      poolVisibility: "hidden",
    };
    inspection.modelMapping.mockImplementation(async (_kind, _actor, ids, _target, _request, read) => {
      const admit = async (values: readonly string[]) => {
        admitted.push(...values);
        if (values.some((id) => !rows.some((row) => row.id === id))) throw new Error("token denied");
        return values.map((id) => ({
          ...rows.find((row) => row.id === id),
          name: id,
        })) as unknown as RelayTokenInspectionTarget[];
      };
      return read(await admit(ids), "actor", admit);
    });
    channels.withRoutingSnapshot.mockImplementation(async (_actor, _target, _request, read) => read(snapshot));
    repository.tokens.mockImplementation(async (_userId, targets: { id: string }[]) =>
      targets
        .map((target) => {
          const row = rows.find((row) => row.id === target.id)!;
          return {
            ...structuredClone({ ...row, failoverConfig: null }),
            failoverConfig: row.failoverConfig ? { ...row.failoverConfig } : null,
          };
        })
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
    repository.catalog.mockResolvedValue([
      { id: "pricing", model: "target", provider: "", supportedFormats: "openai-chat-completions" },
    ]);
    pools.resolveCapabilityLeafCandidates.mockImplementation(
      async (roots: string[], graph: ReadonlyMap<string, RelayCapabilityGraphNode>) =>
        roots.map((root) => ({ resolvedChannel: graph.get("physical")!, routingChannelIds: [root, "physical"] })),
    );
  });
  it("returns only reachable logical IDs; selected IDs cannot inject unrelated or physical channels", async () => {
    expect(await service.channelOptions("actor", { draft })).toEqual({
      items: [{ id: "logical", name: "logical" }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    for (const id of ["physical", "unrelated", "hidden"])
      await expect(service.channelOptions("actor", { draft, selectedIds: [id] })).rejects.toThrow("scope denied");
  });
  it("scopes catalog reads to draft roots and only loads models for preview", async () => {
    await service.channelOptions("actor", { draft });
    expect(channels.withRoutingSnapshot.mock.calls.at(-1)?.[4]).toEqual({
      rootIds: ["logical"],
      includeModelCatalog: false,
    });
    await preview();
    expect(channels.withRoutingSnapshot.mock.calls.at(-1)?.[4]).toEqual({
      rootIds: ["logical"],
      includeModelCatalog: true,
    });
  });
  it("paginates matching logical candidates while retaining selected matches", async () => {
    const input = {
      channelConfigs: [
        { channelId: "logical", priority: 0 },
        { channelId: "unrelated", priority: 1 },
      ],
    };
    const result = await service.channelOptions("actor", {
      draft: input,
      search: "logical",
      selectedIds: ["unrelated"],
      page: 2,
      pageSize: 1,
    });
    expect(result).toEqual({ items: [{ id: "unrelated", name: "unrelated" }], total: 2, page: 2, pageSize: 1 });
    expect(
      (
        await service.preview("actor", {
          draft: input,
          requestModel: "alias",
          requestFormat: "openai-chat-completions",
          page: 2,
          pageSize: 1,
        })
      ).items,
    ).toHaveLength(1);
  });
  it("never applies scoped mappings from a sibling route", async () => {
    const result = await preview({
      channelConfigs: [
        { channelId: "logical", priority: 0 },
        { channelId: "unrelated", priority: 1 },
      ],
      modelMappingRules: [{ source: "alias", target: "target", channelIds: ["logical"], preference: "mapping-first" }],
    });
    expect(result.items.map(({ channelId, outcome }) => ({ channelId, outcome }))).toEqual([
      { channelId: "logical", outcome: "mapped" },
      { channelId: "unrelated", outcome: "unavailable" },
    ]);
  });
  it("uses the shared resolver and masks physical channel labels, IDs and duplicate physical paths", async () => {
    pools.resolveCapabilityLeafCandidates.mockImplementation(async (_roots, graph) =>
      Array.from({ length: 2 }, () => ({
        resolvedChannel: graph.get("physical"),
        routingChannelIds: ["logical", "physical"],
      })),
    );
    const result = await preview({
      ...draft,
      modelMappingRules: [{ source: "alias", target: "target", preference: "mapping-first", channelIds: ["logical"] }],
    });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      channelId: "logical",
      channelName: "logical",
      tokenPathIds: ["__model_mapping_preview__"],
      effectiveModel: "target",
      outcome: "mapped",
      ruleSource: "__model_mapping_preview__",
    });
    expect(JSON.stringify(result)).not.toMatch(/physical|PRIVATE|poolMembers|upstream|credential/);
  });
  it("keeps public totals and pagination stable when one physical member becomes eight distinct members", async () => {
    const input: RelayTokenModelMappingDraftDto = {
      ...draft,
      modelMappingRules: [{ source: "alias", target: "target", preference: "mapping-first", channelIds: ["logical"] }],
    };
    const before = await preview(input);
    const optionsBefore = await service.channelOptions("actor", { draft: input, pageSize: 1 });
    pools.resolveCapabilityLeafCandidates.mockImplementation(async () =>
      Array.from({ length: 8 }, (_, index) => ({
        resolvedChannel: {
          ...node("private_leaf_" + index, "pooled-member"),
          name: "private upstream name " + index,
          openaiUpstreamUrl: "https://fixture.invalid/private-upstream",
          openaiUpstreamApiKey: "fixture-only-secret",
          pooledParentId: "logical",
        },
        routingChannelIds: ["logical", "private_leaf_" + index],
      })),
    );
    expect(await preview(input)).toEqual(before);
    expect(await service.channelOptions("actor", { draft: input, pageSize: 1 })).toEqual(optionsBefore);
    expect(
      (
        await service.preview("actor", {
          draft: input,
          requestModel: "alias",
          requestFormat: "openai-chat-completions",
          page: 2,
          pageSize: 1,
        })
      ).items,
    ).toEqual([]);
    expect(JSON.stringify(await preview(input))).not.toMatch(
      /private|fixture-only-secret|pooledParent|upstream|routingChannelIds/,
    );
  });
  it("deduplicates logical options across member tokens while preserving distinct token paths in preview", async () => {
    rows = [
      token("first", { modelMapping: { alias: "target" } }),
      token("second", { modelMapping: { alias: "target" } }),
    ];
    const input: RelayTokenModelMappingDraftDto = {
      routingMode: "composite",
      memberTokenConfigs: [
        { tokenId: "first", priority: 0, enabled: true },
        { tokenId: "second", priority: 1, enabled: true },
      ],
    };
    expect(await service.channelOptions("actor", { draft: input })).toEqual({
      items: [{ id: "logical", name: "logical" }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    const result = await preview(input);
    expect(result.total).toBe(2);
    expect(result.items.map((row) => row.tokenPathIds)).toEqual([
      ["__model_mapping_preview__", "first"],
      ["__model_mapping_preview__", "second"],
    ]);
    expect(result.items.every((row) => row.channelId === "logical" && row.effectiveModel === "target")).toBe(true);
  });
  it("retains automatic and nested logical scope candidates while projecting the nearest logical channel", async () => {
    const automatic = node("auto", "automatic-proxy-pool");
    snapshot.sources = [...snapshot.sources, automatic as unknown as RelayCatalogSource];
    snapshot.context.graph = new Map([...snapshot.context.graph, [automatic.id, automatic]]);
    pools.resolveCapabilityLeafCandidates.mockImplementation(async (_roots, graph) => [
      { resolvedChannel: graph.get("physical"), routingChannelIds: ["auto", "logical", "physical"] },
    ]);
    const input: RelayTokenModelMappingDraftDto = {
      routingMode: "automatic-pool",
      automaticProxyPoolChannelId: "auto",
      modelMappingRules: [{ source: "alias", target: "target", preference: "mapping-first", channelIds: ["auto"] }],
    };
    expect((await service.channelOptions("actor", { draft: input })).items).toEqual([
      { id: "auto", name: "auto" },
      { id: "logical", name: "logical" },
    ]);
    const result = await preview(input);
    expect(result.items[0]).toMatchObject({ channelId: "logical", outcome: "mapped", effectiveModel: "target" });
    expect(JSON.stringify(result)).not.toMatch(/physical|routingChannelIds|poolMembers/);
    await expect(service.channelOptions("actor", { draft: input, selectedIds: ["physical"] })).rejects.toThrow(
      "scope denied",
    );
  });
  it.each([true, false])(
    "returns one executable public row when physical outcomes differ (failure first: %s)",
    async (failureFirst) => {
      pools.resolveCapabilityLeafCandidates.mockImplementation(async () =>
        Array.from({ length: 2 }, (_, index) => ({
          resolvedChannel: {
            ...node("private_leaf_" + index, "pooled-member"),
            allowedFormats: (index === 0) === failureFirst ? "anthropic" : "openai-chat-completions",
          },
          routingChannelIds: ["logical", "private_leaf_" + index],
        })),
      );
      const result = await preview({ ...draft, modelMapping: { alias: "target" } });
      expect(result.total).toBe(1);
      expect(result.items).toEqual([
        {
          channelId: "logical",
          channelName: "logical",
          tokenPathIds: ["__model_mapping_preview__"],
          requestedModel: "alias",
          effectiveModel: "target",
          ruleSource: "__model_mapping_preview__",
          outcome: "mapped",
          reason: "mapped",
        },
      ]);
      const page = await service.preview("actor", {
        draft: { ...draft, modelMapping: { alias: "target" } },
        requestModel: "alias",
        requestFormat: "openai-chat-completions",
        page: 2,
        pageSize: 1,
      });
      expect(page).toMatchObject({ items: [], total: 1 });
      expect(JSON.stringify(result)).not.toMatch(/private_leaf|allowedModels|routingChannelIds|memberCount/);
    },
  );
  it("chooses the first executable path when viable members resolve different effective models", async () => {
    snapshot.context.modelCatalog = [
      ...snapshot.context.modelCatalog,
      { model: "alternative", provider: "", supportedFormats: "openai-chat-completions" },
    ];
    pools.resolveCapabilityLeafCandidates.mockImplementation(async () =>
      ["alternative", "target"].map((target, index) => ({
        resolvedChannel: {
          ...node("private_leaf_" + index, "pooled-member"),
          modelMapping: { alias: target },
        },
        routingChannelIds: ["logical", "private_leaf_" + index],
      })),
    );
    const result = await preview();
    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      {
        channelId: "logical",
        channelName: "logical",
        tokenPathIds: ["__model_mapping_preview__"],
        requestedModel: "alias",
        effectiveModel: "alternative",
        outcome: "mapped",
        reason: "mapped",
      },
    ]);
    expect(await preview()).toEqual(result);
    expect(JSON.stringify(result)).not.toMatch(/private_leaf|routingChannelIds|memberCount/);
  });
  it("returns the first failure as one public row when every physical path is unavailable", async () => {
    pools.resolveCapabilityLeafCandidates.mockImplementation(async () =>
      ["anthropic", "openai-chat-completions"].map((allowedFormats, index) => ({
        resolvedChannel: { ...node("private_leaf_" + index, "pooled-member"), allowedFormats },
        routingChannelIds: ["logical", "private_leaf_" + index],
      })),
    );
    const result = await preview();
    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      {
        channelId: "logical",
        channelName: "logical",
        tokenPathIds: ["__model_mapping_preview__"],
        requestedModel: "alias",
        outcome: "unavailable",
        reason: "format-unsupported",
      },
    ]);
  });
  it("keeps preview and save scope checks on the same admitted physical graph without rebuilding filtered sources", async () => {
    const { RelayPoolResolverService } = await vi.importActual<
      typeof import("@/services/relay/relay-pool-resolver.service")
    >("@/services/relay/relay-pool-resolver.service");
    const admittedService = new RelayTokenModelMappingService(
      {
        modelMapping: ((...args: Parameters<RelayTokenInspectionIamService["modelMapping"]>) =>
          inspection.modelMapping(...args)) as RelayTokenInspectionIamService["modelMapping"],
      },
      channels,
      repository,
      RelayPoolResolverService.getInstance(),
    );
    const logical = {
      ...snapshot.context.graph.get("logical")!,
      poolMembers: [{ memberChannelId: "physical", priority: 0, weight: 1, enabled: true }],
    };
    snapshot.context.graph = new Map([...snapshot.context.graph, [logical.id, logical]]);
    const input: RelayTokenModelMappingDraftDto = {
      ...draft,
      modelMappingRules: [{ source: "alias", target: "target", preference: "mapping-first", channelIds: ["logical"] }],
    };
    expect(
      await admittedService.preview("actor", {
        draft: input,
        requestModel: "alias",
        requestFormat: "openai-chat-completions",
      }),
    ).toMatchObject({ items: [{ channelId: "logical", outcome: "mapped" }], total: 1 });
    await admittedService.validateDraftScope(input, { userId: "actor", tokens: [], channels: snapshot });
    await expect(
      admittedService.validateDraftScope(
        { ...input, modelMappingRules: [{ ...input.modelMappingRules![0], channelIds: ["physical"] }] },
        { userId: "actor", tokens: [], channels: snapshot },
      ),
    ).rejects.toThrow("scope denied");
    // Catalog IAM/visibility has removed this source. Root edges confer no additional authority.
    snapshot.sources = snapshot.sources.filter((row) => row.id !== "physical");
    snapshot.context.graph = new Map([...snapshot.context.graph].filter(([id]) => id !== "physical"));
    expect(await admittedService.channelOptions("actor", { draft })).toMatchObject({ items: [], total: 0 });
    await expect(
      admittedService.preview("actor", {
        draft: input,
        requestModel: "alias",
        requestFormat: "openai-chat-completions",
      }),
    ).rejects.toThrow("scope denied");
    inspection.modelMapping.mockClear();
    channels.withRoutingSnapshot.mockClear();
    await expect(
      admittedService.validateDraftScope(input, { userId: "actor", tokens: [], channels: snapshot }),
    ).rejects.toThrow("scope denied");
    expect(inspection.modelMapping).not.toHaveBeenCalled();
    expect(channels.withRoutingSnapshot).not.toHaveBeenCalled();
  });
  it("does not return a completed preview when the catalog boundary rejects its final proof", async () => {
    channels.withRoutingSnapshot.mockImplementation(async (_actor, _target, _request, read) => {
      await read(snapshot);
      throw new Error("catalog proof revoked");
    });
    await expect(preview()).rejects.toThrow("catalog proof revoked");
  });
  it("rejects unauthorized mapping scopes before running the resolver, including invalid duplicate rules", async () => {
    const rule = { source: "alias", target: "target", preference: "mapping-first" as const, channelIds: ["physical"] };
    await expect(preview({ ...draft, modelMappingRules: [rule, rule] })).rejects.toThrow("scope denied");
  });
  it("authorizes descendants before hydration and passes the entire token chain without changing members", async () => {
    rows = [
      token("inner", { modelMappingRules: [{ source: "middle", target: "target", preference: "mapping-first" }] }),
      token("member", { routingMode: "composite", channelId: null, memberTokenConfigs: [edge("inner")] }),
    ];
    const before = structuredClone(rows);
    const result = await preview({
      routingMode: "composite",
      memberTokenConfigs: [{ tokenId: "member", priority: 0, enabled: true }],
      modelMappingRules: [{ source: "alias", target: "middle", preference: "mapping-first" }],
    });
    expect(admitted).toEqual(["member", "inner"]);
    expect(result.items[0].tokenPathIds).toEqual(["__model_mapping_preview__", "member", "inner"]);
    expect(result.items[0].effectiveModel).toBe("target");
    expect(rows).toEqual(before);
    rows = rows.filter((row) => row.id !== "inner");
    await expect(
      preview({ routingMode: "composite", memberTokenConfigs: [{ tokenId: "member", priority: 0, enabled: true }] }),
    ).rejects.toThrow("token denied");
  });
  it("rejects changing existing composite members or routing mode", async () => {
    rows = [
      token("parent", { routingMode: "composite", channelId: null, memberTokenConfigs: [edge("member")] }),
      token("member"),
    ];
    await expect(preview({ editingTokenId: "parent", routingMode: "ordered" })).rejects.toThrow(
      "Invalid model mapping draft",
    );
    await expect(
      preview({ editingTokenId: "parent", memberTokenConfigs: [{ tokenId: "member", priority: 1, enabled: true }] }),
    ).rejects.toThrow("Invalid model mapping draft");
    expect((await preview({ editingTokenId: "parent" })).items[0].tokenPathIds).toEqual(["parent", "member"]);
  });
  it("drops blocked automatic paths and respects disabled and expired members", async () => {
    const automatic = node("auto", "automatic-proxy-pool");
    snapshot.sources = [...snapshot.sources, automatic as unknown as RelayCatalogSource];
    snapshot.context.graph = new Map([...snapshot.context.graph, [automatic.id, automatic]]);
    pools.resolveCapabilityLeafCandidates.mockImplementation(async (_roots, graph) => [
      { resolvedChannel: graph.get("physical"), routingChannelIds: ["auto", "logical", "physical"] },
    ]);
    expect(
      (
        await service.channelOptions("actor", {
          draft: {
            routingMode: "automatic-pool",
            automaticProxyPoolChannelId: "auto",
            blockedAutomaticProxyPoolChannelIds: ["logical"],
          },
        })
      ).total,
    ).toBe(0);
    rows = [token("member", { expiresAt: new Date(1) })];
    expect(
      (
        await preview({
          routingMode: "composite",
          memberTokenConfigs: [{ tokenId: "member", priority: 0, enabled: true }],
        })
      ).total,
    ).toBe(0);
  });
  it("returns overlap diagnostics and rejects duplicate-source rules on save without extra preview IAM", async () => {
    const rules = [
      { source: "a*", target: "target", preference: "mapping-first" as const },
      { source: "alias", target: "target", preference: "mapping-first" as const },
    ];
    expect((await preview({ ...draft, modelMappingRules: rules })).diagnostics).toContainEqual({
      ruleIndex: 1,
      otherRuleIndex: 0,
      severity: "warning",
      code: "overlapping-patterns",
    });
    inspection.modelMapping.mockClear();
    channels.withRoutingSnapshot.mockClear();
    await service.validateDraftScope(
      { ...draft, modelMappingRules: rules },
      { userId: "actor", tokens: [], channels: snapshot },
    );
    expect(inspection.modelMapping).not.toHaveBeenCalled();
    expect(channels.withRoutingSnapshot).not.toHaveBeenCalled();
    expect(() => validateRelayTokenModelMappingScopes([rules[0], rules[0]], new Set(["logical"]))).toThrow(
      "Invalid model mapping draft",
    );
    expect(() =>
      validateRelayTokenModelMappingScopes([{ ...rules[0], channelIds: ["unrelated"] }], new Set(["logical"])),
    ).toThrow("scope denied");
  });
  it("validates scoped saves against admitted visible logical IDs without requesting preview or catalog permissions", async () => {
    const input: RelayTokenModelMappingDraftDto = {
      ...draft,
      modelMappingRules: [{ source: "alias", target: "target", preference: "mapping-first", channelIds: ["logical"] }],
    };
    await service.validateDraftScope(input, { userId: "actor", tokens: [], channels: snapshot });
    expect(inspection.modelMapping).not.toHaveBeenCalled();
    expect(channels.withRoutingSnapshot).not.toHaveBeenCalled();
    snapshot.sources = snapshot.sources.filter((row) => row.id !== "logical");
    await expect(
      service.validateDraftScope(input, { userId: "actor", tokens: [], channels: snapshot }),
    ).rejects.toThrow("scope denied");
    expect(inspection.modelMapping).not.toHaveBeenCalled();
    expect(channels.withRoutingSnapshot).not.toHaveBeenCalled();
  });
  it("rejects physical scopes on save even when their nodes occur on the admitted route", async () => {
    const input: RelayTokenModelMappingDraftDto = {
      ...draft,
      modelMappingRules: [{ source: "alias", target: "target", preference: "mapping-first", channelIds: ["physical"] }],
    };
    await expect(
      service.validateDraftScope(input, { userId: "actor", tokens: [], channels: snapshot }),
    ).rejects.toThrow("scope denied");
    expect(inspection.modelMapping).not.toHaveBeenCalled();
    expect(channels.withRoutingSnapshot).not.toHaveBeenCalled();
  });
  it("fails closed on snapshot drift before releasing a projection", async () => {
    rows = [token("edited")];
    repository.tokens
      .mockImplementationOnce(async () => structuredClone(rows))
      .mockImplementationOnce(async () => [
        {
          ...rows[0],
          modelMappingRules: [
            { source: "alias", target: "changed", preference: "mapping-first" },
          ] as unknown as Prisma.JsonValue,
        },
      ]);
    await expect(preview({ editingTokenId: "edited" })).rejects.toThrow("scope denied");
  });
  it("rejects unknown nested member policy fields and invalid pagination before reading", async () => {
    await expect(
      service.preview("actor", {
        draft: {
          routingMode: "composite",
          memberTokenConfigs: [{ tokenId: "member", priority: 0, enabled: true, modelMapping: {} }],
        } as unknown as RelayTokenModelMappingDraftDto,
        requestModel: "alias",
        requestFormat: "openai-chat-completions",
        pageSize: 0,
      }),
    ).rejects.toThrow();
    expect(inspection.modelMapping).not.toHaveBeenCalled();
  });
  it("bounds input shapes and rejects simultaneous legacy and new mappings", async () => {
    for (const invalid of [
      { ...draft, allowedModels: "x".repeat(2001) },
      {
        ...draft,
        modelMapping: Object.fromEntries(Array.from({ length: 101 }, (_, index) => ["model" + index, "target"])),
      },
      {
        ...draft,
        modelMappingRules: [{ source: "x".repeat(201), target: "target", preference: "mapping-first" as const }],
      },
      { ...draft, modelMapping: {}, modelMappingRules: [] },
    ])
      await expect(preview(invalid)).rejects.toThrow("Invalid model mapping draft");
    expect(inspection.modelMapping).not.toHaveBeenCalled();
  });
  it("explicit clearing removes inherited legacy aliases", async () => {
    rows = [token("edited", { modelMapping: { alias: "target" } })];
    expect((await preview({ editingTokenId: "edited", modelMappingRules: null })).items[0].outcome).toBe("unavailable");
    expect((await preview({ editingTokenId: "edited" })).items[0].effectiveModel).toBe("target");
  });
  it("applies a new draft multiplier limit through the execution resolver", async () => {
    pools.resolveCapabilityLeafCandidates.mockImplementation(async (_roots, graph) => [
      { resolvedChannel: { ...graph.get("physical"), multiplier: 2 }, routingChannelIds: ["logical", "physical"] },
    ]);
    const input = { ...draft, modelMapping: { alias: "target" } };
    expect((await preview(input)).items[0]).toMatchObject({ outcome: "mapped", reason: "mapped" });
    expect((await preview({ ...input, failoverConfig: { maxAcceptedChannelMultiplier: 1.5 } })).items[0]).toMatchObject(
      { outcome: "unavailable", reason: "multiplier-exceeded" },
    );
    expect((await preview({ ...input, failoverConfig: { maxAcceptedChannelMultiplier: 2 } })).items[0]).toMatchObject({
      outcome: "mapped",
      reason: "mapped",
    });
  });
  it("preserves saved multiplier policy on omission and clears it with explicit null", async () => {
    rows = [
      token("edited", {
        modelMapping: { alias: "target" },
        failoverConfig: { maxAcceptedChannelMultiplier: new Prisma.Decimal(1), updateTime: now },
      }),
    ];
    const before = JSON.stringify(rows);
    pools.resolveCapabilityLeafCandidates.mockImplementation(async (_roots, graph) => [
      { resolvedChannel: { ...graph.get("physical"), multiplier: 2 }, routingChannelIds: ["logical", "physical"] },
    ]);
    expect((await preview({ editingTokenId: "edited" })).items[0]).toMatchObject({
      outcome: "unavailable",
      reason: "multiplier-exceeded",
    });
    for (const failoverConfig of [null, { maxAcceptedChannelMultiplier: null }, { maxAcceptedChannelMultiplier: 3 }])
      expect((await preview({ editingTokenId: "edited", failoverConfig })).items[0]).toMatchObject({
        outcome: "mapped",
        reason: "mapped",
      });
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("keeps member multiplier limits when a composite draft clears its own limit", async () => {
    rows = [
      token("member", {
        modelMapping: { alias: "target" },
        failoverConfig: { maxAcceptedChannelMultiplier: new Prisma.Decimal(1), updateTime: now },
      }),
    ];
    const before = JSON.stringify(rows);
    pools.resolveCapabilityLeafCandidates.mockImplementation(async (_roots, graph) => [
      { resolvedChannel: { ...graph.get("physical"), multiplier: 2 }, routingChannelIds: ["logical", "physical"] },
    ]);
    expect(
      (
        await preview({
          routingMode: "composite",
          memberTokenConfigs: [{ tokenId: "member", priority: 0, enabled: true }],
          failoverConfig: null,
        })
      ).items[0],
    ).toMatchObject({ outcome: "unavailable", reason: "multiplier-exceeded" });
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("accepts the existing multiplier endpoints and six decimal precision", async () => {
    for (const maximum of [0.01, 100, 1.234567]) {
      const input = { ...draft, failoverConfig: { maxAcceptedChannelMultiplier: maximum } };
      await expect(preview(input)).resolves.toMatchObject({ total: 1 });
      await expect(service.channelOptions("actor", { draft: input })).resolves.toMatchObject({ total: 1 });
    }
  });
  it("rejects invalid multiplier bounds and unrelated failover fields before admission", async () => {
    for (const failoverConfig of [
      ...[0, 0.009999, -1, 100.000001, 1.2345678, Infinity, NaN].map((maximum) => ({
        maxAcceptedChannelMultiplier: maximum,
      })),
      { maxAcceptedChannelMultiplier: 1, enabled: true },
      { maxRetries: 1 },
    ]) {
      const input = { ...draft, failoverConfig } as RelayTokenModelMappingDraftDto;
      await expect(preview(input)).rejects.toThrow("Invalid model mapping draft");
      await expect(service.channelOptions("actor", { draft: input })).rejects.toThrow("Invalid model mapping draft");
    }
    expect(inspection.modelMapping).not.toHaveBeenCalled();
    expect(channels.withRoutingSnapshot).not.toHaveBeenCalled();
  });
});
