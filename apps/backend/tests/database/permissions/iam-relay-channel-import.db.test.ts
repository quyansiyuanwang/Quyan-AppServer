import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS, type IamCondition } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";

import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import BusinessLogService from "@/services/system/businesslog.service";
import type { CreateRelayChannelRequest, ImportRelayChannelsRequest } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
import { RelayConfigService } from "@/services/relay/relay-config.service";
const mode = env.security.iamAuthorizationMode,
  action = "quyan:relay:ImportChannels",
  referenceAction = "quyan:relay:UseChannelCreationReference";
let owner: string,
  actor: string,
  submitter: string,
  peer: string,
  groupId: string,
  channel: string,
  other: string,
  prefix: string,
  createdConfig: string | undefined,
  originalTopology: { id: string; channelTopologyMode: string }[];
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const body = (): CreateRelayChannelRequest => ({
  name: prefix + "new",
  visibilityMode: "hidden",
  openaiUpstreamUrl: "https://fixture.invalid/new",
  openaiUpstreamApiKey: "fixture-only-new-key",
  allowedFormats: "openai-chat-completions",
  allowedModels: JSON.stringify([prefix + "model"]),
});
const apply = (input: ImportRelayChannelsRequest = { channels: [body()] }, req = request()) =>
  RelayChannelService.getInstance().importChannels(input, actor, req);
const source = () => prisma.relayChannel.findUniqueOrThrow({ where: { id: channel } });
const channels = () =>
  prisma.relayChannel.findMany({ where: { name: { startsWith: prefix } }, orderBy: { id: "asc" } });
const providers = () =>
  prisma.relayChannelProvider.findMany({ where: { relayChannelId: channel }, orderBy: { userId: "asc" } });
async function grant(
  Resource: string | string[],
  Effect: "Allow" | "Deny" = "Deny",
  principalType = "user",
  principalId = actor,
  Condition?: IamCondition,
  policyAction = action,
) {
  const parsed = parseIamPolicy({
      Version: "1",
      Statement: { Effect, Action: policyAction, Resource, ...(Condition ? { Condition } : {}) },
    }),
    policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: prefix + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType,
      principalId,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
async function roleRequest() {
  const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: prefix } }),
    session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    }),
    req = request();
  req.authContext!.assumedRoleId = role.id;
  req.authContext!.roleSessionId = session.id;
  return { req, role, session };
}
function transactionHook(hook: (tx: Prisma.TransactionClient) => void) {
  const original = prisma.$transaction.bind(prisma);
  vi.spyOn(prisma, "$transaction").mockImplementation(((
    callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options?: object,
  ) =>
    original(async (tx) => {
      hook(tx);
      return callback(tx);
    }, options)) as typeof prisma.$transaction);
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "channel-import-" + randomUUID();
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: prefix + randomUUID(),
          password: "fixture-only",
          accountOwnerId,
          parentUserId: accountOwnerId,
          userType: accountOwnerId ? "ram_user" : "root",
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  submitter = await user();
  peer = await user();
  groupId = (
    await prisma.group.create({
      data: { username: prefix, name: prefix, accountOwnerId: null, permissions: [Permission.RELAY_CHANNEL_CREATE] },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  channel = (
    await prisma.relayChannel.create({
      data: {
        name: prefix,
        status: RELAY_CHANNEL_STATUS.DISABLED,
        submissionStatus: "approved",
        submittedByUserId: submitter,
        providerServiceEnabled: false,
        visibilityMode: "hidden",
        openaiUpstreamUrl: "https://fixture.invalid",
        openaiUpstreamApiKey: "fixture-secret-review",
        allowedFormats: "openai-chat-completions",
        allowedModels: JSON.stringify([prefix + "model"]),
      },
    })
  ).id;
  other = (
    await prisma.relayChannel.create({
      data: {
        name: prefix + "other",
        visibilityMode: "hidden",
        openaiUpstreamApiKey: "fixture-secret-other",
        openaiUpstreamUrl: "https://fixture.invalid/other",
        allowedFormats: "openai-chat-completions",
        allowedModels: JSON.stringify([prefix + "model"]),
      },
    })
  ).id;
  await prisma.relayChannelProvider.create({
    data: {
      relayChannelId: channel,
      userId: peer,
      commissionPercent: 15,
      settlementMode: "interval",
      settlementIntervalDays: 7,
      nextSettlementAt: new Date("2030-01-01T00:00:00Z"),
    },
  });
  await prisma.modelPricing.create({
    data: {
      model: prefix + "model",
      provider: "openai",
      supportedFormats: "openai-chat-completions",
      inputPrice: 1,
      outputPrice: 2,
    },
  });
  await prisma.modelPricing.create({
    data: {
      model: prefix + "new",
      provider: "new-identity",
      supportedFormats: "openai-chat-completions",
      inputPrice: 1,
      outputPrice: 2,
    },
  });
  originalTopology = await prisma.relayConfig.findMany({
    where: { status: 1 },
    select: { id: true, channelTopologyMode: true },
  });
  createdConfig = undefined;
  if (!(await prisma.relayConfig.count({ where: { status: 1 } })))
    createdConfig = (await prisma.relayConfig.create({ data: {} })).id;
  await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "legacy" } });
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined as never);
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.relayToken.deleteMany({ where: { userId: actor } });
  await prisma.relayChannel.deleteMany({ where: { name: { startsWith: prefix } } });
  await prisma.modelPricing.deleteMany({ where: { model: { startsWith: prefix } } });
  await prisma.ramResourceGroup.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.businessLog.deleteMany({ where: { actorUserId: actor } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, submitter, peer] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
  if (createdConfig) await prisma.relayConfig.delete({ where: { id: createdConfig } });
  for (const row of originalTopology)
    await prisma.relayConfig.update({ where: { id: row.id }, data: { channelTopologyMode: row.channelTopologyMode } });
});

async function unchanged(operation: () => Promise<unknown>, statusCode = 403) {
  const before = await channels(),
    beforeProviders = await providers();
  await expect(operation()).rejects.toMatchObject({ statusCode });
  expect(await channels()).toEqual(before);
  expect(await providers()).toEqual(beforeProviders);
}
describe("native atomic administrator channel import", () => {
  const pool = (id: string, members: string[] = []) => ({
    id,
    name: prefix + id,
    channelType: "pooled" as const,
    visibilityMode: "hidden" as const,
    poolMembers: members.map((memberChannelId) => ({ memberChannelId, priority: 0, weight: 1, enabled: true })),
  });
  const standalone = (id: string, extra: object = {}) => ({ ...body(), id, name: prefix + id, ...extra });
  it("creates all destinations atomically in caller order with safe DTOs and ignored export timestamps", async () => {
    const old = await source(),
      rich = vi.spyOn(RelayChannelRepository.getInstance(), "listVisible"),
      broad = vi.spyOn(RelayConfigService.getInstance(), "getRelayConfig");
    const result = await apply({
      channels: [
        standalone("second", {
          enabled: false,
          createTime: new Date("2001-01-01"),
          updateTime: new Date("2001-01-01"),
        }),
        standalone("first"),
      ],
    });
    expect(result).toMatchObject({ created: 2, total: 2, code: 0 });
    expect(result.data.map((row) => row.name)).toEqual([prefix + "second", prefix + "first"]);
    expect(result.data.map((row) => row.enabled)).toEqual([false, true]);
    for (const item of result.data) {
      const row = await prisma.relayChannel.findUniqueOrThrow({ where: { id: item.id } });
      expect(row).toMatchObject({
        submissionStatus: "approved",
        submittedByUserId: null,
        reviewedByUserId: null,
        providerServiceEnabled: true,
        openaiUpstreamApiKey: "fixture-only-new-key",
      });
      expect(row.createTime.getFullYear()).toBeGreaterThan(2001);
    }
    expect(JSON.stringify(result)).not.toMatch(/fixture-only-new-key|"openaiUpstreamApiKey"/);
    expect(await source()).toEqual(old);
    expect(rich).not.toHaveBeenCalled();
    expect(broad).not.toHaveBeenCalled();
  });
  it("remaps forward legacy pool references without requiring existing-reference authority for new destinations", async () => {
    await grant("acs:platform:*:platform:relay-channel/*", "Deny", "user", actor, undefined, referenceAction);
    await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "legacy" } });
    const result = await apply({ channels: [pool("pool", ["child"]), standalone("child")] });
    const edge = await prisma.relayChannelMember.findFirstOrThrow({ where: { relayChannelId: result.data[0]!.id } });
    expect(edge.memberChannelId).toBe(result.data[1]!.id);
  });
  it("creates strict parents before physical children while returning original input order", async () => {
    await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "strict-two-tier" } });
    const result = await apply({
      channels: [standalone("child", { channelType: "pooled-member", pooledParentId: "parent" }), pool("parent")],
    });
    expect(result.data.map((row) => row.name)).toEqual([prefix + "child", prefix + "parent"]);
    expect((await prisma.relayChannel.findUniqueOrThrow({ where: { id: result.data[0]!.id } })).pooledParentId).toBe(
      result.data[1]!.id,
    );
  });
  it("supports automatic pools and indirect imported dependencies", async () => {
    await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "legacy" } });
    const result = await apply({
      channels: [
        { ...pool("automatic", ["parent"]), channelType: "automatic-proxy-pool" },
        pool("parent", ["child"]),
        standalone("child"),
      ],
    });
    expect(result.data[0]!.allowedModels).toContain(prefix + "model");
  });
  it("requires separate authority for existing references even with a wildcard import grant", async () => {
    const { req, role } = await roleRequest();
    await grant("acs:platform:*:platform:relay-channel/*", "Allow", "role", role.id);
    await unchanged(() => apply({ channels: [pool("pool", [other])] }, req));
    await grant(platformRelayChannelArn(other), "Allow", "role", role.id, undefined, referenceAction);
    const result = await apply({ channels: [pool("pool", [other])] }, req);
    expect(result.created).toBe(1);
  });
  it("resolves exported external member names using credential-free metadata", async () => {
    const item = pool("pool", ["old-installation-id"]);
    const result = await apply({
      channels: [{ ...item, poolMembers: [{ ...item.poolMembers[0]!, memberChannelName: prefix + "other" }] }],
    });
    expect(
      (await prisma.relayChannelMember.findFirstOrThrow({ where: { relayChannelId: result.data[0]!.id } }))
        .memberChannelId,
    ).toBe(other);
  });
  it("does not require authority over unrelated siblings of an existing parent", async () => {
    await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "strict-two-tier" } });
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "pooled" } });
    await prisma.relayChannel.update({
      where: { id: other },
      data: { channelType: "pooled-member", pooledParentId: channel },
    });
    await grant(platformRelayChannelArn(other), "Deny", "user", actor, undefined, referenceAction);
    const result = await apply({
      channels: [standalone("physical", { channelType: "pooled-member", pooledParentId: channel })],
    });
    expect(result.created).toBe(1);
  });
  it("preserves collision naming including MySQL case-insensitive collisions", async () => {
    const result = await apply({
      channels: [standalone("first", { name: prefix.toUpperCase() }), standalone("second", { name: prefix })],
    });
    expect(new Set(result.data.map((row) => row.name.toLowerCase())).size).toBe(2);
    expect(result.data.every((row) => row.name.toLowerCase() !== prefix.toLowerCase())).toBe(true);
  });
  it("keeps provider grants per destination and never creates settlement history", async () => {
    const result = await apply({
      channels: [
        standalone("first", {
          providers: [
            {
              username: (await prisma.user.findUniqueOrThrow({ where: { id: peer } })).username,
              commissionPercent: 12,
              settlementMode: "interval",
              settlementIntervalDays: 7,
            },
          ],
        }),
        standalone("second"),
      ],
    });
    const rows = await prisma.relayChannelProvider.findMany({
      where: { relayChannelId: { in: result.data.map((row) => row.id) } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ relayChannelId: result.data[0]!.id, userId: peer, lastSettledAt: null });
  });
  it("requires provider relation permission independently of channel creation", async () => {
    await grant("acs:platform:*:platform:relay-channel-provider/*", "Deny");
    await unchanged(async () =>
      apply({
        channels: [
          standalone("first", {
            providers: [
              {
                username: (await prisma.user.findUniqueOrThrow({ where: { id: peer } })).username,
                commissionPercent: 12,
                settlementMode: "interval",
                settlementIntervalDays: 7,
              },
            ],
          }),
        ],
      }),
    );
  });
  it.each([
    "mixed",
    "duplicate",
    "unknown-field",
    "invalid-final",
    "self",
    "cycle",
    "wrong-parent",
    "automatic-member",
  ])("rolls back the complete batch for %s", async (kind) => {
    await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "legacy" } });
    let batch: ImportRelayChannelsRequest = { channels: [standalone("valid"), standalone("invalid")] };
    if (kind === "mixed") batch = { channels: [standalone("valid"), body()] };
    if (kind === "duplicate") batch = { channels: [standalone("same"), standalone("same")] };
    if (kind === "unknown-field") batch.channels[1] = { ...standalone("invalid"), submittedByUserId: actor } as never;
    if (kind === "invalid-final") batch.channels[1] = { ...standalone("invalid"), multiplier: -1 };
    if (kind === "self") batch = { channels: [standalone("valid"), pool("self", ["self"])] };
    if (kind === "cycle") batch = { channels: [pool("a", ["b"]), pool("b", ["a"])] };
    if (kind === "wrong-parent")
      batch = {
        channels: [standalone("valid"), standalone("child", { channelType: "pooled-member", pooledParentId: "valid" })],
      };
    if (kind === "automatic-member")
      batch = {
        channels: [
          pool("parent", [other]),
          standalone("child", { channelType: "pooled-member", pooledParentId: "parent" }),
          { ...pool("automatic", ["child"]), channelType: "automatic-proxy-pool" },
        ],
      };
    const before = await channels();
    await expect(apply(batch)).rejects.toBeDefined();
    expect(await channels()).toEqual(before);
  });
  it.each([
    "mode",
    "principal",
    "group",
    "user",
    "catalog",
    "topology",
    "ownership",
    "credentials",
    "edges",
    "provider",
    "revision",
  ])("rejects late %s changes after awaited transactional audit", async (kind) => {
    vi.mocked(BusinessLogService.getInstance().logOperation).mockImplementation(async (_params, tx) => {
      expect(tx).toBeDefined();
      const rows = await tx!.relayChannel.findMany({
        where: { name: { in: [prefix + "first", prefix + "second"] } },
        orderBy: { name: "asc" },
      });
      expect(rows).toHaveLength(2);
      const id = rows[0]!.id;
      if (kind === "mode") env.security.iamAuthorizationMode = "legacy";
      if (kind === "principal") req.authContext!.accountOwnerId = peer;
      if (kind === "group") await tx!.group.update({ where: { id: groupId }, data: { permissions: [] } });
      if (kind === "user") await tx!.user.update({ where: { id: actor }, data: { status: 0 } });
      if (kind === "catalog")
        await tx!.modelPricing.updateMany({ where: { model: prefix + "model" }, data: { provider: "changed" } });
      if (kind === "topology")
        await tx!.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "strict-two-tier" } });
      if (kind === "ownership") await tx!.relayChannel.update({ where: { id }, data: { submittedByUserId: peer } });
      if (kind === "credentials")
        await tx!.relayChannel.update({ where: { id }, data: { openaiUpstreamApiKey: "fixture-injected" } });
      if (kind === "edges")
        await tx!.relayChannelMember.create({
          data: { relayChannelId: other, memberChannelId: id, priority: 0, weight: 1, enabled: true },
        });
      if (kind === "provider")
        await tx!.relayChannelProvider.create({
          data: {
            relayChannelId: id,
            userId: peer,
            commissionPercent: 1,
            settlementMode: "interval",
            settlementIntervalDays: 7,
          },
        });
      if (kind === "revision") {
        await tx!.ramResourceGroup.create({ data: { accountOwnerId: owner, name: prefix + "revision" } });
      }
      return undefined as never;
    });
    const req = request();
    await unchanged(() => apply({ channels: [standalone("first"), standalone("second")] }, req));
  });
  it("persists the actual success audit in the same transaction and rolls it back on final denial", async () => {
    vi.mocked(BusinessLogService.getInstance().logOperation).mockRestore();
    const operation = BusinessLogService.getInstance().logOperation.bind(BusinessLogService.getInstance());
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let deny = false;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      return deny && input.action === action
        ? result.map((row) => ({ ...row, decision: "ExplicitDeny" as const }))
        : result;
    });
    vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockImplementation(async (params, tx) => {
      const result = await operation(params, tx);
      expect(await tx!.businessLog.count({ where: { actorUserId: actor } })).toBe(1);
      deny = true;
      return result;
    });
    await unchanged(() => apply({ channels: [standalone("first"), standalone("second")] }));
    expect(await prisma.businessLog.count({ where: { actorUserId: actor } })).toBe(0);
  });
  it("sanitizes storage and audit failures without partial publication", async () => {
    vi.mocked(BusinessLogService.getInstance().logOperation).mockRejectedValue(new Error("fixture-sensitive-raw-sql"));
    const before = await channels();
    await expect(apply({ channels: [standalone("first"), standalone("second")] })).rejects.toMatchObject({
      statusCode: 500,
      message: "Channel import failed",
    });
    expect(await channels()).toEqual(before);
  });
  it.each(["legacy", "shadow"] as const)("runs original import once in %s mode", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const legacy = vi
      .spyOn(
        RelayChannelService.getInstance() as unknown as { importChannelsLegacy: () => Promise<unknown> },
        "importChannelsLegacy",
      )
      .mockResolvedValue({ code: 0, message: "success", created: 0, total: 0, data: [] } as never);
    const result = await apply();
    expect(result.created).toBe(0);
    expect(legacy).toHaveBeenCalledTimes(1);
  });
  it("never selects stored plaintext credentials while importing and proving the response", async () => {
    const selected: object[] = [];
    transactionHook((tx) => {
      for (const method of ["findMany", "findUnique"] as const) {
        const original = tx.relayChannel[method].bind(tx.relayChannel) as (input: unknown) => Promise<unknown>;
        vi.spyOn(tx.relayChannel, method).mockImplementation(((input: { select?: object }) => {
          selected.push(input.select ?? {});
          return original(input as never);
        }) as never);
      }
    });
    const result = await apply({ channels: [standalone("first"), standalone("second")] });
    expect(result.created).toBe(2);
    expect(selected.length).toBeGreaterThan(0);
    for (const select of selected)
      for (const key of ["openaiUpstreamApiKey", "anthropicUpstreamApiKey", "geminiUpstreamApiKey"])
        expect(select).not.toHaveProperty(key);
  });
  it("proves the entire destination set before provider lookup or persistence", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      return input.action === action
        ? result.map((row, index) => (index === 1 ? { ...row, decision: "ExplicitDeny" as const } : row))
        : result;
    });
    const writes = vi.spyOn(prisma.relayChannel, "create"),
      before = await channels();
    await expect(apply({ channels: [standalone("first"), standalone("second")] })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(writes).not.toHaveBeenCalled();
    expect(await channels()).toEqual(before);
  });
  it("uses one shared response snapshot for a supported 200-channel batch", async () => {
    let metadataScans = 0;
    transactionHook((tx) => {
      const original = tx.relayChannel.findMany.bind(tx.relayChannel);
      vi.spyOn(tx.relayChannel, "findMany").mockImplementation(((input: {
        select?: { id?: boolean; status?: boolean; createTime?: boolean; updateTime?: boolean; name?: boolean };
      }) => {
        if (
          input.select?.id &&
          input.select.status &&
          input.select.createTime &&
          input.select.updateTime &&
          !input.select.name
        )
          metadataScans++;
        return original(input as never);
      }) as never);
    });
    const result = await apply({ channels: Array.from({ length: 200 }, (_, index) => standalone("batch-" + index)) });
    expect(result.created).toBe(200);
    expect(result.data.map((row) => row.name)).toEqual(
      Array.from({ length: 200 }, (_, index) => prefix + "batch-" + index),
    );
    expect(metadataScans).toBeGreaterThan(0);
    expect(metadataScans).toBeLessThan(12);
  }, 60000);
});
