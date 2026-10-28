import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, type IamCondition } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelCatalogIamService } from "@/services/relay/relay-channel-catalog-iam.service";
import { RelayChannelCatalogReadRepository } from "@/store/relay/relay-channel-catalog-read.repository";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { RelayPoolResolverService } from "@/services/relay/relay-pool-resolver.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { relayChannelSelectionArn } from "@/iam/resources/relay-channel-selection-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import type { TypedRequest } from "@/types/express";
const initialMode = env.security.iamAuthorizationMode,
  action = "quyan:relay:ListChannelRoutingCatalog",
  localPreview = "quyan:relay:PreviewChannelRoutingCatalog",
  managedPreview = "quyan:relay:PreviewManagedChannelRoutingCatalog";
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
const arn = (id: string) => relayChannelSelectionArn(owner, id),
  userArn = (id: string) => `acs:quyan:*:${owner}:user/${id}`;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    secure: true,
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const invoke = (targetUserId?: string, req = request()) =>
  RelayChannelService.getInstance().listRoutingCatalogOptions(actor, targetUserId, req);
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
        permissions: [Permission.RELAY_TOKEN_MANAGE_OTHERS_READ],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
}
function afterRead(callback: () => Promise<void> | void) {
  const repository = RelayChannelCatalogReadRepository.getInstance(),
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
  prefix = "routing-catalog-" + randomUUID();
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
describe("native actor-authorized routing catalog", () => {
  it("retains logical member controls and branch-correlated capabilities without full channel reads", async () => {
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "listActive"),
      preload = vi.spyOn(RelayPoolResolverService.getInstance(), "preloadContext");
    const result = await invoke();
    expect(result).toHaveLength(3);
    const automatic = result.find((row) => row.id === root)!;
    expect(automatic.automaticProxyPool).toMatchObject({
      routingStrategy: "health-priority",
      routingConfig: { maxRetries: 3, stickyByModel: true },
      members: [
        {
          id: first,
          multiplier: 2,
          modelCapabilities: [
            {
              catalogModelName: prefix + "one",
              requestModelId: prefix + "request-one",
              supportedRequestFormats: ["openai-chat-completions"],
            },
          ],
        },
        {
          id: second,
          multiplier: 7,
          modelCapabilities: [
            {
              catalogModelName: prefix + "two",
              requestModelId: prefix + "request-two",
              supportedRequestFormats: ["anthropic"],
            },
          ],
        },
      ],
    });
    expect(automatic.modelCapabilities).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(
      /fixture-only-secret|fixture.invalid|private-routing|manualAvailability|allowedModelsMode|visibilityConfig|modelMapping|providers/,
    );
    expect(rich).not.toHaveBeenCalled();
    expect(preload).not.toHaveBeenCalled();
  });
  it("excludes a denied logical member instead of leaking it through root metadata", async () => {
    await policy(action, arn(first), "Deny");
    const result = await invoke();
    expect(result.map((row) => row.id)).not.toContain(first);
    expect(result.find((row) => row.id === root)!.automaticProxyPool!.members.map((row) => row.id)).toEqual([second]);
    expect(result.find((row) => row.id === root)!.modelCapabilities.map((row) => row.catalogModelName)).toEqual([
      prefix + "two",
    ]);
  });
  it("denying the shared physical leaf removes both paths' capabilities", async () => {
    await policy(action, arn(leaf), "Deny");
    const result = await invoke();
    expect(result.every((row) => row.modelCapabilities.length === 0)).toBe(true);
    expect(
      result
        .find((row) => row.id === root)!
        .automaticProxyPool!.members.every((row) => row.modelCapabilities.length === 0),
    ).toBe(true);
  });
  it("honors visibility and disabled edges independently of root Allow", async () => {
    await prisma.relayChannel.update({ where: { id: first }, data: { visibilityMode: "hidden" } });
    await prisma.relayChannelMember.updateMany({
      where: { relayChannelId: root, memberChannelId: second },
      data: { enabled: false },
    });
    const automatic = (await invoke()).find((row) => row.id === root)!;
    expect(automatic.automaticProxyPool!.members).toEqual([]);
    expect(automatic.modelCapabilities).toEqual([]);
  });
  it("does not require preview authority when omitted, blank, or explicitly self", async () => {
    for (const targetId of [undefined, " ", actor]) expect(await invoke(targetId)).toHaveLength(3);
  });
  it("requires an explicit account-local target grant even when channel views are allowed", async () => {
    const read = vi.spyOn(RelayChannelCatalogReadRepository.getInstance(), "read");
    await expect(invoke(target)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("supports account-local delegated preview without deployment management privileges", async () => {
    await policy(localPreview, userArn(target));
    const req = request(),
      load = vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies");
    expect(await invoke(target, req)).toHaveLength(3);
    expect(
      load.mock.calls.every(([principal]) => principal.subjectUserId === actor && principal.accountOwnerId === owner),
    ).toBe(true);
    expect(req.iamDecisions!.some((row) => row.action === localPreview && row.resource === userArn(target))).toBe(true);
    expect(
      req
        .iamDecisions!.filter((row) => row.action === action)
        .every((row) => row.resource!.includes(`:${owner}:channel-selection/`)),
    ).toBe(true);
  });
  it("never substitutes the target's policies for the actor's channel Allow", async () => {
    await policy(localPreview, userArn(target));
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
    await policy(action, "*", "Allow", target);
    expect(await invoke(target)).toEqual([]);
  });
  it("target Deny does not grant or revoke the actor's independently authorized inspection", async () => {
    await policy(localPreview, userArn(target));
    await policy(action, "*", "Deny", target);
    expect(await invoke(target)).toHaveLength(3);
    await policy(action, arn(first), "Deny");
    expect((await invoke(target)).map((row) => row.id)).not.toContain(first);
  });
  it("intersects actor and target whitelist visibility without impersonating either", async () => {
    await policy(localPreview, userArn(target));
    await prisma.relayChannel.update({
      where: { id: first },
      data: { visibilityMode: "whitelist", visibilityConfig: { userIds: [target] } },
    });
    let result = await invoke(target);
    expect(result.map((row) => row.id)).not.toContain(first);
    await prisma.relayChannel.update({
      where: { id: first },
      data: { visibilityConfig: { userIds: [actor, target] } },
    });
    result = await invoke(target);
    expect(result.map((row) => row.id)).toContain(first);
    await prisma.relayChannel.update({ where: { id: first }, data: { visibilityConfig: { userIds: [actor] } } });
    result = await invoke(target);
    expect(result.map((row) => row.id)).not.toContain(first);
  });
  it("uses target role bindings only for visibility and rechecks membership changes", async () => {
    await policy(localPreview, userArn(target));
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: prefix } });
    const binding = await prisma.ramUserRoleBinding.create({
      data: { accountOwnerId: owner, roleId: role.id, userId: target },
    });
    await prisma.relayChannel.update({
      where: { id: first },
      data: { visibilityMode: "whitelist", visibilityConfig: { userIds: [actor], roleIds: [role.id] } },
    });
    expect((await invoke(target)).map((row) => row.id)).toContain(first);
    afterRead(async () => {
      await prisma.ramUserRoleBinding.update({ where: { id: binding.id }, data: { status: 0 } });
    });
    await expect(invoke(target)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not use platform preview as a fallback for a denied local preview", async () => {
    await platformManager();
    await policy(localPreview, userArn(target), "Deny");
    await policy(managedPreview, "*");
    await expect(invoke(target)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("platform preview additionally requires deployment-managed eligibility", async () => {
    await policy(managedPreview, "*");
    await expect(invoke(foreign)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.RELAY_TOKEN_READ, Permission.RELAY_TOKEN_MANAGE_OTHERS_READ] },
    });
    await expect(invoke(foreign)).rejects.toMatchObject({ statusCode: 403 });
    await platformManager();
    expect(await invoke(foreign)).toHaveLength(3);
  });
  it("a managed target's Deny covers only that selected target, with no alternative ARN fallback", async () => {
    await platformManager();
    await policy(managedPreview, platformUserArn(foreign), "Deny");
    await expect(invoke(foreign)).rejects.toMatchObject({ statusCode: 403 });
    expect(await invoke(foreignOwner)).toHaveLength(3);
  });
  it("managed preview never bypasses the actor's channel resource Deny", async () => {
    await platformManager();
    await policy(action, arn(first), "Deny");
    expect((await invoke(foreign)).map((row) => row.id)).not.toContain(first);
  });
  it.each(["target", "target-owner", "target-group", "group", "policy"])(
    "withholds projection after late %s drift",
    async (kind) => {
      await platformManager();
      afterRead(async () => {
        if (kind === "target") await prisma.user.update({ where: { id: foreign }, data: { status: 0 } });
        if (kind === "target-owner") await prisma.user.update({ where: { id: foreignOwner }, data: { status: 0 } });
        if (kind === "target-group") await prisma.user.update({ where: { id: foreign }, data: { groupId } });
        if (kind === "group") await prisma.group.update({ where: { id: groupId! }, data: { permissions: [] } });
        if (kind === "policy") await policy(managedPreview, platformUserArn(foreign), "Deny");
      });
      await expect(invoke(foreign)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("withholds a preview if the trusted account boundary changes after metadata capture", async () => {
    await policy(localPreview, userArn(target));
    afterRead(async () => {
      await prisma.user.update({
        where: { id: target },
        data: { accountOwnerId: foreignOwner, parentUserId: foreignOwner },
      });
    });
    await expect(invoke(target)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["missing", "case-alias", "invalid", "disabled"])("fails safely for %s target identity", async (kind) => {
    await platformManager();
    let id = foreign;
    if (kind === "missing") id = "missing-id";
    if (kind === "case-alias") id = foreign.toUpperCase();
    if (kind === "invalid") id = "bad/id";
    if (kind === "disabled") await prisma.user.update({ where: { id: foreign }, data: { status: 0 } });
    await expect(invoke(id)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("local preview does not confer platform channel management or token-selection rights", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
    await policy(action, "*");
    await policy(localPreview, userArn(target));
    expect(await invoke(target)).toHaveLength(3);
    const principal = {
      subjectUserId: actor,
      principalUserId: actor,
      accountOwnerId: owner,
      subjectType: "sub_user" as const,
    };
    expect(
      (
        await IamAuthorizationService.getInstance().authorize({
          principal,
          action: "quyan:relay:SelectTokenChannel",
          resource: arn(root),
        })
      ).decision,
    ).toBe("ImplicitDeny");
  });
  it("validates role sessions for local delegated preview and rejects revoked sessions", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: prefix } }),
      session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: owner,
          roleId: role.id,
          subjectUserId: actor,
          sessionName: "fixture",
          expiresAt: new Date(Date.now() + 60000),
        },
      });
    await policy(action, "*", "Allow", role.id, "role");
    await policy(localPreview, userArn(target), "Allow", role.id, "role");
    const req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    expect(await invoke(target, req)).toHaveLength(3);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(invoke(target, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["oauth", "key"])("rechecks %s revocation after a routing read", async (kind) => {
    const req = request();
    let revoke: () => Promise<unknown>;
    if (kind === "key") {
      const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
      req.accessKey = { id: key.id } as NonNullable<TypedRequest["accessKey"]>;
      req.authContext!.subjectType = "access_key";
      revoke = () => prisma.accessKey.update({ where: { id: key.id }, data: { status: 0 } });
    } else {
      const client = await prisma.oAuthClient.create({
        data: {
          userId: actor,
          clientId: prefix,
          name: prefix,
          clientSecretHash: "fixture-only",
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
      req.oauthAccessToken = {
        id: token.id,
        oauthClientId: client.id,
        userId: actor,
        scopes: [Permission.RELAY_CHANNEL_READ],
      } as NonNullable<TypedRequest["oauthAccessToken"]>;
      revoke = () => prisma.oAuthAccessToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    }
    expect(await invoke(undefined, req)).toHaveLength(3);
    afterRead(async () => {
      await revoke();
    });
    await expect(invoke(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses trusted transport and fixed Actions for target preview Conditions", async () => {
    await policy(localPreview, userArn(target), "Allow", actor, "user", { IpAddress: { "acs:SourceIp": "127.0.0.1" } });
    const req = request();
    req.headers["x-action"] = managedPreview;
    req.query = { accountId: foreignOwner };
    expect(await invoke(target, req)).toHaveLength(3);
    Object.defineProperty(req, "ip", { value: "192.0.2.1" });
    await expect(invoke(target, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shadow only observes native admission and invokes legacy once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await policy(action, "*", "Deny");
    const legacy = vi.fn(async () => []),
      preload = vi.spyOn(RelayPoolResolverService.getInstance(), "resolveChannelCapabilities");
    expect(await RelayChannelCatalogIamService.getInstance().readRouting(actor, undefined, request(), legacy)).toEqual(
      [],
    );
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(preload).not.toHaveBeenCalled();
  });
  it("never starts native reads in legacy and requires a request outside legacy", async () => {
    await expect(RelayChannelService.getInstance().listRoutingCatalogOptions(actor)).rejects.toMatchObject({
      statusCode: 403,
    });
    env.security.iamAuthorizationMode = "legacy";
    const legacy = vi.fn(async () => []),
      read = vi.spyOn(RelayChannelCatalogReadRepository.getInstance(), "read");
    expect(await RelayChannelCatalogIamService.getInstance().readRouting(actor, undefined, request(), legacy)).toEqual(
      [],
    );
    expect(read).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledTimes(1);
  });
});
