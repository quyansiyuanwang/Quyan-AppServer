import BusinessLogService from "@/services/system/businesslog.service";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, type IamCondition } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelExportIamService } from "@/services/relay/relay-channel-export-iam.service";
import { RelayChannelExportRepository } from "@/store/relay/relay-channel-export.repository";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { RelayPoolResolverService } from "@/services/relay/relay-pool-resolver.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import type { ExportRelayChannelsRequest } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
const initialMode = env.security.iamAuthorizationMode,
  action = "quyan:relay:ExportChannels";
let prefix: string,
  owner: string,
  actor: string,
  target: string,
  foreign: string,
  foreignOwner: string,
  root: string,
  first: string,
  second: string,
  leaf: string,
  groupId: string | undefined;
const arn = platformRelayChannelArn;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    secure: true,
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const invoke = (options: ExportRelayChannelsRequest = { ids: [root] }, req = request()) =>
  RelayChannelService.getInstance().exportChannels(options, actor, req);
async function policy(
  Action: string,
  Resource: string | string[],
  Effect: "Allow" | "Deny" = "Allow",
  principalId = actor,
  principalType = "user",
  Condition?: IamCondition,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect, Action, Resource, ...(Condition ? { Condition } : {}) },
  });
  const row = await RamPolicyRepository.getInstance().createPolicy({
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
      policyId: row.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
async function platformManager() {
  groupId = (
    await prisma.group.create({
      data: {
        username: prefix,
        name: prefix,
        accountOwnerId: null,
        permissions: [Permission.RELAY_CHANNEL_EXPORT],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
}
function afterRead(callback: () => Promise<void> | void) {
  const repository = RelayChannelExportRepository.getInstance(),
    original = repository.read.bind(repository);
  vi.spyOn(repository, "read").mockImplementation(async (...args) => {
    const result = await original(...args);
    await callback();
    return result;
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "channel-export-" + randomUUID();
  groupId = undefined;
  await prisma.relayChannel.deleteMany();
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: prefix + randomUUID(),
          password: "fixture-only",
          userType: accountOwnerId ? "ram_user" : "root",
          accountOwnerId,
          parentUserId: accountOwnerId,
          permissionAdds: accountOwnerId ? [Permission.RELAY_TOKEN_READ] : [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  await platformManager();
  target = await user(owner);
  foreignOwner = await user();
  foreign = await user(foreignOwner);
  const channel = async (suffix: string, data: Partial<Prisma.RelayChannelUncheckedCreateInput>) =>
    (
      await prisma.relayChannel.create({
        data: {
          name: prefix + suffix,
          openaiUpstreamApiKey: "fixture-only-secret",
          openaiUpstreamUrl: "https://fixture.invalid/private",
          allowedFormats: "openai-chat-completions,anthropic",
          routingConfig: { allowedModelsMode: "all" },
          ...data,
        },
      })
    ).id;
  root = await channel("root", {
    channelType: "automatic-proxy-pool",
    routingStrategy: "health-priority",
    routingConfig: {
      allowedModelsMode: "all",
      maxRetries: 3,
      stickyByModel: true,
      secret: "fixture-only-private-routing",
      manualAvailability: 0.5,
    },
  });
  first = await channel("first", {
    channelType: "pooled",
    multiplier: 2,
    allowedModels: JSON.stringify([prefix + "one"]),
    routingConfig: { allowedModelsMode: "manual" },
  });
  second = await channel("second", {
    channelType: "pooled",
    multiplier: 7,
    allowedModels: JSON.stringify([prefix + "two"]),
    routingConfig: { allowedModelsMode: "manual" },
  });
  leaf = await channel("leaf", { channelType: "pooled-member", pooledParentId: first });
  await prisma.relayChannelMember.createMany({
    data: [
      { relayChannelId: root, memberChannelId: first, priority: 0, enabled: true },
      { relayChannelId: root, memberChannelId: second, priority: 1, enabled: true },
      { relayChannelId: second, memberChannelId: leaf, priority: 0, enabled: true },
    ],
  });
  await prisma.modelPricing.createMany({
    data: [
      {
        model: prefix + "one",
        provider: prefix + "request-one",
        supportedFormats: "openai-chat-completions",
        inputPrice: 1,
        outputPrice: 1,
      },
      {
        model: prefix + "two",
        provider: prefix + "request-two",
        supportedFormats: "anthropic",
        inputPrice: 1,
        outputPrice: 1,
      },
    ],
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = initialMode;
  await prisma.relayChannel.deleteMany({ where: { name: { startsWith: prefix } } });
  await prisma.modelPricing.deleteMany({ where: { model: { startsWith: prefix } } });
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramUserRoleBinding.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, target, foreignOwner, foreign] } } });
  if (groupId) await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("native credential-free channel exports", () => {
  it("exports a complete dependency closure without reading credential or URL columns", async () => {
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "listVisibleByIds"),
      preload = vi.spyOn(RelayPoolResolverService.getInstance(), "preloadContext");
    const result = await invoke();
    expect(result.channels.map((row) => row.id)).toEqual([root, first, second, leaf]);
    expect(result.channels.find((row) => row.id === first)!.poolMembers).toEqual([
      { memberChannelId: leaf, priority: 0, weight: 1, enabled: true },
    ]);
    expect(result.channels.find((row) => row.id === leaf)!.pooledParentId).toBe(first);
    expect(result.channels[0].routingConfig).toEqual({
      allowedModelsMode: "all",
      maxRetries: 3,
      stickyByModel: true,
      manualAvailability: 0.5,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /fixture-only-secret|fixture.invalid|private-routing|Upstream|providers/,
    );
    expect(rich).not.toHaveBeenCalled();
    expect(preload).not.toHaveBeenCalled();
  });
  it.each(["root", "member", "leaf", "parent"])("rejects any denied %s without a partial export", async (part) => {
    const denied = part === "root" ? root : part === "member" ? second : part === "parent" ? first : leaf;
    await policy(action, arn(denied), "Deny");
    await expect(invoke(part === "parent" ? { ids: [leaf] } : undefined)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires the deployment-maintained ceiling even with a wildcard policy", async () => {
    await policy(action, "*");
    await prisma.group.update({ where: { id: groupId! }, data: { accountOwnerId: owner } });
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("never uses a different operation's channel grant for export", async () => {
    await prisma.group.update({ where: { id: groupId! }, data: { permissions: [Permission.RELAY_CHANNEL_READ] } });
    await policy("quyan:relay:GetChannel", "*");
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("includes disabled dependencies of active roots but not disabled unselected roots", async () => {
    await prisma.relayChannel.update({ where: { id: leaf }, data: { status: RELAY_CHANNEL_STATUS.DISABLED } });
    expect((await invoke()).channels.map((row) => row.id)).toContain(leaf);
    await expect(invoke({ ids: [leaf] })).rejects.toMatchObject({ statusCode: 403 });
    expect((await invoke({ ids: [leaf], includeDisabled: true })).channels.map((row) => row.id)).toEqual([leaf, first]);
  });
  it("rejects deleted dependencies rather than treating deleted status as disabled", async () => {
    await prisma.relayChannel.update({ where: { id: leaf }, data: { status: RELAY_CHANNEL_STATUS.DELETED } });
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
    await expect(invoke({ ids: [leaf], includeDisabled: true })).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["missing", "alias"])("does not resolve %s request IDs to a different resource", async (kind) => {
    await expect(invoke({ ids: [kind === "missing" ? "fixture-missing" : root.toUpperCase()] })).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("filters unrequested roots but refuses a denied dependency of an allowed pool", async () => {
    const unrelated = await prisma.relayChannel.create({ data: { name: prefix + "unrelated" } });
    await policy(action, arn(unrelated.id), "Deny");
    const result = await invoke({});
    expect(result.channels.map((row) => row.id)).not.toContain(unrelated.id);
    await policy(action, arn(leaf), "Deny");
    await expect(invoke({})).rejects.toMatchObject({ statusCode: 403 });
  });
  it("enforces business visibility for every expanded dependency", async () => {
    await prisma.relayChannel.update({ where: { id: second }, data: { visibilityMode: "private" } });
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses strict settings once when legacy and strict relations overlap", async () => {
    await prisma.relayChannelMember.create({
      data: { relayChannelId: first, memberChannelId: leaf, priority: 9, weight: 5, enabled: false },
    });
    const member = (await invoke()).channels.find((row) => row.id === first)!.poolMembers!;
    expect(member).toEqual([{ memberChannelId: leaf, priority: 0, weight: 1, enabled: true }]);
  });
  it("never echoes private regex literals in portable retry rules", async () => {
    await prisma.relayChannel.update({
      where: { id: root },
      data: { routingConfig: { retryStatusCodes: ["/^50[23]$|fixture-private-text/"] } },
    });
    expect((await invoke()).channels[0].routingConfig!.retryStatusCodes).toEqual([502, 503]);
    expect(JSON.stringify(await invoke())).not.toContain("fixture-private-text");
  });
  it("withholds the entire export if a policy or access key is revoked after collection", async () => {
    afterRead(async () => {
      await policy(action, arn(leaf), "Deny");
    });
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks authorization after business auditing before returning the file", async () => {
    vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockImplementationOnce(async () => {
      await policy(action, arn(leaf), "Deny");
    });
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks trusted transport Conditions at response release", async () => {
    await policy(action, arn(leaf), "Deny", actor, "user", { IpAddress: { "acs:SourceIp": "192.0.2.1" } });
    const req = request();
    afterRead(() => {
      Object.defineProperty(req, "ip", { value: "192.0.2.1" });
    });
    await expect(invoke(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks AccessKey revocation after an otherwise valid read", async () => {
    const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
    const req = request();
    req.accessKey = { id: key.id } as NonNullable<TypedRequest["accessKey"]>;
    req.authContext!.subjectType = "access_key";
    expect((await invoke(undefined, req)).channels).toHaveLength(4);
    afterRead(async () => {
      await prisma.accessKey.update({ where: { id: key.id }, data: { status: 0 } });
    });
    await expect(invoke(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("detects a tampered contributing snapshot without relying only on timestamps", async () => {
    let altered = false;
    // Every returned payload is compared with its transaction-local source, not just a timestamp.
    const projection = await import("@/services/relay/relay-channel-export-projection");
    const project = projection.projectRelayChannelExport;
    vi.spyOn(projection, "projectRelayChannelExport").mockImplementation((source, members) => {
      const result = project(source, members);
      if (!altered) {
        altered = true;
        source.name = source.name + "changed";
      }
      return result;
    });
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks role-session expiry and revocation", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: prefix } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await policy(action, "*", "Allow", role.id, "role");
    const req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    expect((await invoke(undefined, req)).channels).toHaveLength(4);
    afterRead(async () => {
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    });
    await expect(invoke(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects OAuth and requestless enforce calls before starting any export", async () => {
    const read = vi.spyOn(RelayChannelExportRepository.getInstance(), "read");
    await expect(RelayChannelService.getInstance().exportChannels({}, actor)).rejects.toMatchObject({
      statusCode: 403,
    });
    const req = request();
    req.oauthAccessToken = { id: "fixture" } as NonNullable<TypedRequest["oauthAccessToken"]>;
    await expect(invoke(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("shadow observes only admission and executes legacy projection once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const legacy = vi.fn(async () => ({ channels: [] }));
    expect(await RelayChannelExportIamService.getInstance().read({}, actor, request(), legacy)).toEqual({
      channels: [],
    });
    expect(legacy).toHaveBeenCalledTimes(1);
  });
});
