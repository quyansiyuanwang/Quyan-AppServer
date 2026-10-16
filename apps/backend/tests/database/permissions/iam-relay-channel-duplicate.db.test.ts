import { RELAY_CAPABILITY_RESOLUTION_LIMITS } from "@/constant/relay-capability";
import { OperationType } from "@/constant/operation-type";
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
import type { DuplicateRelayChannelRequest } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
import { RelayChannelDuplicateRepository } from "@/store/relay/relay-channel-duplicate.repository";
import { RelayConfigService } from "@/services/relay/relay-config.service";
const mode = env.security.iamAuthorizationMode,
  action = "quyan:relay:DuplicateChannels",
  destinationAction = "quyan:relay:CreateChannelCopy";
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
const apply = (ids = [channel, other], req = request()) =>
  RelayChannelService.getInstance().batchDuplicateChannels(ids, actor, req);
const single = (input: DuplicateRelayChannelRequest = {}, req = request()) =>
  RelayChannelService.getInstance().duplicateChannel(channel, input, actor, req);
const source = () => prisma.relayChannel.findUniqueOrThrow({ where: { id: channel } });
const channels = () =>
  prisma.relayChannel.findMany({ where: { name: { startsWith: prefix } }, orderBy: { id: "asc" } });
const providers = () =>
  prisma.relayChannelProvider.findMany({ where: { relayChannelId: channel }, orderBy: { userId: "asc" } });
const resources = () => [platformRelayChannelArn(channel), platformRelayChannelArn(other)];
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
  prefix = "channel-copy-" + randomUUID();
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
describe("native single and batch channel duplication", () => {
  it("copies configurations and SQL-only credentials in caller order without provider/ownership relations", async () => {
    const broad = vi.spyOn(RelayConfigService.getInstance(), "getRelayConfig"),
      rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById"),
      beforeProviders = await providers();
    const result = await apply();
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toContain(prefix);
    expect(result[1]!.name).toContain(prefix + "other");
    expect(result.every((row) => row.id !== channel && row.id !== other)).toBe(true);
    const rows = await prisma.relayChannel.findMany({ where: { id: { in: result.map((row) => row.id) } } });
    expect(rows.find((row) => row.id === result[0]!.id)).toMatchObject({
      openaiUpstreamApiKey: "fixture-secret-review",
      providerServiceEnabled: true,
      status: 1,
      submittedByUserId: null,
      submissionStatus: "approved",
    });
    expect(rows.find((row) => row.id === result[1]!.id)).toMatchObject({
      openaiUpstreamApiKey: "fixture-secret-other",
    });
    expect(
      await prisma.relayChannelProvider.count({ where: { relayChannelId: { in: result.map((row) => row.id) } } }),
    ).toBe(0);
    expect(await providers()).toEqual(beforeProviders);
    expect(JSON.stringify(result)).not.toMatch(/fixture-secret|openaiUpstreamApiKey/);
    expect(broad).not.toHaveBeenCalled();
    expect(rich).not.toHaveBeenCalled();
  });
  it("copies only registered JSON configuration fields instead of unknown nested credential-like data", async () => {
    await prisma.relayChannel.update({
      where: { id: channel },
      data: {
        routingConfig: { maxRetries: 3, privateLegacyData: { openaiUpstreamApiKey: "fixture-private-json-secret" } },
        contextLengthMultipliers: [
          { name: "base", enabled: true, minTokens: 0, multiplier: 1, privateToken: "fixture-private-json-token" },
        ],
      },
    });
    const result = await single();
    expect(result.routingConfig).toMatchObject({ maxRetries: 3 });
    expect(JSON.stringify(result)).not.toMatch(/fixture-private-json|privateLegacyData|privateToken/);
    const after = await prisma.relayChannel.findUniqueOrThrow({ where: { id: result.id } });
    expect(JSON.stringify(after.routingConfig)).not.toContain("privateLegacyData");
    expect(JSON.stringify(after.contextLengthMultipliers)).not.toContain("privateToken");
  });
  it("keeps the batch audit operation even when exactly one source is selected", async () => {
    expect(await apply([channel])).toHaveLength(1);
    expect(BusinessLogService.getInstance().logOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operationType: OperationType.RELAY_CHANNEL_BATCH_DUPLICATE }),
      expect.objectContaining({ businessLog: expect.objectContaining({ create: expect.any(Function) }) }),
    );
  });
  it("supports an explicitly named single copy", async () => {
    const result = await single({ name: prefix + "named" });
    expect(result.name).toBe(prefix + "named");
    expect(result.id).not.toBe(channel);
  });
  it("does not retrieve plaintext credentials through any Prisma select", async () => {
    const selects: unknown[] = [];
    transactionHook((tx) => {
      for (const method of ["findMany", "findUnique", "findFirst"] as const) {
        const original = tx.relayChannel[method].bind(tx.relayChannel) as unknown as (
          args: unknown,
        ) => Promise<unknown>;
        vi.spyOn(tx.relayChannel, method).mockImplementation((async (args: { select?: unknown; include?: unknown }) => {
          selects.push(args);
          return original(args);
        }) as never);
      }
    });
    await single();
    expect(selects.length).toBeGreaterThan(0);
    for (const selection of selects) {
      expect(selection).toHaveProperty("select");
      expect(selection).not.toHaveProperty("include");
      expect(JSON.stringify(selection)).not.toMatch(/UpstreamApiKey/);
    }
  });
  it("copies pooled legacy edges with configuration but without cloning its members", async () => {
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { channelType: "pooled", openaiUpstreamUrl: null, openaiUpstreamApiKey: null },
    });
    await prisma.relayChannelMember.create({
      data: { relayChannelId: channel, memberChannelId: other, priority: 3, weight: 2, enabled: false },
    });
    const result = await single();
    expect(
      await prisma.relayChannelMember.findMany({
        where: { relayChannelId: result.id },
        select: { memberChannelId: true, priority: true, weight: true, enabled: true },
      }),
    ).toMatchObject([{ memberChannelId: other, priority: 3, enabled: false }]);
    expect(await prisma.relayChannel.count({ where: { name: { startsWith: prefix } } })).toBe(3);
  });
  it("copies automatic pool edges and returns only authorized related capabilities", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "automatic-proxy-pool" } });
    await prisma.relayChannelMember.create({ data: { relayChannelId: channel, memberChannelId: other, priority: 0 } });
    const result = await single();
    expect(result.channelType).toBe("automatic-proxy-pool");
    expect(
      await prisma.relayChannelMember.count({ where: { relayChannelId: result.id, memberChannelId: other } }),
    ).toBe(1);
  });
  it("copies physical members under their original parent, not an unauthorized sibling or a newly copied parent", async () => {
    await prisma.relayChannel.update({ where: { id: other }, data: { channelType: "pooled" } });
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { channelType: "pooled-member", pooledParentId: other },
    });
    const sibling = await prisma.relayChannel.create({
      data: { name: prefix + "sibling", channelType: "pooled-member", pooledParentId: other },
    });
    await grant(platformRelayChannelArn(sibling.id));
    const result = await single();
    expect(result.channelType).toBe("pooled-member");
    expect(await prisma.relayChannel.findUnique({ where: { id: result.id } })).toMatchObject({
      pooledParentId: other,
      visibilityMode: "hidden",
    });
  });
  it("keeps strict logical pool children assigned to the original instead of silently moving them", async () => {
    await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "strict-two-tier" } });
    await prisma.relayChannel.update({ where: { id: other }, data: { channelType: "pooled" } });
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { channelType: "pooled-member", pooledParentId: other },
    });
    const result = await RelayChannelService.getInstance().duplicateChannel(other, {}, actor, request());
    expect(await prisma.relayChannel.count({ where: { pooledParentId: result.id } })).toBe(0);
    expect((await source()).pooledParentId).toBe(other);
  });
  it.each(["source", "destination"])("requires %s authority before rich configuration hydration", async (kind) => {
    const { req, role } = await roleRequest();
    if (kind === "destination") await grant(resources(), "Allow", "role", role.id);
    const before = await channels(),
      repo = RelayChannelDuplicateRepository.getInstance(),
      applySpy = vi.spyOn(repo, "apply");
    await expect(apply(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await channels()).toEqual(before);
    expect(applySpy).not.toHaveBeenCalled();
  });
  it("allows copying only a specific source without wildcard source authority", async () => {
    const { req, role } = await roleRequest();
    await grant(platformRelayChannelArn(channel), "Allow", "role", role.id);
    await grant("acs:platform:*:platform:relay-channel/*", "Allow", "role", role.id, undefined, destinationAction);
    expect((await single({}, req)).id).not.toBe(channel);
    await unchanged(() => apply([other], req));
  });
  it("destination creation authority alone cannot access any source", async () => {
    const { req, role } = await roleRequest();
    await grant("acs:platform:*:platform:relay-channel/*", "Allow", "role", role.id, undefined, destinationAction);
    await unchanged(() => single({}, req));
  });
  it("a destination capability Deny overrides otherwise permitted sources", async () => {
    await grant("*", "Deny", "user", actor, undefined, destinationAction);
    await unchanged(() => single());
  });
  // Two JSON-only role policies are rechecked throughout the transaction; keep a bounded I/O budget.
  it("JSON-only role grants on platform channel patterns allow sources and reserved destinations", async () => {
    const { req, role } = await roleRequest();
    await grant("acs:platform:*:platform:relay-channel/*", "Allow", "role", role.id);
    await grant("acs:platform:*:platform:relay-channel/*", "Allow", "role", role.id, undefined, destinationAction);
    expect(await apply(undefined, req)).toHaveLength(2);
  }, 15_000);
  it.each(["first", "last"])("Deny on the %s source cancels the entire batch", async (kind) => {
    await grant(platformRelayChannelArn(kind === "first" ? channel : other));
    await unchanged(() => apply());
  });
  it("rejects denied referenced members before reading source URLs or copying any key", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "pooled" } });
    await prisma.relayChannelMember.create({ data: { relayChannelId: channel, memberChannelId: other, priority: 0 } });
    await grant(platformRelayChannelArn(other));
    let copied = false;
    transactionHook((tx) => {
      vi.spyOn(tx, "$executeRaw").mockImplementation((async () => {
        copied = true;
        return 1;
      }) as never);
    });
    await unchanged(() => single());
    expect(copied).toBe(false);
  });
  it("rejects cycles without partial destinations", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "automatic-proxy-pool" } });
    await prisma.relayChannelMember.create({
      data: { relayChannelId: channel, memberChannelId: channel, priority: 0 },
    });
    await unchanged(() => single(), 400);
  });
  it("rejects physical channels as direct automatic-pool members", async () => {
    const parent = await prisma.relayChannel.create({ data: { name: prefix + "parent", channelType: "pooled" } });
    await prisma.relayChannel.update({
      where: { id: other },
      data: { channelType: "pooled-member", pooledParentId: parent.id },
    });
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "automatic-proxy-pool" } });
    await prisma.relayChannelMember.create({ data: { relayChannelId: channel, memberChannelId: other, priority: 0 } });
    await unchanged(() => single(), 400);
  });
  it("rejects a name collision without altering the source", async () => {
    await unchanged(() => single({ name: prefix + "other" }), 409);
  });
  it.each(["missing", "deleted", "alias"])("refuses %s sources without partial copies", async (kind) => {
    const ids = [channel, other];
    if (kind === "deleted") await prisma.relayChannel.update({ where: { id: other }, data: { status: 0 } });
    else ids[1] = kind === "missing" ? "missing" : other.toUpperCase();
    await unchanged(() => apply(ids));
  });
  it.each(["duplicate", "empty", "wildcard"])("rejects %s source batches", async (kind) => {
    await unchanged(() => apply(kind === "empty" ? [] : kind === "duplicate" ? [channel, channel] : ["*"]), 400);
  });
  it.each(["missing", "owner", "subject", "oauth"])("rejects %s identity context", async (kind) => {
    const req = request();
    if (kind === "missing") delete req.authContext;
    else if (kind === "owner") req.authContext!.accountOwnerId = peer;
    else if (kind === "subject") req.authContext!.principalUserId = peer;
    else req.oauthAccessToken = {} as TypedRequest["oauthAccessToken"];
    await unchanged(() => apply(undefined, req));
  });
  it("requires native request context", async () => {
    await unchanged(() => RelayChannelService.getInstance().duplicateChannel(channel, {}, actor));
  });
  it.each(["owned-group", "adds-only"])("%s cannot create platform copy eligibility", async (kind) => {
    await grant("*", "Allow");
    if (kind === "owned-group") await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    else {
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RELAY_CHANNEL_CREATE] } });
    }
    await unchanged(() => apply());
  });
  it("rechecks after awaited audit and rolls back all destinations", async () => {
    vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockImplementation(async () => {
      env.security.iamAuthorizationMode = "legacy";
      return undefined as never;
    });
    await unchanged(() => apply());
  });
  it.each([
    "mode",
    "identity",
    "key",
    "session",
    "catalog",
    "source",
    "response",
    "group",
    "topology",
    "condition",
    "ownership",
  ])("rolls back all copied rows after late %s change", async (kind) => {
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
      await grant(
        "acs:platform:*:platform:relay-channel/*",
        "Allow",
        "role",
        assumed.role.id,
        undefined,
        destinationAction,
      );
    }
    if (kind === "condition")
      await grant("*", "Deny", "user", actor, { IpAddress: { "acs:SourceIp": "192.0.2.0/24" } });
    transactionHook((tx) => {
      const original = tx.relayChannel.create.bind(tx.relayChannel);
      let changed = false;
      vi.spyOn(tx.relayChannel, "create").mockImplementation((async (args: Prisma.RelayChannelCreateArgs) => {
        const result = await original(args);
        if (changed) return result;
        changed = true;
        if (kind === "mode") env.security.iamAuthorizationMode = "legacy";
        else if (kind === "identity") req.authContext!.accountOwnerId = peer;
        else if (kind === "condition") Object.defineProperty(req, "ip", { value: "192.0.2.1", configurable: true });
        else if (kind === "ownership")
          await tx.relayChannel.update({ where: { id: result.id }, data: { submittedByUserId: peer } });
        else if (kind === "key") await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
        else if (kind === "session") await tx.ramRoleSession.update({ where: { id: sessionId! }, data: { status: 0 } });
        else if (kind === "catalog")
          await tx.modelPricing.updateMany({ where: { model: prefix + "new" }, data: { status: 0 } });
        else if (kind === "source")
          await tx.relayChannel.update({ where: { id: channel }, data: { openaiUpstreamApiKey: "changed-fixture" } });
        else if (kind === "group") await tx.group.update({ where: { id: groupId }, data: { permissions: [] } });
        else if (kind === "topology")
          await tx.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "invalid" } });
        else await tx.relayChannel.update({ where: { id: result.id }, data: { multiplier: 3 } });
        return result;
      }) as never);
    });
    await unchanged(() => apply(undefined, req));
  });
  it("rolls back source and destination copies on a final explicit destination Deny", async () => {
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
        ? result.map((row, index) =>
            resources().includes(input.resources[index]!)
              ? row
              : { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] },
          )
        : result;
    });
    await unchanged(() => apply());
    expect(written).toBe(true);
  });
  it.each([false, true])(
    "evaluates trusted source IP (allowed=%s) without trusting Action headers",
    async (allowed) => {
      const { req, role } = await roleRequest();
      await grant("acs:platform:*:platform:relay-channel/*", "Allow", "role", role.id, {
        IpAddress: { "acs:SourceIp": "192.0.2.0/24" },
      });
      await grant(
        "acs:platform:*:platform:relay-channel/*",
        "Allow",
        "role",
        role.id,
        { IpAddress: { "acs:SourceIp": "192.0.2.0/24" } },
        destinationAction,
      );
      if (allowed) {
        Object.defineProperty(req, "ip", { value: "192.0.2.1" });
        expect(await apply(undefined, req)).toHaveLength(2);
      } else await unchanged(() => apply(undefined, req));
    },
    15_000,
  );
  it.each(["legacy", "shadow"] as const)("%s invokes the original copy write once per source", async (variant) => {
    env.security.iamAuthorizationMode = variant;
    const create = vi.spyOn(RelayChannelRepository.getInstance(), "create");
    expect(await apply()).toHaveLength(2);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it("rejects a longer alternate DAG path before configuration/catalog hydration", async () => {
    await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "legacy" } });
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "pooled" } });
    const depth = RELAY_CAPABILITY_RESOLUTION_LIMITS.poolDepth / 2,
      tail = Array.from({ length: depth + 1 }, () => "a" + randomUUID()),
      lead = Array.from({ length: depth }, () => "z" + randomUUID());
    await prisma.relayChannel.createMany({
      data: [...tail, ...lead].map((id) => ({
        id,
        name: prefix + id,
        channelType: "pooled",
        visibilityMode: "hidden",
      })),
    });
    await prisma.relayChannelMember.createMany({
      data: [
        ...tail
          .slice(0, -1)
          .map((id, index) => ({ relayChannelId: id, memberChannelId: tail[index + 1]!, priority: 0 })),
        ...lead.map((id, index) => ({ relayChannelId: id, memberChannelId: lead[index + 1] ?? tail[0]!, priority: 0 })),
        { relayChannelId: channel, memberChannelId: tail[0]!, priority: 0 },
        { relayChannelId: channel, memberChannelId: lead[0]!, priority: 1 },
      ],
    });
    let pricingRead = false;
    transactionHook((tx) => {
      const original = tx.modelPricing.findMany.bind(tx.modelPricing);
      vi.spyOn(tx.modelPricing, "findMany").mockImplementation((async (args: Prisma.ModelPricingFindManyArgs) => {
        pricingRead = true;
        return original(args);
      }) as never);
    });
    await unchanged(() => single(), 400);
    expect(pricingRead).toBe(false);
  }, 30000);
  it("does not traverse an unrelated legacy edge of a physical member's parent proof", async () => {
    await prisma.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "legacy" } });
    await prisma.relayChannel.update({ where: { id: other }, data: { channelType: "pooled" } });
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { channelType: "pooled-member", pooledParentId: other },
    });
    const unrelated = await prisma.relayChannel.create({ data: { name: prefix + "unrelated" } });
    await prisma.relayChannelMember.create({
      data: { relayChannelId: other, memberChannelId: unrelated.id, priority: 0 },
    });
    await grant(platformRelayChannelArn(unrelated.id));
    const result = await single();
    expect(result.channelType).toBe("pooled-member");
    expect(await prisma.relayChannel.findUnique({ where: { id: result.id } })).toMatchObject({ pooledParentId: other });
  });
  it("shares one authorized response graph for a supported 200-target batch", async () => {
    const inputs = Array.from({ length: 200 }, (_, index) => ({
      id: randomUUID(),
      name: prefix + "batch-" + index,
      visibilityMode: "hidden",
      openaiUpstreamUrl: "https://fixture.invalid/batch",
      openaiUpstreamApiKey: "fixture-batch-credential",
      allowedFormats: "openai-chat-completions",
      allowedModels: JSON.stringify([prefix + "model"]),
    }));
    await prisma.relayChannel.createMany({ data: inputs });
    const ids = inputs.map((row) => row.id).reverse();
    let scans = 0;
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
          scans++;
        return original(input as never);
      }) as never);
    });
    const result = await apply(ids);
    expect(result).toHaveLength(ids.length);
    expect(result.map((row) => row.name.split("（副本")[0])).toEqual([...inputs].reverse().map((row) => row.name));
    expect(JSON.stringify(result)).not.toContain("fixture-batch-credential");
    expect(scans).toBeGreaterThan(0);
    expect(scans).toBeLessThan(12);
  }, 60000);
});
