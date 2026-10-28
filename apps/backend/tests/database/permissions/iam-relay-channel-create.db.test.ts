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
import type { CreateRelayChannelRequest } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
import { platformRelayChannelProviderArn } from "@/iam/resources/platform-relay-channel-resources";
import { RelayConfigService } from "@/services/relay/relay-config.service";
const mode = env.security.iamAuthorizationMode,
  action = "quyan:relay:CreateChannel",
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
const apply = (input: CreateRelayChannelRequest = body(), req = request()) =>
  RelayChannelService.getInstance().createChannel(input, actor, req);
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
  prefix = "channel-create-" + randomUUID();
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
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined as never);
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.relayToken.deleteMany({ where: { userId: actor } });
  await prisma.relayChannel.deleteMany({ where: { name: { startsWith: prefix } } });
  await prisma.modelPricing.deleteMany({ where: { model: { startsWith: prefix } } });
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
describe("native administrator channel creation", () => {
  it("creates an enabled approved destination with no submission ownership or incidental providers", async () => {
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById"),
      broad = vi.spyOn(RelayConfigService.getInstance(), "getRelayConfig"),
      before = await source();
    const result = await apply(),
      row = await prisma.relayChannel.findUniqueOrThrow({ where: { id: result.id } });
    expect(row).toMatchObject({
      name: prefix + "new",
      status: RELAY_CHANNEL_STATUS.ENABLED,
      providerServiceEnabled: true,
      submissionStatus: "approved",
      submittedByUserId: null,
      reviewedByUserId: null,
      reviewedAt: null,
      reviewReason: null,
      openaiUpstreamApiKey: "fixture-only-new-key",
    });
    expect(await prisma.relayChannelProvider.count({ where: { relayChannelId: result.id } })).toBe(0);
    expect(await source()).toEqual(before);
    expect(result).toHaveProperty("hasOpenaiUpstreamApiKey", true);
    expect(JSON.stringify(result)).not.toMatch(/fixture-only-new-key|"openaiUpstreamApiKey"/);
    expect(rich).not.toHaveBeenCalled();
    expect(broad).not.toHaveBeenCalled();
  });
  it.each(["owned-group", "adds"])("cannot manufacture deployment create eligibility from %s", async (kind) => {
    if (kind === "owned-group") await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    else {
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RELAY_CHANNEL_CREATE] } });
    }
    await grant("*", "Allow");
    await unchanged(() => apply());
  });
  it("admits the destination before resolving provider names or loading model configuration", async () => {
    await grant("*");
    const pricing = vi.spyOn(prisma.modelPricing, "findMany"),
      users = vi.spyOn(prisma.user, "findUnique");
    await unchanged(() =>
      apply({ ...body(), providers: [{ username: "missing", commissionPercent: 5, settlementMode: "manual" }] }),
    );
    expect(pricing).not.toHaveBeenCalled();
    expect(users.mock.calls.some(([arg]) => arg.where.username === "missing")).toBe(false);
  });
  it("rejects forged scope fields rather than silently creating with them", async () => {
    await unchanged(() => apply({ ...body(), accountOwnerId: peer } as CreateRelayChannelRequest), 400);
  });
  it("rejects a live name collision without creating a destination", async () => {
    await unchanged(() => apply({ ...body(), name: prefix }), 409);
  });
  it("allows role JSON-only destination creation without reference or general update authority", async () => {
    const { req, role } = await roleRequest();
    await grant("acs:platform:*:platform:relay-channel/*", "Allow", "role", role.id);
    const result = await apply(body(), req);
    expect(result.name).toBe(prefix + "new");
  });
  it("wildcard destination creation does not implicitly grant reference access", async () => {
    const { req, role } = await roleRequest();
    await grant("acs:platform:*:platform:relay-channel/*", "Allow", "role", role.id);
    await unchanged(() =>
      apply(
        { ...body(), channelType: "automatic-proxy-pool", poolMembers: [{ memberChannelId: other, priority: 0 }] },
        req,
      ),
    );
  });
  it("uses exact separately granted existing references for automatic pools", async () => {
    const { req, role } = await roleRequest();
    await grant("acs:platform:*:platform:relay-channel/*", "Allow", "role", role.id);
    await grant(platformRelayChannelArn(other), "Allow", "role", role.id, undefined, referenceAction);
    const result = await apply(
      {
        ...body(),
        channelType: "automatic-proxy-pool",
        poolMembers: [{ memberChannelId: other, priority: 2, weight: 3, enabled: true }],
      },
      req,
    );
    expect(result.channelType).toBe("automatic-proxy-pool");
    const edge = await prisma.relayChannelMember.findFirstOrThrow({ where: { relayChannelId: result.id } });
    expect(edge).toMatchObject({ memberChannelId: other, priority: 2 });
    expect(Number(edge.weight)).toBe(3);
  });
  it("a reference grant alone cannot create a destination", async () => {
    const { req, role } = await roleRequest();
    await grant("*", "Allow", "role", role.id, undefined, referenceAction);
    await unchanged(() => apply(body(), req));
  });
  it.each(["pooled", "automatic-proxy-pool"])("supports %s with legacy configured members", async (channelType) => {
    await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "legacy" } });
    const result = await apply({
      ...body(),
      channelType: channelType as "pooled",
      poolMembers: [{ memberChannelId: other, priority: 0, enabled: false, weight: 2.12345678 }],
    });
    const edge = await prisma.relayChannelMember.findFirstOrThrow({ where: { relayChannelId: result.id } });
    expect(edge.enabled).toBe(false);
    expect(Number(edge.weight)).toBe(2.123457);
  });
  it("creates strict logical pools without moving physical children", async () => {
    await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "strict-two-tier" } });
    const result = await apply({ ...body(), channelType: "pooled" });
    expect(result.channelType).toBe("pooled");
    expect(await prisma.relayChannel.count({ where: { pooledParentId: result.id } })).toBe(0);
  });
  it("creates physical members with parent proof without requiring unrelated siblings", async () => {
    await prisma.relayChannel.update({ where: { id: other }, data: { channelType: "pooled" } });
    const sibling = await prisma.relayChannel.create({
      data: { name: prefix + "sibling", channelType: "pooled-member", pooledParentId: other },
    });
    await grant(platformRelayChannelArn(sibling.id), "Deny", "user", actor, undefined, referenceAction);
    const result = await apply({ ...body(), channelType: "pooled-member", pooledParentId: other, pooledWeight: 2 });
    expect(await prisma.relayChannel.findUnique({ where: { id: result.id } })).toMatchObject({
      pooledParentId: other,
      visibilityMode: "hidden",
    });
  });
  it("rejects an unauthorized parent, missing member or incompatible parent type", async () => {
    await unchanged(() => apply({ ...body(), channelType: "pooled-member", pooledParentId: other }), 400);
    await unchanged(() =>
      apply({
        ...body(),
        channelType: "automatic-proxy-pool",
        poolMembers: [{ memberChannelId: "absent", priority: 0 }],
      }),
    );
    await prisma.relayChannel.update({ where: { id: other }, data: { channelType: "pooled" } });
    await grant(platformRelayChannelArn(other), "Deny", "user", actor, undefined, referenceAction);
    await unchanged(() => apply({ ...body(), channelType: "pooled-member", pooledParentId: other }));
  });
  it("rejects physical members as automatic pool targets", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "pooled" } });
    await prisma.relayChannel.update({
      where: { id: other },
      data: { channelType: "pooled-member", pooledParentId: channel },
    });
    await unchanged(
      () =>
        apply({
          ...body(),
          channelType: "automatic-proxy-pool",
          poolMembers: [{ memberChannelId: other, priority: 0 }],
        }),
      400,
    );
  });
  it("rejects cyclic existing references before a destination is written", async () => {
    await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "legacy" } });
    await prisma.relayChannel.updateMany({ where: { id: { in: [channel, other] } }, data: { channelType: "pooled" } });
    await prisma.relayChannelMember.createMany({
      data: [
        { relayChannelId: channel, memberChannelId: other, priority: 0 },
        { relayChannelId: other, memberChannelId: channel, priority: 0 },
      ],
    });
    await unchanged(
      () => apply({ ...body(), channelType: "pooled", poolMembers: [{ memberChannelId: channel, priority: 0 }] }),
      400,
    );
  });
  it("rejects strict logical pool configured members", async () => {
    await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "strict-two-tier" } });
    await unchanged(
      () => apply({ ...body(), channelType: "pooled", poolMembers: [{ memberChannelId: other, priority: 0 }] }),
      400,
    );
  });
  it("does not write a provider relation without its distinct destination relation grant", async () => {
    const { req, role } = await roleRequest();
    await grant("acs:platform:*:platform:relay-channel/*", "Allow", "role", role.id);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: peer } });
    await unchanged(() =>
      apply(
        { ...body(), providers: [{ username: user.username, commissionPercent: 5, settlementMode: "manual" }] },
        req,
      ),
    );
  });
  it("creates only explicit provider relations without settlement history or identity grants", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: peer } });
    const result = await apply({
      ...body(),
      providers: [{ username: user.username, commissionPercent: 5.12345678, settlementMode: "manual" }],
    });
    const rows = await prisma.relayChannelProvider.findMany({ where: { relayChannelId: result.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: peer, status: 1, lastSettledAt: null });
    expect(Number(rows[0]!.commissionPercent)).toBe(5.123457);
    expect(await prisma.ramAuthorization.count({ where: { principalId: peer } })).toBe(0);
  });
  it("rejects disabled or duplicate recipients", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: peer } });
    const provider = { username: user.username, commissionPercent: 5, settlementMode: "manual" as const };
    await unchanged(() => apply({ ...body(), providers: [provider, provider] }), 400);
    await prisma.user.update({ where: { id: peer }, data: { status: 0 } });
    await unchanged(() => apply({ ...body(), providers: [provider] }), 400);
  });
  it("rejects missing context or OAuth and cannot use client Action headers", async () => {
    const req = request();
    delete req.user;
    delete req.authContext;
    await unchanged(() => apply(body(), req));
    const oauth = request();
    oauth.oauthAccessToken = {} as never;
    await unchanged(() => apply(body(), oauth));
    await grant("*");
    const forged = request();
    forged.headers["x-action"] = referenceAction;
    await unchanged(() => apply(body(), forged));
  });
  it.each([
    "mode",
    "identity",
    "key",
    "session",
    "catalog",
    "source",
    "group",
    "topology",
    "condition",
    "ownership",
    "provider",
    "user",
    "credential",
    "revision",
  ])("rolls back after awaited audit changes %s", async (kind) => {
    const req = request();
    let sessionId: string | undefined;
    if (kind === "key") {
      const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
      req.accessKey = { id: key.id } as TypedRequest["accessKey"];
      req.authContext!.subjectType = "access_key";
    }
    if (kind === "session") {
      const assumed = await roleRequest();
      Object.assign(req.authContext!, assumed.req.authContext);
      sessionId = assumed.session.id;
      await grant("acs:platform:*:platform:relay-channel/*", "Allow", "role", assumed.role.id);
    }
    if (kind === "condition")
      await grant("*", "Deny", "user", actor, { IpAddress: { "acs:SourceIp": "192.0.2.0/24" } });
    transactionHook((tx) => {
      vi.mocked(BusinessLogService.getInstance().logOperation).mockImplementation(async (params) => {
        const id = params.targetResourceId!;
        if (kind === "mode") env.security.iamAuthorizationMode = "legacy";
        else if (kind === "identity") req.authContext!.accountOwnerId = peer;
        else if (kind === "condition") Object.defineProperty(req, "ip", { value: "192.0.2.1", configurable: true });
        else if (kind === "key") await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
        else if (kind === "session") await tx.ramRoleSession.update({ where: { id: sessionId! }, data: { status: 0 } });
        else if (kind === "catalog")
          await tx.modelPricing.updateMany({ where: { model: prefix + "new" }, data: { status: 0 } });
        else if (kind === "source") await tx.relayChannel.update({ where: { id }, data: { multiplier: 3 } });
        else if (kind === "group") await tx.group.update({ where: { id: groupId }, data: { permissions: [] } });
        else if (kind === "topology")
          await tx.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "invalid" } });
        else if (kind === "ownership")
          await tx.relayChannel.update({ where: { id }, data: { submittedByUserId: peer } });
        else if (kind === "credential")
          await tx.relayChannel.update({ where: { id }, data: { openaiUpstreamApiKey: "fixture-tamper" } });
        else if (kind === "provider")
          await tx.relayChannelProvider.create({
            data: { relayChannelId: id, userId: peer, commissionPercent: 99, settlementMode: "manual" },
          });
        else if (kind === "user") await tx.user.update({ where: { id: actor }, data: { status: 0 } });
        else await tx.ramResourceGroup.create({ data: { accountOwnerId: owner, name: prefix + "revision" } });
      });
    });
    await unchanged(() => apply(body(), req));
  });
  it("rolls back a reference modification hidden during creation", async () => {
    transactionHook((tx) => {
      const original = tx.relayChannel.create.bind(tx.relayChannel);
      vi.spyOn(tx.relayChannel, "create").mockImplementation((async (args: Prisma.RelayChannelCreateArgs) => {
        const result = await original(args);
        await tx.relayChannel.update({ where: { id: other }, data: { status: 0 } });
        return result;
      }) as never);
    });
    await unchanged(() =>
      apply({ ...body(), channelType: "automatic-proxy-pool", poolMembers: [{ memberChannelId: other, priority: 0 }] }),
    );
  });
  it("performs SQL credential comparison without selecting stored plaintext", async () => {
    const selects: unknown[] = [];
    transactionHook((tx) => {
      for (const method of ["findMany", "findFirst", "findUnique"] as const) {
        const original = tx.relayChannel[method].bind(tx.relayChannel);
        vi.spyOn(tx.relayChannel, method).mockImplementation((async (args: { select?: unknown }) => {
          selects.push(args.select);
          return (original as (args: { select?: unknown }) => Promise<unknown>)(args);
        }) as never);
      }
    });
    await apply();
    for (const select of selects) {
      expect(select).toBeDefined();
      expect(JSON.stringify(select)).not.toMatch(/"(?:openai|anthropic|gemini)UpstreamApiKey"/);
    }
  });
  it("commits the real success audit with configuration and never includes key values", async () => {
    vi.mocked(BusinessLogService.getInstance().logOperation).mockRestore();
    await apply();
    const logs = await prisma.businessLog.findMany({ where: { actorUserId: actor } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.success).toBe(true);
    expect(JSON.stringify(logs)).not.toContain("fixture-only-new-key");
  });
  it("rolls back an inserted audit record on a final denial", async () => {
    vi.mocked(BusinessLogService.getInstance().logOperation).mockRestore();
    const service = BusinessLogService.getInstance(),
      original = service.logOperation.bind(service);
    let inserted = false;
    vi.spyOn(service, "logOperation").mockImplementation(async (params, tx) => {
      await original(params, tx);
      inserted = Boolean(await tx!.businessLog.findFirst({ where: { actorUserId: actor } }));
      env.security.iamAuthorizationMode = "legacy";
    });
    await unchanged(() => apply());
    expect(inserted).toBe(true);
    expect(await prisma.businessLog.count({ where: { actorUserId: actor } })).toBe(0);
  });
  it("rejects raw storage faults without leaking supplied credentials", async () => {
    transactionHook((tx) => {
      vi.spyOn(tx.relayChannel, "create").mockRejectedValue(new Error("fixture-only-new-key SQL password"));
    });
    await expect(apply()).rejects.toMatchObject({
      statusCode: 500,
      message: expect.not.stringMatching(/fixture-only-new-key|SQL|password/),
    });
    expect(await channels()).toHaveLength(2);
  });
  it.each(["legacy", "shadow"] as const)("%s only performs the original create once", async (variant) => {
    env.security.iamAuthorizationMode = variant;
    const write = vi.spyOn(RelayChannelRepository.getInstance(), "create");
    await apply();
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("supports separately granted role provider relations without an identity-management grant", async () => {
    const { req, role } = await roleRequest();
    await grant("acs:platform:*:platform:relay-channel/*", "Allow", "role", role.id);
    await grant("acs:platform:*:platform:relay-channel-provider/*/" + peer, "Allow", "role", role.id);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: peer } });
    const result = await apply(
      { ...body(), providers: [{ username: user.username, commissionPercent: 5, settlementMode: "manual" }] },
      req,
    );
    const iam = IamAuthorizationService.getInstance();
    expect(
      (
        await iam.authorize({
          principal: {
            subjectUserId: actor,
            principalUserId: actor,
            accountOwnerId: owner,
            subjectType: "assumed_role",
            assumedRoleId: role.id,
            roleSessionId: req.authContext!.roleSessionId,
          },
          action,
          resource: platformRelayChannelProviderArn(result.id, peer),
        })
      ).decision,
    ).toBe("Allow");
    expect(await prisma.ramAuthorization.count({ where: { principalId: peer } })).toBe(0);
  });
  it("rolls back a final explicit destination Deny after creation", async () => {
    let written = false;
    transactionHook((tx) => {
      const original = tx.relayChannel.create.bind(tx.relayChannel);
      vi.spyOn(tx.relayChannel, "create").mockImplementation((async (args: Prisma.RelayChannelCreateArgs) => {
        const result = await original(args);
        written = true;
        return result;
      }) as never);
    });
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      return written
        ? result.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] }))
        : result;
    });
    await unchanged(() => apply());
    expect(written).toBe(true);
  });
  it("does not publish a destination if its transactional audit cannot be persisted", async () => {
    vi.mocked(BusinessLogService.getInstance().logOperation).mockRestore();
    transactionHook((tx) => {
      vi.spyOn(tx.businessLog, "create").mockRejectedValue(new Error("fixture-only-new-key SQL"));
    });
    await unchanged(() => apply(), 500);
  });
  it("rolls back a new unexpected incoming pool reference", async () => {
    transactionHook((tx) => {
      vi.mocked(BusinessLogService.getInstance().logOperation).mockImplementation(async (params) => {
        await tx.relayChannelMember.create({
          data: { relayChannelId: other, memberChannelId: params.targetResourceId!, priority: 0 },
        });
      });
    });
    await unchanged(() => apply());
  });
  it("rejects an unknown authorization mode without persisting", async () => {
    env.security.iamAuthorizationMode = "invalid" as never;
    await unchanged(() => apply());
  });
});
