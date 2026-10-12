import { CONFIG_KEYS } from "@/constant/config-keys";
import {
  RELAY_CONFIGURATION_KEYS,
  RELAY_PROXY_CONFIGURATION_KEYS,
  AUTO_PROXY_POOL_CONFIGURATION_KEYS,
  IP_BAN_CONFIGURATION_KEYS,
  CAPTCHA_CONFIGURATION_KEYS,
  SOCIAL_AUTH_CONFIGURATION_KEYS,
} from "@/constant/config-keysets";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { PlatformConfigurationIamService } from "@/services/system/platform-configuration-iam.service";
import { PlatformConfigurationRepository } from "@/store/system/platform-configuration.repository";
import {
  platformConfigurationArn,
  PLATFORM_CONFIGURATION_KEYS,
} from "@/iam/resources/platform-configuration-resources";
import { Permission, SERVER_CONFIG_SECRET_PLACEHOLDER } from "@quyan/shared";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "oauth-read-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
const service = PlatformConfigurationIamService.getInstance(),
  mutations = PlatformConfigurationRepository.getInstance();
beforeEach(async () => {
  vi.restoreAllMocks();
  await prisma.serverConfig.deleteMany({ where: { key: { in: [...PLATFORM_CONFIGURATION_KEYS] } } });
  owner = await user();
  actor = await user(owner);
});
async function globalGroup(permissions = [Permission.SYSTEM_CONFIG]) {
  const group = await prisma.group.create({
    data: { username: "platform-" + randomUUID(), name: "fixture global", level: 0, permissions, accountOwnerId: null },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: group.id } });
  return group;
}
async function bind(document: unknown) {
  const parsed = parseIamPolicy(document),
    policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "platform-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}

const prepare = (keys: string[] = [CONFIG_KEYS.SITE.BACKEND_PUBLIC_URL]) =>
  service.prepareUpdate(keys, actor, request());
const updates = { [CONFIG_KEYS.SITE.BACKEND_PUBLIC_URL]: "https://fixture.example.test" };
describe("platform configuration authorization database", () => {
  it("updates real registered configuration keys without changing unrelated settings", async () => {
    await globalGroup();
    await prisma.serverConfig.create({ data: { key: CONFIG_KEYS.SMTP.HOST, value: "unchanged" } });
    await service.update(updates, await prepare());
    expect((await prisma.serverConfig.findUnique({ where: { key: CONFIG_KEYS.SITE.BACKEND_PUBLIC_URL } }))!.value).toBe(
      updates[CONFIG_KEYS.SITE.BACKEND_PUBLIC_URL],
    );
    expect((await prisma.serverConfig.findUnique({ where: { key: CONFIG_KEYS.SMTP.HOST } }))!.value).toBe("unchanged");
  });
  it("requires a global ceiling and rejects account-created groups", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    const group = await globalGroup();
    await prisma.group.update({ where: { id: group.id }, data: { accountOwnerId: owner } });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("denies one batch member before any write and rejects unknown targets or read guards", async () => {
    await globalGroup();
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:system:UpdateConfigurations",
        Resource: platformConfigurationArn(CONFIG_KEYS.SMTP.HOST),
      },
    });
    await expect(prepare([CONFIG_KEYS.SITE.BACKEND_PUBLIC_URL, CONFIG_KEYS.SMTP.HOST])).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(prepare(["fixture-unknown-key"])).rejects.toMatchObject({ statusCode: 403 });
    const guard = await prepare();
    await expect(
      mutations.update(updates, { ...guard, action: "quyan:system:ListConfigurations" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.serverConfig.count({ where: { key: CONFIG_KEYS.SITE.BACKEND_PUBLIC_URL } })).toBe(0);
  });
  it("filters denied keys before hydration and masks stored credential values", async () => {
    await globalGroup();
    await prisma.serverConfig.createMany({
      data: [
        { key: CONFIG_KEYS.SMTP.HOST, value: "fixture-mail" },
        { key: CONFIG_KEYS.SMTP.PASSWORD, value: "fixture-stored-secret" },
      ],
    });
    const result = await service.list(request());
    expect(result.configs[CONFIG_KEYS.SMTP.PASSWORD]).toBe(SERVER_CONFIG_SECRET_PLACEHOLDER);
    expect(JSON.stringify(result)).not.toContain("fixture-stored-secret");
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:system:ListConfigurations",
        Resource: platformConfigurationArn(CONFIG_KEYS.SMTP.PASSWORD),
      },
    });
    expect((await service.list(request())).configs).toEqual({ [CONFIG_KEYS.SMTP.HOST]: "fixture-mail" });
  });
  it("cannot bypass the support action through generic configuration writes or reads", async () => {
    const group = await globalGroup();
    await expect(prepare([CONFIG_KEYS.SUPPORT_AI.MODEL])).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({
      where: { id: group.id },
      data: { permissions: [Permission.SYSTEM_CONFIG, Permission.SUPPORT_AI_CONFIG] },
    });
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: ["quyan:support:UpdateConfig", "quyan:support:GetConfig"],
        Resource: "acs:platform:*:platform:config/support-ai",
      },
    });
    await expect(prepare([CONFIG_KEYS.SUPPORT_AI.MODEL])).rejects.toMatchObject({ statusCode: 403 });
    await prisma.serverConfig.create({ data: { key: CONFIG_KEYS.SUPPORT_AI.MODEL, value: "hidden" } });
    expect((await service.list(request())).configs).not.toHaveProperty(CONFIG_KEYS.SUPPORT_AI.MODEL);
  });
  it("rejects changed configuration and concurrent insertion and rolls back all final-denied writes", async () => {
    await globalGroup();
    const stale = await prepare();
    await prisma.serverConfig.create({ data: { key: CONFIG_KEYS.SITE.BACKEND_PUBLIC_URL, value: "concurrent" } });
    await expect(service.update(updates, stale)).rejects.toMatchObject({ statusCode: 403 });
    const guard = await prepare([CONFIG_KEYS.SITE.BACKEND_PUBLIC_URL, CONFIG_KEYS.SMTP.HOST]),
      original = guard.users.recheck;
    let calls = 0;
    guard.users.recheck = async () => {
      await original();
      if (++calls === 2) throw new Error("fixture final deny");
    };
    await expect(service.update({ ...updates, [CONFIG_KEYS.SMTP.HOST]: "mail" }, guard)).rejects.toThrow(
      "fixture final deny",
    );
    expect((await prisma.serverConfig.findUnique({ where: { key: CONFIG_KEYS.SITE.BACKEND_PUBLIC_URL } }))!.value).toBe(
      "concurrent",
    );
    expect(await prisma.serverConfig.findUnique({ where: { key: CONFIG_KEYS.SMTP.HOST } })).toBeNull();
  });
  it("fails closed after global-group and user version changes", async () => {
    const group = await globalGroup(),
      guard = await prepare();
    await prisma.group.update({ where: { id: group.id }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.update(updates, guard)).rejects.toMatchObject({ statusCode: 403 });
    const userGuard = await prepare();
    await prisma.user.update({ where: { id: actor }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.update(updates, userGuard)).rejects.toMatchObject({ statusCode: 403 });
    const revoked = await prepare();
    await prisma.group.update({ where: { id: group.id }, data: { permissions: [] } });
    await expect(service.update(updates, revoked)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects revoked role sessions before committing a configuration mutation", async () => {
    await globalGroup();
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "configuration-role-" + randomUUID() },
    });
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:system:UpdateConfigurations",
        Resource: platformConfigurationArn(CONFIG_KEYS.SITE.BACKEND_PUBLIC_URL),
      },
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "configuration-role-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
    await prisma.ramAuthorization.create({
      data: {
        accountOwnerId: owner,
        principalType: "role",
        principalId: role.id,
        policyId: policy.id,
        scopeType: "account",
        scopeKey: "account",
        createdBy: owner,
      },
    });
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
    Object.assign(req.authContext!, { roleSessionId: session.id, assumedRoleId: role.id });
    const guard = await service.prepareUpdate(Object.keys(updates), actor, req);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.update(updates, guard)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks typed-family reads even when another key was previously absent", async () => {
    await globalGroup();
    await prisma.serverConfig.create({ data: { key: CONFIG_KEYS.SMTP.HOST, value: "mail" } });
    const guard = await service.prepareRead(Object.values(CONFIG_KEYS.SMTP), request());
    await service.recheck(guard);
    await prisma.serverConfig.create({ data: { key: CONFIG_KEYS.SMTP.PASSWORD, value: "fixture-secret" } });
    await expect(service.recheck(guard)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires every SMTP read key and cannot reuse a read guard to write", async () => {
    await globalGroup();
    const read = await service.prepareRead(Object.values(CONFIG_KEYS.SITE), request());
    await expect(service.update(updates, read)).rejects.toMatchObject({ statusCode: 403 });
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:system:ListConfigurations",
        Resource: platformConfigurationArn(CONFIG_KEYS.SMTP.PASSWORD),
      },
    });
    await expect(service.prepareRead(Object.values(CONFIG_KEYS.SMTP), request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await service.prepareRead(Object.values(CONFIG_KEYS.SITE), request())).toBeDefined();
  });
});

describe("typed configuration family authorization", () => {
  it.each([
    ["billing", Object.values(CONFIG_KEYS.BILLING)],
    ["ipban", [...IP_BAN_CONFIGURATION_KEYS]],
    ["captcha", [...CAPTCHA_CONFIGURATION_KEYS]],
    ["social-auth", [...SOCIAL_AUTH_CONFIGURATION_KEYS]],
    ["relay", [...RELAY_CONFIGURATION_KEYS]],
    ["relay-proxy", [...RELAY_PROXY_CONFIGURATION_KEYS]],
    ["auto-proxy-pool", [...AUTO_PROXY_POOL_CONFIGURATION_KEYS]],
    ["notification", Object.values(CONFIG_KEYS.NOTIFICATION)],
    ["heartbeat", Object.values(CONFIG_KEYS.HEARTBEAT)],
    ["remote-terminal", Object.values(CONFIG_KEYS.REMOTE_TERMINAL)],
  ])("denies %s reads and writes when one family member is explicitly denied", async (_family, keys) => {
    await globalGroup();
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: ["quyan:system:ListConfigurations", "quyan:system:UpdateConfigurations"],
        Resource: platformConfigurationArn(keys[keys.length - 1]),
      },
    });
    await expect(service.prepareRead(keys, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(prepare(keys)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.serverConfig.count({ where: { key: { in: keys } } })).toBe(0);
  });
  it("rolls back an entire notification save if the deployment grant is revoked before commit", async () => {
    const group = await globalGroup();
    const keys = Object.values(CONFIG_KEYS.NOTIFICATION);
    const guard = await prepare(keys);
    const originalRecheck = guard.users.recheck;
    let count = 0;
    guard.users.recheck = async () => {
      await originalRecheck();
      if (++count === 2) throw new Error("fixture final notification deny");
    };
    await expect(service.update(Object.fromEntries(keys.map((key) => [key, "[]"])), guard)).rejects.toThrow();
    expect(await prisma.serverConfig.count({ where: { key: { in: keys } } })).toBe(0);
    await prisma.group.update({ where: { id: group.id }, data: { permissions: [] } });
    await expect(service.prepareRead(keys, request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
