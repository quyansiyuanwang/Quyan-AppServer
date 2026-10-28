import { CONFIG_KEYS } from "@/constant/config-keys";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { SupportConfigIamService } from "@/services/support/support-config-iam.service";
import { SupportConfigRepository } from "@/store/support/support-config.repository";
import { supportConfigArn } from "@/iam/resources/support-config-resource";
import { Permission } from "@quyan/shared";
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
const service = SupportConfigIamService.getInstance(),
  mutations = SupportConfigRepository.getInstance();
beforeEach(async () => {
  vi.restoreAllMocks();
  await prisma.serverConfig.deleteMany({ where: { key: { in: Object.values(CONFIG_KEYS.SUPPORT_AI) } } });
  owner = await user();
  actor = await user(owner);
});
async function globalGroup(permissions = [Permission.SUPPORT_AI_CONFIG]) {
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

const prepare = () => service.prepare("quyan:support:UpdateConfig", actor, request());
const updates = () => ({ [CONFIG_KEYS.SUPPORT_AI.ENABLED]: "true", [CONFIG_KEYS.SUPPORT_AI.MODEL]: "fixture-model" });
describe("platform support configuration database", () => {
  it("writes all registered support settings atomically and preserves unrelated config", async () => {
    await globalGroup();
    const other = await prisma.serverConfig.create({
      data: { key: "fixture-other-" + randomUUID(), value: "unchanged" },
    });
    const values = await service.update(updates(), await prepare());
    expect(values).toMatchObject(updates());
    expect((await prisma.serverConfig.findUnique({ where: { id: other.id } }))!.value).toBe("unchanged");
  });
  it("requires a real global management group and honors explicit Deny", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    const group = await globalGroup();
    await prisma.group.update({ where: { id: group.id }, data: { accountOwnerId: owner } });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({ where: { id: group.id }, data: { accountOwnerId: null } });
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: "quyan:support:UpdateConfig", Resource: supportConfigArn() },
    });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    expect(await service.prepare("quyan:support:GetConfig", actor, request())).toBeDefined();
  });
  it("rejects stale configuration including concurrent insertion of previously absent keys", async () => {
    await globalGroup();
    const guard = await prepare();
    await prisma.serverConfig.create({ data: { key: CONFIG_KEYS.SUPPORT_AI.ENABLED, value: "false" } });
    await expect(service.update(updates(), guard)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.serverConfig.findUnique({ where: { key: CONFIG_KEYS.SUPPORT_AI.ENABLED } }))!.value).toBe(
      "false",
    );
    const current = await prepare();
    await prisma.serverConfig.update({
      where: { key: CONFIG_KEYS.SUPPORT_AI.ENABLED },
      data: { value: "concurrent", updateTime: new Date(Date.now() + 1000) },
    });
    await expect(service.update(updates(), current)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("cannot use read guards or unrelated keys to change other platform settings", async () => {
    await globalGroup();
    const guard = await prepare();
    await expect(mutations.update({ smtpPassword: "fixture-never-save" }, guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    const readGuard = await service.prepare("quyan:support:GetConfig", actor, request());
    await expect(service.update(updates(), readGuard)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.serverConfig.count({ where: { key: { in: Object.values(CONFIG_KEYS.SUPPORT_AI) } } })).toBe(0);
  });
  it("rolls back every key when the final policy check fails", async () => {
    await globalGroup();
    const guard = await prepare(),
      original = guard.users.recheck;
    let calls = 0;
    guard.users.recheck = async () => {
      await original();
      if (++calls === 2) throw new Error("fixture final deny");
    };
    await expect(service.update(updates(), guard)).rejects.toThrow("fixture final deny");
    expect(await prisma.serverConfig.count({ where: { key: { in: Object.values(CONFIG_KEYS.SUPPORT_AI) } } })).toBe(0);
  });
  it("denies stale or revoked groups and changed user identities before write", async () => {
    const group = await globalGroup(),
      guard = await prepare();
    await prisma.group.update({ where: { id: group.id }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.update(updates(), guard)).rejects.toMatchObject({ statusCode: 403 });
    const userGuard = await prepare();
    await prisma.user.update({ where: { id: actor }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.update(updates(), userGuard)).rejects.toMatchObject({ statusCode: 403 });
    const revoked = await prepare();
    await prisma.group.update({ where: { id: group.id }, data: { permissions: [] } });
    await expect(service.update(updates(), revoked)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks reads and rejects disabled configuration or account contexts", async () => {
    await globalGroup();
    const guard = await service.prepare("quyan:support:GetConfig", actor, request());
    await service.recheck(guard);
    await prisma.serverConfig.create({ data: { key: CONFIG_KEYS.SUPPORT_AI.MODEL, value: "changed" } });
    await expect(service.recheck(guard)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.serverConfig.update({ where: { key: CONFIG_KEYS.SUPPORT_AI.MODEL }, data: { status: 0 } });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a revoked active role session before changing configuration", async () => {
    await globalGroup();
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "support-config-role-" + randomUUID() },
    });
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:support:UpdateConfig", Resource: supportConfigArn() },
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "support-config-" + randomUUID(),
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
    const guard = await service.prepare("quyan:support:UpdateConfig", actor, req);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.update(updates(), guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.serverConfig.count({ where: { key: { in: Object.values(CONFIG_KEYS.SUPPORT_AI) } } })).toBe(0);
  });
});
