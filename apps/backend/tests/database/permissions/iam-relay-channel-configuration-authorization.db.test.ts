import { RelayChannelConfigurationReadRepository } from "@/store/relay/relay-channel-configuration-read.repository";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:ListChannels",
  mode = env.security.iamAuthorizationMode;
let owner: string, actor: string, groupId: string, root: string, leaf: string, prefix: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const list = (req = request(), disabled = false) =>
  RelayChannelService.getInstance().listChannelConfigurations(actor, disabled, req);
const get = (id = root, req = request()) => RelayChannelService.getInstance().getChannelConfiguration(id, actor, req);
async function grant(
  resources: string[],
  Effect: "Allow" | "Deny" = "Deny",
  principal = { type: "user", id: actor },
  Action = action,
) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect, Action, Resource: resources } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: prefix + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: principal.type,
      principalId: principal.id,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "configuration-iam-" + randomUUID();
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
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  groupId = (
    await prisma.group.create({
      data: { name: prefix, username: prefix, accountOwnerId: null, permissions: [Permission.RELAY_CHANNEL_READ] },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  root = (
    await prisma.relayChannel.create({
      data: { name: prefix + "root", channelType: "pooled", openaiUpstreamApiKey: "fixture-secret" },
    })
  ).id;
  leaf = (
    await prisma.relayChannel.create({
      data: { name: prefix + "leaf", channelType: "pooled-member", pooledParentId: root },
    })
  ).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
});
describe("native channel configuration authorization", () => {
  it("serves list/detail from safe repositories without legacy credential, graph or pricing reads", async () => {
    const richList = vi.spyOn(RelayChannelRepository.getInstance(), "listActive"),
      richGet = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById");
    expect(await list()).toHaveLength(2);
    expect(await get()).toMatchObject({ id: root, hasOpenaiUpstreamApiKey: true });
    expect(richList).not.toHaveBeenCalled();
    expect(richGet).not.toHaveBeenCalled();
  });
  it("does not expose context-free legacy callbacks as an enforced read fallback", async () => {
    await expect(RelayChannelService.getInstance().listChannels(actor)).rejects.toMatchObject({ statusCode: 403 });
    await expect(RelayChannelService.getInstance().getChannel(root, actor)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps the existing probe legacy callback valid in shadow without requiring the new configuration Action", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await grant(["*"], "Deny");
    expect(await RelayChannelService.getInstance().listChannels(actor, true)).toHaveLength(2);
    expect(await RelayChannelService.getInstance().getChannel(root, actor)).toMatchObject({ id: root });
  });
  it("independently authorizes list and get on each exact platform resource", async () => {
    await grant([platformRelayChannelArn(leaf)]);
    expect((await list()).map((row) => row.id)).toEqual([root]);
    expect(await get(leaf)).toMatchObject({ id: leaf });
    await grant([platformRelayChannelArn(root)], "Deny", { type: "user", id: actor }, "quyan:relay:GetChannel");
    await expect(get()).rejects.toMatchObject({ statusCode: 403 });
    expect((await list()).map((row) => row.id)).toEqual([root]);
  });
  it("does not turn client Action or account inputs into authority", async () => {
    await grant([platformRelayChannelArn(root)]);
    const req = request();
    req.headers["x-action"] = "quyan:relay:GetChannel";
    req.query = { action: "*", accountId: owner };
    expect((await list(req)).map((row) => row.id)).toEqual([leaf]);
    expect(req.iamDecisions?.every((row) => row.action === action)).toBe(true);
  });
  it("admits JSON-only exact resource policies but never manufactures a global qualification", async () => {
    await grant([platformRelayChannelArn(root)], "Allow");
    const iam = IamAuthorizationService.getInstance(),
      original = iam.loadPolicies.bind(iam);
    vi.spyOn(iam, "loadPolicies").mockImplementation(async (p) =>
      (await original(p)).filter((row) => !row.policyId.startsWith("legacy:")),
    );
    expect((await list()).map((row) => row.id)).toEqual([root]);
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["none", "disabled"])("rejects missing deployment ceiling: %s", async (kind) => {
    await grant(["*"], "Allow");
    if (kind === "none")
      await prisma.user.update({
        where: { id: actor },
        data: { groupId: null, permissionAdds: [Permission.RELAY_CHANNEL_READ] },
      });
    if (kind === "disabled") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("accepts either persisted READ or REVIEW eligibility", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [Permission.RELAY_CHANNEL_REVIEW] } });
    expect(await list()).toHaveLength(2);
    expect(await get()).toMatchObject({ id: root });
  });
  it("retains explicit legacy permission removals despite an independent Allow", async () => {
    await grant(["*"], "Allow");
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.RELAY_CHANNEL_READ] } });
    expect(await list()).toEqual([]);
    await expect(get()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("does not duplicate existing business reads in %s", async (selected) => {
    env.security.iamAuthorizationMode = "legacy";
    await grant(["*"], "Deny");
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "listActive");
    expect(await list()).toHaveLength(2);
    const legacyReads = rich.mock.calls.length;
    rich.mockClear();
    env.security.iamAuthorizationMode = selected;
    const native = vi.spyOn(RelayChannelConfigurationReadRepository.getInstance(), "read");
    expect(await list()).toHaveLength(2);
    expect(rich).toHaveBeenCalledTimes(legacyReads);
    expect(native).toHaveBeenCalledTimes(selected === "shadow" ? 1 : 0);
    for (const call of native.mock.calls) expect(call[4]).toBeUndefined();
  });
  it("rejects missing, foreign and changed request principals", async () => {
    await expect(RelayChannelService.getInstance().listChannelConfigurations(actor)).rejects.toMatchObject({
      statusCode: 403,
    });
    const req = request();
    req.authContext!.principalUserId = owner;
    await expect(list(req)).rejects.toMatchObject({ statusCode: 403 });
    const iam = IamAuthorizationService.getInstance(),
      original = iam.loadPolicies.bind(iam),
      mutable = request();
    vi.spyOn(iam, "loadPolicies").mockImplementation(async (p) => {
      const result = await original(p);
      mutable.authContext!.accountOwnerId = "foreign";
      return result;
    });
    await expect(list(mutable)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects AccessKey disappearance or revocation before returning data", async () => {
    const req = request();
    req.accessKey = { id: "missing-key" } as NonNullable<TypedRequest["accessKey"]>;
    await expect(list(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not enable OAuth on the historically unscoped get endpoint", async () => {
    const req = request();
    req.oauthAccessToken = { id: "oauth", oauthClientId: "client", userId: actor } as NonNullable<
      TypedRequest["oauthAccessToken"]
    >;
    await expect(get(root, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(list(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a stale role session rather than falling back to direct user policies", async () => {
    const req = request();
    req.authContext!.assumedRoleId = "role";
    req.authContext!.roleSessionId = "session";
    await expect(list(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not expose denied or nonexistent single-channel existence", async () => {
    await grant([platformRelayChannelArn(root)], "Deny", { type: "user", id: actor }, "quyan:relay:GetChannel");
    for (const id of [root, "missing"])
      await expect(get(id)).rejects.toMatchObject({ statusCode: 403, messageKey: "permission.insufficientPermission" });
  });
  it("fails closed on unknown modes and policy loading errors", async () => {
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockRejectedValue(new Error("fixture-unavailable"));
    await expect(list()).rejects.toThrow("fixture-unavailable");
    (env.security as { iamAuthorizationMode: string }).iamAuthorizationMode = "unknown";
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not merge user privileges into role sessions and rejects revoked sessions", async () => {
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
    const req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    expect(await list(req)).toEqual([]);
    await grant(["*"], "Allow", { type: "role", id: role.id });
    expect(await list(req)).toHaveLength(2);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(list(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("preserves OAuth READ admission and rechecks live scopes before returning", async () => {
    const client = await prisma.oAuthClient.create({
      data: {
        userId: actor,
        clientId: prefix + randomUUID(),
        name: prefix,
        clientSecretHash: "fixture-hash",
        grantTypes: ["authorization_code"],
        redirectUris: [],
        scopes: [Permission.RELAY_CHANNEL_READ],
        reviewStatus: "approved",
      },
    });
    const token = await prisma.oAuthAccessToken.create({
      data: {
        userId: actor,
        oauthClientId: client.id,
        tokenHash: randomUUID(),
        scopes: [Permission.RELAY_CHANNEL_READ],
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    req.oauthAccessToken = {
      id: token.id,
      oauthClientId: client.id,
      userId: actor,
      scopes: [Permission.RELAY_CHANNEL_READ],
    } as NonNullable<TypedRequest["oauthAccessToken"]>;
    expect(await list(req)).toHaveLength(2);
    const repository = RelayChannelConfigurationReadRepository.getInstance(),
      original = repository.read.bind(repository);
    vi.spyOn(repository, "read").mockImplementation(async (...args) => {
      const result = await original(...args);
      await prisma.oAuthClient.update({ where: { id: client.id }, data: { scopes: [] } });
      return result;
    });
    await expect(list(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["key", "policy", "group", "principal"])("rejects late %s changes after native reads", async (kind) => {
    const repository = RelayChannelConfigurationReadRepository.getInstance(),
      original = repository.read.bind(repository),
      req = request();
    if (kind === "key") {
      const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
      req.accessKey = { id: key.id } as NonNullable<TypedRequest["accessKey"]>;
      req.authContext!.subjectType = "access_key";
    }
    vi.spyOn(repository, "read").mockImplementation(async (...args) => {
      const result = await original(...args);
      if (kind === "key") await prisma.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
      if (kind === "policy") await grant([platformRelayChannelArn(root)]);
      if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      if (kind === "principal") req.authContext!.principalUserId = owner;
      return result;
    });
    await expect(list(req)).rejects.toMatchObject({ statusCode: 403 });
  });
});
