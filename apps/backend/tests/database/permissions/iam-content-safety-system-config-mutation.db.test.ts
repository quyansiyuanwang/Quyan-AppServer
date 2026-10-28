import { PlatformConfigurationIamService } from "@/services/system/platform-configuration-iam.service";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { ContentSafetyService } from "@/services/system/content-safety.service";
import { ConfigService } from "@/services/system/config.service";
import { ContentSafetySystemConfigMutationRepository } from "@/store/system/content-safety-system-config-mutation.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { contentSafetySystemConfigArn } from "@/iam/resources/content-safety-system-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import BusinessLogService from "@/services/system/businesslog.service";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, groupId: string;
const mode = env.security.iamAuthorizationMode,
  secret = env.security.supportAiConfig.masterSecret,
  service = ContentSafetyService.getInstance(),
  repository = ContentSafetySystemConfigMutationRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "config-write-" + randomUUID(),
        password: "fixture-only-credential",
        userType: accountOwnerId ? "ram_user" : "root",
        accountOwnerId,
        parentUserId: accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*", "x-account-id": "forged" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const body = () => ({
  requestEnabled: false,
  requestAction: "allow",
  requestMaxAction: "blackhole",
  requestAiEnabled: false,
  responseEnabled: true,
  responseAction: "blackhole",
  responseMaxAction: "unreachable",
  responseAiEnabled: false,
  aiUpstreamUrl: "https://example.invalid",
  aiModel: "fixture-model",
  aiRequestFormat: "openai-chat-completions",
  aiTimeoutMs: 9000,
  aiInputPricePerMillion: 0,
  aiOutputPricePerMillion: 1,
  aiMaxTextLength: 12000,
});
async function policy(
  Effect: "Allow" | "Deny",
  Resource = contentSafetySystemConfigArn(),
  principalType = "user",
  principalId = actor,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect, Action: "quyan:content_safety:UpdateSystemConfig", Resource },
  });
  const created = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "config-write-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType,
      principalId,
      policyId: created.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  env.security.supportAiConfig.masterSecret = "fixture-content-safety-encryption-".repeat(3);
  owner = await user();
  actor = await user(owner);
  groupId = (
    await prisma.group.create({
      data: {
        username: "config-write-group-" + randomUUID(),
        name: "Config write fixture",
        level: 5,
        accountOwnerId: null,
        permissions: [Permission.SYSTEM_CONFIG],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  await prisma.serverConfig.deleteMany({ where: { key: { in: Object.values(CONFIG_KEYS.CONTENT_SAFETY) } } });
  await prisma.serverConfig.create({ data: { key: CONFIG_KEYS.CONTENT_SAFETY.REQUEST_ENABLED, value: "true" } });
  await prisma.serverConfig.upsert({
    where: { key: CONFIG_KEYS.REGISTRATION.DEFAULT_GROUP_USERNAME },
    create: { key: CONFIG_KEYS.REGISTRATION.DEFAULT_GROUP_USERNAME, value: "unrelated" },
    update: { value: "unrelated" },
  });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  env.security.supportAiConfig.masterSecret = secret;
  vi.restoreAllMocks();
});
describe("atomic system content safety configuration", () => {
  it("saves the complete configuration on its fixed resource with a sanitized response", async () => {
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
    const result = await service.updateConfig({ ...body(), aiApiKey: "fixture-only-secret" }, actor, request());
    expect(result).toMatchObject({
      requestEnabled: false,
      responseAction: "blackhole",
      aiApiKeyConfigured: true,
      aiModel: "fixture-model",
    });
    expect(JSON.stringify(result)).not.toContain("fixture-only-secret");
    expect(result).not.toHaveProperty("aiApiKey");
    const stored = await prisma.serverConfig.findUniqueOrThrow({
      where: { key: CONFIG_KEYS.CONTENT_SAFETY.AI_API_KEY },
    });
    expect(stored.value).not.toBe("fixture-only-secret");
    expect(stored.value.split(".")).toHaveLength(3);
    expect(JSON.stringify(audit.mock.calls)).not.toContain("fixture-only-secret");
    expect(JSON.stringify(audit.mock.calls)).not.toContain(stored.value);
    expect(
      (await prisma.serverConfig.findUniqueOrThrow({ where: { key: CONFIG_KEYS.REGISTRATION.DEFAULT_GROUP_USERNAME } }))
        .value,
    ).toBe("unrelated");
  });
  it("preserves an omitted key and gives clear precedence over a replacement", async () => {
    await service.updateConfig({ ...body(), aiApiKey: "fixture-only-first" }, actor, request());
    const first = (await repository.configuration()).values[CONFIG_KEYS.CONTENT_SAFETY.AI_API_KEY];
    expect((await service.updateConfig(body(), actor, request())).aiApiKeyConfigured).toBe(true);
    expect((await repository.configuration()).values[CONFIG_KEYS.CONTENT_SAFETY.AI_API_KEY]).toBe(first);
    expect(
      (await service.updateConfig({ ...body(), aiApiKey: "fixture-only-next", clearAiApiKey: true }, actor, request()))
        .aiApiKeyConfigured,
    ).toBe(false);
    expect((await repository.configuration()).values[CONFIG_KEYS.CONTENT_SAFETY.AI_API_KEY]).toBe("");
  });
  it("returns the committed values without a stale public config read", async () => {
    const oldRead = vi
      .spyOn(ConfigService.getInstance(), "getMultiple")
      .mockResolvedValue({ [CONFIG_KEYS.CONTENT_SAFETY.REQUEST_ENABLED]: "true" });
    expect((await service.updateConfig(body(), actor, request())).requestEnabled).toBe(false);
    expect(oldRead).not.toHaveBeenCalled();
  });
  it("lets explicit Deny override a global management Allow without writing", async () => {
    await policy("Deny");
    const before = await repository.configuration();
    await expect(service.updateConfig(body(), actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await repository.configuration()).toEqual(before);
  });
  it("cannot bypass domain Deny through generic configuration reads or writes", async () => {
    const generic = PlatformConfigurationIamService.getInstance();
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: ["quyan:content_safety:UpdateSystemConfig", "quyan:content_safety:GetSystemConfig"],
        Resource: contentSafetySystemConfigArn(),
      },
    });
    const denied = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "Generic config deny " + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
    await prisma.ramAuthorization.create({
      data: {
        accountOwnerId: owner,
        principalType: "user",
        principalId: actor,
        policyId: denied.id,
        scopeType: "account",
        scopeKey: "account",
        createdBy: owner,
      },
    });
    await expect(
      generic.prepareUpdate([CONFIG_KEYS.CONTENT_SAFETY.REQUEST_ENABLED], actor, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await generic.list(request())).configs).not.toHaveProperty(CONFIG_KEYS.CONTENT_SAFETY.REQUEST_ENABLED);
    expect((await repository.configuration()).values[CONFIG_KEYS.CONTENT_SAFETY.REQUEST_ENABLED]).toBe("true");
  });
  it.each([
    "disabled-actor",
    "disabled-owner",
    "private-group",
    "disabled-group",
    "no-group",
    "readonly",
    "oauth",
    "actor-mismatch",
  ])("rejects %s before writes", async (kind) => {
    const req = request();
    let actorId = actor;
    if (kind === "disabled-actor") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    if (kind === "disabled-owner") await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    if (kind === "private-group")
      await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    if (kind === "disabled-group") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
    if (kind === "no-group") await prisma.user.update({ where: { id: actor }, data: { groupId: null } });
    if (kind === "readonly") req.user = { ...req.user!, impersonatorId: owner, impersonationMode: "view" };
    if (kind === "oauth") req.oauthAccessToken = {} as any;
    if (kind === "actor-mismatch") actorId = owner;
    await expect(service.updateConfig(body(), actorId, req)).rejects.toMatchObject({ statusCode: 403 });
    expect((await repository.configuration()).values[CONFIG_KEYS.CONTENT_SAFETY.REQUEST_ENABLED]).toBe("true");
  });
  it("rejects stored configuration names that differ only in case", async () => {
    await prisma.serverConfig.update({
      where: { key: CONFIG_KEYS.CONTENT_SAFETY.REQUEST_ENABLED },
      data: { key: CONFIG_KEYS.CONTENT_SAFETY.REQUEST_ENABLED.toUpperCase() },
    });
    await expect(service.updateConfig(body(), actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.serverConfig.count({ where: { key: { in: Object.values(CONFIG_KEYS.CONTENT_SAFETY) } } })).toBe(
      1,
    );
  });
  it("does not let an account policy manufacture management membership", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await policy("Allow");
    await expect(service.updateConfig(body(), actor, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["missing-allow", "allow", "deny"])("uses independent role authority for %s", async (kind) => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "Config role " + randomUUID() } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Config write",
        tokenJtiHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    if (kind !== "missing-allow") await policy("Allow", contentSafetySystemConfigArn(), "role", role.id);
    if (kind === "deny") await policy("Deny", contentSafetySystemConfigArn(), "role", role.id);
    if (kind === "allow") expect((await service.updateConfig(body(), actor, req)).requestEnabled).toBe(false);
    else await expect(service.updateConfig(body(), actor, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["group", "policy", "source", "raw-source"])(
    "detects %s changes before transaction mutation",
    async (kind) => {
      const write = repository.update.bind(repository);
      const spy = vi.spyOn(repository, "update").mockImplementation(async (updates, guard) => {
        if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
        if (kind === "policy") await policy("Deny");
        if (kind === "source")
          await prisma.serverConfig.update({
            where: { key: CONFIG_KEYS.CONTENT_SAFETY.REQUEST_ENABLED },
            data: { value: "changed" },
          });
        if (kind === "raw-source")
          await prisma.$executeRaw`UPDATE server_configs SET value='changed' WHERE \`key\`=${CONFIG_KEYS.CONTENT_SAFETY.REQUEST_ENABLED}`;
        return write(updates, guard);
      });
      await expect(service.updateConfig(body(), actor, request())).rejects.toMatchObject({ statusCode: 403 });
      spy.mockRestore();
      expect((await repository.configuration()).values[CONFIG_KEYS.CONTENT_SAFETY.AI_MODEL]).toBeUndefined();
    },
  );
  it("rolls back every configuration row if the final authorization guard fails", async () => {
    const before = await repository.configuration(),
      write = repository.update.bind(repository);
    vi.spyOn(repository, "update").mockImplementation(async (updates, guard) => {
      let checks = 0;
      const recheck = guard.users.recheck;
      return write(updates, {
        ...guard,
        users: {
          ...guard.users,
          recheck: async () => {
            if (++checks > 1) throw iamAccountDenied();
            await recheck();
          },
        },
      });
    });
    await expect(
      service.updateConfig({ ...body(), aiApiKey: "fixture-only-no-save" }, actor, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await repository.configuration()).toEqual(before);
  });
  it.each(["invalid-input", "disabled-config", "missing-context"])("cannot save %s", async (kind) => {
    if (kind === "disabled-config")
      await prisma.serverConfig.update({
        where: { key: CONFIG_KEYS.CONTENT_SAFETY.REQUEST_ENABLED },
        data: { status: 0 },
      });
    const input = kind === "invalid-input" ? { ...body(), requestAction: "typo" } : body();
    await expect(
      service.updateConfig(input, actor, kind === "missing-context" ? undefined : request()),
    ).rejects.toMatchObject({ statusCode: kind === "invalid-input" ? 400 : 403 });
    expect(await prisma.serverConfig.count({ where: { key: { in: Object.values(CONFIG_KEYS.CONTENT_SAFETY) } } })).toBe(
      1,
    );
  });
  it.each(["legacy", "shadow"] as const)("retains the previous one-pass writes in %s", async (next) => {
    env.security.iamAuthorizationMode = next;
    const native = vi.spyOn(repository, "update"),
      old = vi.spyOn(ConfigService.getInstance(), "set");
    expect((await service.updateConfig(body(), actor, request())).requestEnabled).toBe(false);
    expect(native).not.toHaveBeenCalled();
    expect(old).toHaveBeenCalledTimes(Object.values(CONFIG_KEYS.CONTENT_SAFETY).length - 1);
  });
});
