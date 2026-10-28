import { MonthlyPassService } from "@/services/billing/monthly-pass.service";
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
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { relayChannelSelectionArn } from "@/iam/resources/relay-channel-selection-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import type { TypedRequest } from "@/types/express";
const initialMode = env.security.iamAuthorizationMode,
  action = "quyan:relay:ListChannelOptions",
  localPreview = "quyan:relay:PreviewChannelOptions",
  managedPreview = "quyan:relay:PreviewManagedChannelOptions";
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
  RelayChannelService.getInstance().listChannelOptions(actor, targetUserId, {}, req);
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
  prefix = "channel-options-" + randomUUID();
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
const metadataAction = "quyan:relay:ReadChannelOptionPoolMetadata";
describe("native channel options and monthly pass integration", () => {
  it("reads only admitted safe sources without global preload or pool metadata by default", async () => {
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "listActive"),
      preload = vi.spyOn(RelayPoolResolverService.getInstance(), "preloadContext");
    const result = await invoke();
    expect(result.map((row) => row.id).sort()).toEqual([root, first, second, leaf].sort());
    const automatic = result.find((row) => row.id === root)!;
    expect(automatic.modelCapabilities.map((row) => row.catalogModelName).sort()).toEqual([
      prefix + "one",
      prefix + "two",
    ]);
    for (const row of result) {
      expect(row).not.toHaveProperty("channelType");
      expect(row).not.toHaveProperty("automaticProxyPool");
      expect(row).not.toHaveProperty("poolPricing");
    }
    expect(JSON.stringify(result)).not.toMatch(
      /fixture-only-secret|fixture.invalid|private-routing|modelMapping|visibilityConfig/,
    );
    expect(rich).not.toHaveBeenCalled();
    expect(preload).not.toHaveBeenCalled();
  });
  it("requires both base and optional per-resource grants, preserving complete member paths", async () => {
    await policy(metadataAction, "*");
    const automatic = (await invoke()).find((row) => row.id === root)!;
    expect(automatic.channelType).toBe("automatic-proxy-pool");
    expect(automatic.automaticProxyPool!.routingConfig).toEqual({ maxRetries: 3, stickyByModel: true });
    expect(
      automatic.automaticProxyPool!.members.map((row) => [
        row.id,
        row.modelCapabilities.map((item) => item.catalogModelName),
      ]),
    ).toEqual([
      [first, [prefix + "one"]],
      [second, [prefix + "two"]],
    ]);
    expect(automatic.poolPricing!.members).toHaveLength(1);
    expect(automatic.poolPricing!.members[0]).toMatchObject({
      id: leaf,
      modelCapabilities: [
        {
          catalogModelName: prefix + "one",
          requestModelId: prefix + "request-one",
          supportedRequestFormats: ["openai-chat-completions"],
        },
        {
          catalogModelName: prefix + "two",
          requestModelId: prefix + "request-two",
          supportedRequestFormats: ["anthropic"],
        },
      ],
    });
    expect(JSON.stringify(automatic)).not.toMatch(
      /private-routing|manualAvailability|allowedModelsMode|fixture-only-secret/,
    );
    await policy(action, arn(second), "Deny");
    const filtered = (await invoke()).find((row) => row.id === root)!;
    expect(filtered.automaticProxyPool!.members.map((row) => row.id)).toEqual([first]);
    expect(filtered.modelCapabilities.map((row) => row.catalogModelName)).toEqual([prefix + "one"]);
    expect(filtered.poolPricing!.members[0]!.modelCapabilities.map((row) => row.catalogModelName)).toEqual([
      prefix + "one",
    ]);
  });
  it.each(["root", "first", "leaf"])(
    "honors optional metadata Deny on %s without removing basic capabilities",
    async (node) => {
      await policy(metadataAction, "*");
      const id = node === "root" ? root : node === "first" ? first : leaf;
      await policy(metadataAction, arn(id), "Deny");
      const result = await invoke(),
        automatic = result.find((row) => row.id === root)!;
      expect(automatic.modelCapabilities).toHaveLength(2);
      if (node === "root") {
        expect(automatic).not.toHaveProperty("channelType");
        expect(automatic).not.toHaveProperty("automaticProxyPool");
        expect(automatic).not.toHaveProperty("poolPricing");
      } else {
        expect(automatic.automaticProxyPool!.members.map((row) => row.id)).not.toContain(id);
        const names = automatic.poolPricing!.members.flatMap((row) =>
          row.modelCapabilities.map((item) => item.catalogModelName),
        );
        if (node === "first") expect(names).toEqual([prefix + "two"]);
        else expect(names).toEqual([]);
      }
    },
  );
  it("cannot use optional metadata grants to recover a denied base node", async () => {
    await policy(metadataAction, "*");
    await policy(action, arn(leaf), "Deny");
    const result = await invoke();
    expect(result.map((row) => row.id)).not.toContain(leaf);
    expect(result.find((row) => row.id === root)!.modelCapabilities).toEqual([]);
    expect(result.find((row) => row.id === root)!.poolPricing!.members).toEqual([]);
  });
  it("excludePooled removes only pooled options, not contributing branches", async () => {
    const result = await RelayChannelService.getInstance().listChannelOptions(
      actor,
      undefined,
      { excludePooled: true },
      request(),
    );
    expect(result.map((row) => row.id).sort()).toEqual([root, leaf].sort());
    expect(result.find((row) => row.id === root)!.modelCapabilities).toHaveLength(2);
  });
  it("uses JSON-only local preview without inheriting target IAM policies or global eligibility", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
    await policy(action, "*");
    await expect(invoke(target)).rejects.toMatchObject({ statusCode: 403 });
    await policy(localPreview, userArn(target));
    expect(await invoke(target)).toHaveLength(4);
    await policy(action, "*", "Deny", target);
    expect(await invoke(target)).toHaveLength(4);
    await policy(action, arn(leaf), "Deny");
    expect((await invoke(target)).find((row) => row.id === root)!.modelCapabilities).toEqual([]);
  });
  it("requires persisted deployment eligibility and a fixed managed preview grant", async () => {
    await policy(managedPreview, platformUserArn(foreign));
    await expect(invoke(foreign)).rejects.toMatchObject({ statusCode: 403 });
    await platformManager();
    expect(await invoke(foreign)).toHaveLength(4);
    await policy(managedPreview, platformUserArn(foreign), "Deny");
    await expect(invoke(foreign)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not use routing-catalog preview authority for options", async () => {
    await policy("quyan:relay:PreviewChannelRoutingCatalog", userArn(target));
    await expect(invoke(target)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("intersects actor and target visibility and rechecks target ownership", async () => {
    await policy(localPreview, userArn(target));
    await prisma.relayChannel.update({
      where: { id: first },
      data: { visibilityMode: "whitelist", visibilityConfig: { userIds: [target], groupIds: [], roleIds: [] } },
    });
    expect((await invoke(target)).map((row) => row.id)).not.toContain(first);
    afterRead(async () => {
      await prisma.user.update({ where: { id: target }, data: { accountOwnerId: foreignOwner } });
    });
    await expect(invoke(target)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks optional grants even after the projection has been prepared", async () => {
    await policy(metadataAction, "*");
    afterRead(async () => {
      await policy(metadataAction, arn(leaf), "Deny");
    });
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks time-based optional conditions at response release", async () => {
    const deadline = new Date(Date.now() + 10000);
    await policy(metadataAction, "*", "Allow", actor, "user", {
      DateLessThan: { "acs:CurrentTime": deadline.toISOString() },
    });
    afterRead(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(deadline.getTime() + 1));
    });
    try {
      await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      vi.useRealTimers();
    }
  });
  it("requires a real request in enforce and never falls back to rich legacy reads", async () => {
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "listActive");
    await expect(RelayChannelService.getInstance().listChannelOptions(actor)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(rich).not.toHaveBeenCalled();
  });
  it("shadow performs metadata admission only and invokes its compatibility read once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const legacy = vi.fn(async () => []),
      resolve = vi.spyOn(RelayPoolResolverService.getInstance(), "resolveChannelCapabilities");
    expect(
      await RelayChannelCatalogIamService.getInstance().readOptions(actor, undefined, false, request(), legacy),
    ).toEqual([]);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(resolve).not.toHaveBeenCalled();
  });
  it("legacy preserves requestless internal options callers", async () => {
    env.security.iamAuthorizationMode = "legacy";
    const legacy = vi.fn(async () => []),
      read = vi.spyOn(RelayChannelCatalogReadRepository.getInstance(), "read");
    expect(
      await RelayChannelCatalogIamService.getInstance().readOptions(actor, undefined, false, undefined, legacy),
    ).toEqual([]);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
  });
  it("forwards request context through the shadow monthly-filter compatibility callback", async () => {
    groupId = (
      await prisma.group.create({
        data: {
          username: prefix,
          name: prefix,
          accountOwnerId: null,
          permissions: [Permission.MONTHLY_PASS_TEMPLATE_READ],
        },
      })
    ).id;
    await prisma.user.update({ where: { id: actor }, data: { groupId } });
    env.security.iamAuthorizationMode = "shadow";
    const options = vi.spyOn(RelayChannelService.getInstance(), "listChannelOptions"),
      req = request();
    const result = await MonthlyPassService.getInstance().getFilterOptions(actor, req);
    expect(result.channels.some((channel) => channel.value === root)).toBe(true);
    expect(options).toHaveBeenCalledExactlyOnceWith(actor, undefined, {}, req);
  });
  it("forwards the real authenticated request during native monthly template create/update/publish", async () => {
    groupId = (
      await prisma.group.create({
        data: {
          username: prefix,
          name: prefix,
          accountOwnerId: null,
          permissions: [Permission.MONTHLY_PASS_TEMPLATE_WRITE],
        },
      })
    ).id;
    await prisma.user.update({ where: { id: actor }, data: { groupId } });
    const monthly = MonthlyPassService.getInstance(),
      req = request();
    let templateId: string | undefined;
    const options = vi.spyOn(RelayChannelService.getInstance(), "listChannelOptions");
    try {
      const created = await monthly.createTemplate(
        { name: prefix, defaultQuota: 10, allowedChannels: [root], allowedModels: [prefix + "one"] },
        actor,
        req,
      );
      templateId = created.id;
      await monthly.updateTemplate(templateId, { description: "fixture" }, actor, req);
      expect((await monthly.publishTemplate(templateId, actor, req)).publishStatus).toBe("published");
      expect(options).toHaveBeenCalledTimes(3);
      for (const call of options.mock.calls) expect(call).toEqual([actor, undefined, {}, req]);
      await policy(action, arn(root), "Deny");
      await expect(monthly.updateTemplate(templateId, { description: "denied" }, actor, req)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect((await prisma.monthlyPassTemplate.findUnique({ where: { id: templateId } }))!.description).toBe("fixture");
    } finally {
      if (templateId) await prisma.monthlyPassTemplate.delete({ where: { id: templateId } });
    }
  });
});
