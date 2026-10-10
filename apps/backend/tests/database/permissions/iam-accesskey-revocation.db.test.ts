import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, actionForPermission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { AccessKeyService } from "@/services/users/accesskey.service";
import { AccessKeyManagementRepository } from "@/store/users/accesskey-management.repository";
import { AccessKeyRepository } from "@/store/users/accesskey.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { accessKeyArn } from "@/iam/resources/accesskey-resources";
import BusinessLogService from "@/services/system/businesslog.service";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  service = new AccessKeyService(),
  ram = RamService.getInstance(),
  repository = AccessKeyManagementRepository.getInstance();
let owner: string, actor: string, peer: string, foreign: string;
const action = "quyan:ram:DeleteAccessKey";
const principal = (): IamPrincipal => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId: owner,
  subjectType: "sub_user",
});
const request = (auth = {}) =>
  ({
    user: { userId: actor },
    params: { id: "forged-path" },
    query: { accountOwnerId: foreign },
    headers: {},
    secure: true,
    ip: "127.0.0.1",
    authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user", ...auth },
  }) as unknown as TypedRequest;
async function grant(Action: string, Resource = "*", Effect: "Allow" | "Deny" = "Allow") {
  const policy = await ram.createPolicy(owner, {
    name: "access-key-policy-" + randomUUID(),
    document: { Version: "1", Statement: { Effect, Action, Resource } },
  });
  await ram.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
}
const key = (userId = actor) =>
  prisma.accessKey.create({
    data: { userId, name: "fixture-name-with-credential", key: "fixture-only-" + randomUUID() },
  });
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "access-key-user-" + randomUUID(),
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
  peer = await user(owner);
  foreign = await user();
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("transactional resource-scoped access-key revocation", () => {
  it("revokes only the granted concrete key and never logs its secret or display name", async () => {
    const own = await key(),
      other = await key();
    await grant(action, accessKeyArn(owner, actor, own.id));
    await service.revokeKey(own.id, actor, request());
    expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(-1);
    await expect(service.revokeKey(other.id, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(1);
    const audit = JSON.stringify(vi.mocked(BusinessLogService.getInstance().logOperation).mock.calls);
    expect(audit).not.toContain(own.key);
    expect(audit).not.toContain(own.name);
  });
  it("keeps key reads and authorization metadata free of credential columns", async () => {
    const own = await key();
    const target = await repository.target(principal(), own.id);
    expect(Object.keys(target).sort()).toEqual(["id", "status", "updateTime", "userId"]);
    expect(JSON.stringify(target)).not.toContain(own.key);
  });
  it("applies explicit Deny and implicit Deny without writing", async () => {
    const own = await key();
    await expect(service.revokeKey(own.id, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    await grant(action, "*");
    await grant(action, accessKeyArn(owner, actor, own.id), "Deny");
    await expect(service.revokeKey(own.id, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(1);
  });
  it("projects legacy grants and removals without widening canonical JSON Actions", async () => {
    const own = await key();
    await grant(actionForPermission(Permission.ACCESSKEY_DELETE));
    await expect(service.revokeKey(own.id, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.ACCESSKEY_DELETE] } });
    await service.revokeKey(own.id, actor, request());
    const denied = await key();
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.ACCESSKEY_DELETE] } });
    await expect(service.revokeKey(denied.id, actor, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("preserves own-key isolation even under a wildcard grant", async () => {
    await grant(action);
    for (const userId of [peer, foreign]) {
      const target = await key(userId);
      await expect(service.revokeKey(target.id, actor, request())).rejects.toMatchObject({ statusCode: 404 });
      expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: target.id } })).status).toBe(1);
    }
    const own = await key();
    await expect(service.revokeKey(own.id, actor, request({ accountOwnerId: foreign }))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("refuses a target moved or changed after the authorization snapshot", async () => {
    const own = await key(),
      expected = await repository.target(principal(), own.id);
    await prisma.accessKey.update({ where: { id: own.id }, data: { userId: peer } });
    await expect(repository.revoke(principal(), expected)).rejects.toMatchObject({ statusCode: 409 });
    expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(1);
    const changed = await key(),
      snapshot = await repository.target(principal(), changed.id);
    await prisma.accessKey.update({
      where: { id: changed.id },
      data: { updateTime: new Date(snapshot.updateTime.getTime() + 1000) },
    });
    await expect(repository.revoke(principal(), snapshot)).rejects.toMatchObject({ statusCode: 409 });
  });
  it("rechecks the account owner and actor before the final write", async () => {
    const own = await key(),
      expected = await repository.target(principal(), own.id);
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(repository.revoke(principal(), expected)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: owner }, data: { status: 1 } });
    await prisma.user.update({ where: { id: actor }, data: { accountOwnerId: foreign } });
    await expect(repository.revoke(principal(), expected)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(1);
  });
  it("rechecks role-session revocation before persistence", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "key-role" } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const assumed: IamPrincipal = {
      ...principal(),
      subjectType: "assumed_role",
      assumedRoleId: role.id,
      roleSessionId: session.id,
    };
    const own = await key(),
      target = await repository.target(assumed, own.id);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(repository.revoke(assumed, target)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(1);
  });
  it.each(["expired-session", "disabled-session", "disabled-role"])("refuses %s at the final write", async (state) => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "key-role" } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const assumed: IamPrincipal = {
      ...principal(),
      subjectType: "assumed_role",
      assumedRoleId: role.id,
      roleSessionId: session.id,
    };
    const own = await key(),
      target = await repository.target(assumed, own.id);
    if (state === "disabled-role") await prisma.ramRole.update({ where: { id: role.id }, data: { status: 0 } });
    else
      await prisma.ramRoleSession.update({
        where: { id: session.id },
        data: state === "expired-session" ? { expiresAt: new Date(0) } : { status: 0 },
      });
    await expect(repository.revoke(assumed, target)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(1);
  });

  it("registers only active correctly parented key resources in their account", async () => {
    const own = await key(),
      peerKey = await key(peer),
      groups = RamResourceGroupRepository.getInstance();
    expect(await groups.resourceExistsInAccount(accessKeyArn(owner, actor, own.id), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(accessKeyArn(owner, actor, peerKey.id), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(accessKeyArn(foreign, actor, own.id), foreign)).toBe(false);
    await prisma.accessKey.update({ where: { id: own.id }, data: { status: -1 } });
    expect(await groups.resourceExistsInAccount(accessKeyArn(owner, actor, own.id), owner)).toBe(false);
  });
  it("immediately applies resource-group membership to concrete key authorization", async () => {
    const first = await key(),
      second = await key();
    const group = await ram.createResourceGroup(owner, { name: "access-key-group" });
    await ram.addResourceGroupMember(owner, group.id, { resourceArn: accessKeyArn(owner, actor, first.id) });
    await ram.addResourceGroupMember(owner, group.id, { resourceArn: accessKeyArn(owner, actor, second.id) });
    const policy = await ram.createPolicy(owner, {
      name: "access-key-group-policy",
      document: { Version: "1", Statement: { Effect: "Allow", Action: action, Resource: "*" } },
    });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "resource-group",
      scopeResourceId: group.id,
    });
    await service.revokeKey(first.id, actor, request());
    const member = await prisma.ramResourceGroupMember.findFirstOrThrow({
      where: { resourceGroupId: group.id, resourceArn: accessKeyArn(owner, actor, second.id) },
    });
    await ram.removeResourceGroupMember(owner, group.id, member.id);
    await expect(service.revokeKey(second.id, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(1);
  });

  it("retains ownership on legacy final writes and allows rollback modes without changing policy data", async () => {
    const own = await key();
    await expect(AccessKeyRepository.getInstance().delete(own.id, peer)).rejects.toThrow();
    expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(1);
    for (const authMode of ["legacy", "shadow"] as const) {
      env.security.iamAuthorizationMode = authMode;
      const target = await key();
      await service.revokeKey(target.id, actor, request());
      expect((await prisma.accessKey.findUniqueOrThrow({ where: { id: target.id } })).status).toBe(-1);
    }
  });
});
