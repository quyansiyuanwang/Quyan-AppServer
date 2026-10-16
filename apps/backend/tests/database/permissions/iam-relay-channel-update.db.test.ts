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
import type { UpdateRelayChannelRequest } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
import { platformRelayChannelProviderArn } from "@/iam/resources/platform-relay-channel-resources";
import { RelayConfigService } from "@/services/relay/relay-config.service";
const mode = env.security.iamAuthorizationMode,
  action = "quyan:relay:UpdateChannel";
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
const apply = (input: UpdateRelayChannelRequest = { multiplier: 2 }, req = request()) =>
  RelayChannelService.getInstance().updateChannel(channel, input, actor, req);
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
  prefix = "channel-update-" + randomUUID();
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
      data: { username: prefix, name: prefix, accountOwnerId: null, permissions: [Permission.RELAY_CHANNEL_UPDATE] },
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
describe("native resource-scoped administrative channel update", () => {
  it("updates scalar configuration without selecting plaintext credentials or changing relations", async () => {
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById"),
      broad = vi.spyOn(RelayConfigService.getInstance(), "getRelayConfig"),
      before = await source(),
      beforeProviders = await providers();
    const result = await apply();
    expect(await source()).toMatchObject({ ...before, multiplier: expect.anything(), updateTime: expect.any(Date) });
    expect(await providers()).toEqual(beforeProviders);
    expect(Number((await source()).multiplier)).toBe(2);
    expect(result.id).toBe(channel);
    expect(JSON.stringify(result)).not.toMatch(/fixture-secret|openaiUpstreamApiKey/);
    expect(rich).not.toHaveBeenCalled();
    expect(broad).not.toHaveBeenCalled();
  });
  it("selectively replaces a supplied credential without changing the other credentials", async () => {
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { anthropicUpstreamApiKey: "fixture-anthropic" },
    });
    const result = await apply({ openaiUpstreamApiKey: "fixture-replacement" });
    expect(await source()).toMatchObject({
      openaiUpstreamApiKey: "fixture-replacement",
      anthropicUpstreamApiKey: "fixture-anthropic",
    });
    expect(JSON.stringify(result)).not.toMatch(/fixture-replacement|fixture-anthropic|"openaiUpstreamApiKey"/);
  });
  it("admits the root before configuration or provider-name lookup", async () => {
    await grant(platformRelayChannelArn(channel));
    const read = vi.spyOn(prisma.relayChannel, "findUnique");
    await unchanged(() =>
      apply({ providers: [{ username: "missing", commissionPercent: 1, settlementMode: "manual" }] }),
    );
    expect(read).not.toHaveBeenCalled();
  });
  it("requires the deployment update ceiling even with a direct wildcard Allow", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await grant("*", "Allow");
    await unchanged(() => apply());
  });
  it("accepts a role JSON-only exact resource Allow and rejects its explicit Deny", async () => {
    const { req, role } = await roleRequest();
    await grant(platformRelayChannelArn(channel), "Allow", "role", role.id);
    await apply({ multiplier: 3 }, req);
    await grant(platformRelayChannelArn(channel), "Deny", "role", role.id);
    await unchanged(() => apply({}, req));
  });
  it("rejects unknown fields and cannot be redirected by a client Action header", async () => {
    await unchanged(() => apply({ accountOwnerId: owner } as UpdateRelayChannelRequest), 400);
    await grant(platformRelayChannelArn(channel));
    const req = request();
    req.headers["x-action"] = "quyan:relay:GetChannel";
    await unchanged(() => apply({}, req));
  });
  it("fails closed for missing identity, OAuth or unknown authorization modes", async () => {
    const req = request();
    delete req.authContext;
    delete req.user;
    await unchanged(() => apply({}, req));
    const oauth = request();
    oauth.oauthAccessToken = {} as never;
    await unchanged(() => apply({}, oauth));
    env.security.iamAuthorizationMode = "invalid" as never;
    await unchanged(() => apply());
  });
  it("rejects a colliding name without changing any channel", async () => {
    await unchanged(() => apply({ name: prefix + "other" }), 409);
  });
  it("updates a physical member weight while preserving and checking its parent", async () => {
    await prisma.relayChannel.update({ where: { id: other }, data: { channelType: "pooled" } });
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { channelType: "pooled-member", pooledParentId: other },
    });
    await apply({ pooledWeight: 3 });
    expect((await source()).pooledParentId).toBe(other);
    expect(Number((await source()).pooledWeight)).toBe(3);
    await grant(platformRelayChannelArn(other));
    await unchanged(() => apply({ pooledWeight: 4 }));
  });
  it("does not require an unrelated sibling grant when updating a physical member", async () => {
    await prisma.relayChannel.update({ where: { id: other }, data: { channelType: "pooled" } });
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { channelType: "pooled-member", pooledParentId: other },
    });
    const sibling = await prisma.relayChannel.create({
      data: { name: prefix + "sibling", channelType: "pooled-member", pooledParentId: other },
    });
    await grant(platformRelayChannelArn(sibling.id));
    await apply({ pooledWeight: 2 });
  });
  it("moves a physical member between admitted parents and rejects a denied old parent", async () => {
    await prisma.relayChannel.update({ where: { id: other }, data: { channelType: "pooled" } });
    const parent = await prisma.relayChannel.create({ data: { name: prefix + "parent", channelType: "pooled" } });
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { channelType: "pooled-member", pooledParentId: other },
    });
    await grant(platformRelayChannelArn(other));
    await unchanged(() => apply({ pooledParentId: parent.id }));
  });
  it.each(["pooled", "automatic-proxy-pool"])("preserves %s member terms on scalar updates", async (channelType) => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType } });
    await prisma.relayChannelMember.create({
      data: { relayChannelId: channel, memberChannelId: other, priority: 3, weight: 2, enabled: true },
    });
    const before = await prisma.relayChannelMember.findMany({ where: { relayChannelId: channel } });
    await apply();
    expect(await prisma.relayChannelMember.findMany({ where: { relayChannelId: channel } })).toEqual(before);
  });
  it("requires added and removed pool member grants and replaces terms atomically", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "automatic-proxy-pool" } });
    await grant(platformRelayChannelArn(other));
    await unchanged(() => apply({ poolMembers: [{ memberChannelId: other, priority: 0, weight: 1, enabled: true }] }));
  });
  it("rejects cycles through legacy logical pool members", async () => {
    await prisma.relayChannel.updateMany({ where: { id: { in: [channel, other] } }, data: { channelType: "pooled" } });
    await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "legacy" } });
    await prisma.relayChannelMember.create({
      data: { relayChannelId: other, memberChannelId: channel, priority: 0, weight: 1, enabled: true },
    });
    await unchanged(
      () => apply({ poolMembers: [{ memberChannelId: other, priority: 0, weight: 1, enabled: true }] }),
      400,
    );
  });
  it("cannot convert a logical pool with physical children", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "pooled" } });
    await prisma.relayChannel.update({
      where: { id: other },
      data: { channelType: "pooled-member", pooledParentId: channel },
    });
    await unchanged(() => apply({ channelType: "standalone" }), 400);
  });
  it("requires provider-relation grants for removed and reactivated recipients", async () => {
    await grant(platformRelayChannelProviderArn(channel, peer));
    await unchanged(() => apply({ providers: [] }));
  });
  it("preserves provider history while replacing terms and soft-removing old recipients", async () => {
    const old = await prisma.user.findUniqueOrThrow({ where: { id: peer }, select: { username: true } });
    const lastSettledAt = new Date("2020-01-01T00:00:00Z");
    await prisma.relayChannelProvider.updateMany({ where: { relayChannelId: channel }, data: { lastSettledAt } });
    await apply({ providers: [{ username: old.username, commissionPercent: 22, settlementMode: "manual" }] });
    expect((await providers())[0]).toMatchObject({ commissionPercent: expect.anything(), lastSettledAt, status: 1 });
    expect(Number((await providers())[0]!.commissionPercent)).toBe(22);
    await apply({ providers: [] });
    expect((await providers())[0]).toMatchObject({ lastSettledAt, status: 0 });
  });
  it("rolls back a late mode change after the awaited audit", async () => {
    vi.mocked(BusinessLogService.getInstance().logOperation).mockImplementation(async () => {
      env.security.iamAuthorizationMode = "legacy";
    });
    await unchanged(() => apply());
  });
  it("rolls back a credential tamper inside the transaction", async () => {
    transactionHook((tx) => {
      vi.mocked(BusinessLogService.getInstance().logOperation).mockImplementation(async () => {
        await tx.relayChannel.update({ where: { id: channel }, data: { openaiUpstreamApiKey: "fixture-tamper" } });
      });
    });
    await unchanged(() => apply());
  });
  it("rolls back a graph tamper hidden in the write implementation", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "automatic-proxy-pool" } });
    const original = RelayChannelRepository.getInstance().replaceMembersByChannelId.bind(
      RelayChannelRepository.getInstance(),
    );
    vi.spyOn(RelayChannelRepository.getInstance(), "replaceMembersByChannelId").mockImplementation(
      async (id, members, tx) => {
        await original(id, members, tx);
        await tx!.relayChannel.update({ where: { id: other }, data: { channelType: "pooled" } });
      },
    );
    await unchanged(() => apply({ poolMembers: [{ memberChannelId: other, priority: 0, weight: 1, enabled: true }] }));
  });
  it("replaces logical legacy edges only with authorized targets", async () => {
    await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "legacy" } });
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "pooled" } });
    await apply({ poolMembers: [{ memberChannelId: other, priority: 2, weight: 3, enabled: false }] });
    const edge = await prisma.relayChannelMember.findFirstOrThrow({ where: { relayChannelId: channel } });
    expect(edge).toMatchObject({ memberChannelId: other, priority: 2, enabled: false });
    expect(Number(edge.weight)).toBe(3);
  });
  it("does not remove denied old members when replacing pool configuration", async () => {
    await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "legacy" } });
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "pooled" } });
    await prisma.relayChannelMember.create({ data: { relayChannelId: channel, memberChannelId: other, priority: 0 } });
    await grant(platformRelayChannelArn(other));
    await unchanged(() => apply({ channelType: "standalone" }));
    expect(await prisma.relayChannelMember.count({ where: { relayChannelId: channel } })).toBe(1);
  });
  it("moves an admitted physical member without changing old or new parent's unrelated children", async () => {
    await prisma.relayChannel.update({ where: { id: other }, data: { channelType: "pooled" } });
    const parent = await prisma.relayChannel.create({ data: { name: prefix + "parent", channelType: "pooled" } });
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { channelType: "pooled-member", pooledParentId: other },
    });
    await apply({ pooledParentId: parent.id });
    expect((await source()).pooledParentId).toBe(parent.id);
  });
  it("rejects a missing pool member without writing", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "automatic-proxy-pool" } });
    await unchanged(() =>
      apply({ poolMembers: [{ memberChannelId: "nonexistent", priority: 0, weight: 1, enabled: true }] }),
    );
  });
  it("rejects a physical member as an automatic pool target", async () => {
    const parent = await prisma.relayChannel.create({ data: { name: prefix + "parent", channelType: "pooled" } });
    await prisma.relayChannel.update({
      where: { id: other },
      data: { channelType: "pooled-member", pooledParentId: parent.id },
    });
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "automatic-proxy-pool" } });
    await unchanged(
      () => apply({ poolMembers: [{ memberChannelId: other, priority: 0, weight: 1, enabled: true }] }),
      400,
    );
  });
  it("cannot convert an existing automatic pool target into a physical member", async () => {
    const parent = await prisma.relayChannel.create({ data: { name: prefix + "parent", channelType: "pooled" } });
    await prisma.relayChannel.update({ where: { id: other }, data: { channelType: "automatic-proxy-pool" } });
    await prisma.relayChannelMember.create({ data: { relayChannelId: other, memberChannelId: channel, priority: 0 } });
    await unchanged(() => apply({ channelType: "pooled-member", pooledParentId: parent.id }), 400);
  });
  it("rejects legacy pool members in strict mode", async () => {
    await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "strict-two-tier" } });
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "pooled" } });
    await unchanged(
      () => apply({ poolMembers: [{ memberChannelId: other, priority: 0, weight: 1, enabled: true }] }),
      400,
    );
  });
  it("requires a grant when reactivating a previously inactive provider", async () => {
    await prisma.relayChannelProvider.updateMany({ where: { relayChannelId: channel }, data: { status: 0 } });
    await grant(platformRelayChannelProviderArn(channel, peer));
    const user = await prisma.user.findUniqueOrThrow({ where: { id: peer } });
    await unchanged(() =>
      apply({ providers: [{ username: user.username, commissionPercent: 1, settlementMode: "manual" }] }),
    );
  });
  it("reactivates provider relations preserving IDs and settlement history", async () => {
    const before = (await providers())[0]!,
      lastSettledAt = new Date("2020-01-01T00:00:00Z"),
      user = await prisma.user.findUniqueOrThrow({ where: { id: peer } });
    await prisma.relayChannelProvider.updateMany({
      where: { relayChannelId: channel },
      data: { status: 0, lastSettledAt },
    });
    await apply({ providers: [{ username: user.username, commissionPercent: 5, settlementMode: "manual" }] });
    expect((await providers())[0]).toMatchObject({ id: before.id, lastSettledAt, status: 1 });
  });
  it("rejects a newly inserted inactive provider not in the intended mutation", async () => {
    const original = RelayChannelRepository.getInstance().replaceProvidersByChannelId.bind(
      RelayChannelRepository.getInstance(),
    );
    vi.spyOn(RelayChannelRepository.getInstance(), "replaceProvidersByChannelId").mockImplementation(
      async (id, values, tx) => {
        await original(id, values, tx);
        await tx!.relayChannelProvider.create({
          data: { relayChannelId: id, userId: submitter, status: 0, commissionPercent: 1, settlementMode: "manual" },
        });
      },
    );
    await unchanged(() => apply({ providers: [] }));
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
    "revision",
  ])("rolls back late %s changes after awaited audit", async (kind) => {
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
      await grant(platformRelayChannelArn(channel), "Allow", "role", assumed.role.id);
    }
    if (kind === "condition")
      await grant("*", "Deny", "user", actor, { IpAddress: { "acs:SourceIp": "192.0.2.0/24" } });
    transactionHook((tx) => {
      vi.mocked(BusinessLogService.getInstance().logOperation).mockImplementation(async () => {
        if (kind === "mode") env.security.iamAuthorizationMode = "legacy";
        else if (kind === "identity") req.authContext!.accountOwnerId = peer;
        else if (kind === "condition") Object.defineProperty(req, "ip", { value: "192.0.2.1", configurable: true });
        else if (kind === "key") await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
        else if (kind === "session") await tx.ramRoleSession.update({ where: { id: sessionId! }, data: { status: 0 } });
        else if (kind === "catalog")
          await tx.modelPricing.updateMany({ where: { model: prefix + "new" }, data: { status: 0 } });
        else if (kind === "source") await tx.relayChannel.update({ where: { id: channel }, data: { multiplier: 3 } });
        else if (kind === "group") await tx.group.update({ where: { id: groupId }, data: { permissions: [] } });
        else if (kind === "topology")
          await tx.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "invalid" } });
        else if (kind === "ownership")
          await tx.relayChannel.update({ where: { id: channel }, data: { submittedByUserId: peer } });
        else if (kind === "provider")
          await tx.relayChannelProvider.updateMany({
            where: { relayChannelId: channel },
            data: { commissionPercent: 99 },
          });
        else if (kind === "user") await tx.user.update({ where: { id: actor }, data: { status: 0 } });
        else await tx.ramResourceGroup.create({ data: { accountOwnerId: owner, name: prefix + "revision" } });
      });
    });
    await unchanged(() => apply(undefined, req));
  });
  it("rolls back a final explicit Deny even if the policy cache changes after writing", async () => {
    let written = false;
    transactionHook((tx) => {
      const original = tx.relayChannel.updateMany.bind(tx.relayChannel);
      vi.spyOn(tx.relayChannel, "updateMany").mockImplementation((async (args: Prisma.RelayChannelUpdateManyArgs) => {
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
  it.each(["legacy", "shadow"] as const)(
    "%s performs the original write once without native persistence",
    async (variant) => {
      env.security.iamAuthorizationMode = variant;
      const write = vi.spyOn(RelayChannelRepository.getInstance(), "updateById");
      await apply();
      expect(write).toHaveBeenCalledTimes(1);
    },
  );
  it("does not select plaintext credentials in any native channel configuration query", async () => {
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
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      expect(select).toBeDefined();
      expect(JSON.stringify(select)).not.toMatch(/"(?:openai|anthropic|gemini)UpstreamApiKey"/);
    }
  });
  it("refuses hiding a directly assigned channel", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { visibilityMode: "public" } });
    await prisma.relayToken.create({ data: { userId: actor, channelId: channel, token: "fixture-" + randomUUID() } });
    await unchanged(() => apply({ visibilityMode: "hidden" }), 400);
  });
  it("never includes submitted credentials in the audit payload", async () => {
    await apply({ openaiUpstreamApiKey: "fixture-audit-secret" });
    const calls = vi.mocked(BusinessLogService.getInstance().logOperation).mock.calls;
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls.map(([payload]) => payload))).not.toContain("fixture-audit-secret");
    expect(calls[0]![0].metadata).toEqual({ fields: ["openaiUpstreamApiKey"] });
  });
  it("verifies weights using the database's decimal precision", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "automatic-proxy-pool" } });
    await apply({ poolMembers: [{ memberChannelId: other, priority: 0, weight: 2.12345678, enabled: true }] });
    const edge = await prisma.relayChannelMember.findFirstOrThrow({ where: { relayChannelId: channel } });
    expect(Number(edge.weight)).toBe(2.123457);
    await apply({ pooledWeight: 3.12345678 });
    expect(Number((await source()).pooledWeight)).toBe(3.123457);
  });
  describe.each(["single", "batch", "copy"] as const)("transactional %s audit", (variant) => {
    const operate = () =>
      variant === "single"
        ? apply()
        : variant === "batch"
          ? RelayChannelService.getInstance().batchUpdateChannels(
              { ids: [channel], patch: { multiplier: 2 } },
              actor,
              request(),
            )
          : RelayChannelService.getInstance().duplicateChannel(channel, {}, actor, request());
    const logs = () => prisma.businessLog.findMany({ where: { actorUserId: actor } });
    beforeEach(async () => {
      await prisma.group.update({
        where: { id: groupId },
        data: { permissions: [Permission.RELAY_CHANNEL_UPDATE, Permission.RELAY_CHANNEL_CREATE] },
      });
      vi.mocked(BusinessLogService.getInstance().logOperation).mockRestore();
    });
    it("commits the actual success log with the authorized mutation", async () => {
      await operate();
      expect(await logs()).toHaveLength(1);
      expect((await logs())[0]!.success).toBe(true);
      expect(JSON.stringify(await logs())).not.toMatch(/fixture-secret|fixture-replacement/);
    });
    it("rolls back a persisted audit record if final authorization changes", async () => {
      const service = BusinessLogService.getInstance(),
        original = service.logOperation.bind(service);
      let persisted = false;
      vi.spyOn(service, "logOperation").mockImplementation(async (params, tx) => {
        expect(tx).toBeDefined();
        await original(params, tx);
        persisted = Boolean(await tx!.businessLog.findFirst({ where: { actorUserId: actor } }));
        env.security.iamAuthorizationMode = "legacy";
      });
      await unchanged(operate);
      expect(persisted).toBe(true);
      expect(await logs()).toEqual([]);
    });
    it("fails closed and returns no raw storage error when transactional logging fails", async () => {
      transactionHook((tx) => {
        vi.spyOn(tx.businessLog, "create").mockRejectedValue(new Error("fixture-secret SQL credential arguments"));
      });
      const before = await channels();
      await expect(operate()).rejects.toMatchObject({
        statusCode: 500,
        message: expect.not.stringMatching(/fixture-secret|SQL/),
      });
      expect(await channels()).toEqual(before);
      expect(await logs()).toEqual([]);
    });
  });
});
