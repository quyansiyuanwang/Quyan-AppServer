import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, actionForPermission, type IamPrincipal, maskSecret, toCanonicalCredential } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { AccessKeyService } from "@/services/users/accesskey.service";
import { AccessKeyManagementRepository } from "@/store/users/accesskey-management.repository";
import { accessKeyArn } from "@/iam/resources/accesskey-resources";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  service = new AccessKeyService(),
  ram = RamService.getInstance(),
  repository = AccessKeyManagementRepository.getInstance();
const action = "quyan:ram:ListAccessKeys";
let owner: string, actor: string, peer: string, foreign: string;
const principal = (): IamPrincipal => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId: owner,
  subjectType: "sub_user",
});
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" },
    headers: {},
    secure: true,
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const key = (userId = actor, createTime = new Date()) =>
  prisma.accessKey.create({
    data: {
      userId,
      key: "fixture-only-" + randomUUID(),
      legacyKey: "fixture-legacy-" + randomUUID(),
      name: "fixture-key-name",
      createTime,
    },
  });
async function grant(Action = action, Resource = "*", Effect: "Allow" | "Deny" = "Allow") {
  const policy = await ram.createPolicy(owner, {
    name: "key-list-policy-" + randomUUID(),
    document: { Version: "1", Statement: { Effect, Action, Resource } },
  });
  await ram.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "key-list-" + randomUUID(),
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
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("resource-scoped masked AccessKey listing", () => {
  it("returns only concrete allowed keys, with masked credentials and no hidden total", async () => {
    const own = await key(),
      hidden = await key(),
      peerKey = await key(peer);
    await grant(action, accessKeyArn(owner, actor, own.id));
    const page = await service.listKeysPage(actor, { page: 1, pageSize: 10 }, request());
    expect(page.items.map((row) => row.id)).toEqual([own.id]);
    expect(page.items[0].key).toBe(maskSecret(toCanonicalCredential(own.key, "accessKey")));
    const json = JSON.stringify(page);
    for (const secret of [own.key, own.legacyKey!, hidden.key, peerKey.key, hidden.id, peerKey.id])
      expect(json).not.toContain(secret);
    expect(page).not.toHaveProperty("total");
    expect(page.items[0]).not.toHaveProperty("legacyKey");
  });
  it("returns empty on default denial and matching Deny hides a previously allowed key", async () => {
    const own = await key();
    expect(await service.listKeys(actor, request())).toEqual([]);
    await grant();
    await grant(action, accessKeyArn(owner, actor, own.id), "Deny");
    expect((await service.listKeysPage(actor, { page: 1, pageSize: 1 }, request())).items).toEqual([]);
  });
  it("keeps candidate pages navigable across denied rows and never silently truncates the array endpoint", async () => {
    const allowed = await key(actor, new Date(0)),
      hidden = await key(actor, new Date(1000));
    await grant(action, accessKeyArn(owner, actor, allowed.id));
    expect(await service.listKeysPage(actor, { page: 1, pageSize: 1 }, request())).toEqual({
      page: 1,
      pageSize: 1,
      items: [],
      hasNext: true,
    });
    const next = await service.listKeysPage(actor, { page: 2, pageSize: 1 }, request());
    expect(next.items.map((row) => row.id)).toEqual([allowed.id]);
    expect(next.hasNext).toBe(false);
    expect((await service.listKeys(actor, request())).map((row) => row.id)).toEqual([allowed.id]);
    expect(hidden.id).not.toBe(allowed.id);
  });
  it("limits wildcard grants to the executing user's active keys", async () => {
    const own = await key();
    await key(peer);
    await key(foreign);
    const deleted = await key();
    await prisma.accessKey.update({ where: { id: deleted.id }, data: { status: -1 } });
    await grant();
    expect((await service.listKeys(actor, request())).map((row) => row.id)).toEqual([own.id]);
    const forged = request();
    forged.authContext!.accountOwnerId = foreign;
    await expect(service.listKeys(actor, forged)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps canonical legacy JSON Actions separate while projecting legacy read grants and removals", async () => {
    const own = await key();
    await grant(actionForPermission(Permission.ACCESSKEY_READ));
    expect(await service.listKeys(actor, request())).toEqual([]);
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.ACCESSKEY_READ] } });
    expect((await service.listKeys(actor, request())).map((row) => row.id)).toEqual([own.id]);
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.ACCESSKEY_READ] } });
    expect(await service.listKeys(actor, request())).toEqual([]);
  });
  it("selects metadata without credential columns and guards changed snapshots before masked hydration", async () => {
    const own = await key(),
      [snapshot] = await repository.candidates(principal(), { page: 1, pageSize: 1 });
    expect(Object.keys(snapshot).sort()).toEqual(["createTime", "id", "status", "updateTime", "userId"]);
    await prisma.accessKey.update({
      where: { id: own.id },
      data: { updateTime: new Date(snapshot.updateTime.getTime() + 1000) },
    });
    await expect(repository.hydrate(principal(), [snapshot])).rejects.toMatchObject({ statusCode: 409 });
  });
  it("refuses moved/deleted targets and disabled actors or owners at final hydration", async () => {
    const own = await key(),
      [snapshot] = await repository.candidates(principal(), { page: 1, pageSize: 1 });
    await prisma.accessKey.update({ where: { id: own.id }, data: { userId: peer } });
    await expect(repository.hydrate(principal(), [snapshot])).rejects.toMatchObject({ statusCode: 409 });
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(repository.hydrate(principal(), [])).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: owner }, data: { status: 1 } });
    await prisma.user.update({ where: { id: actor }, data: { accountOwnerId: foreign } });
    await expect(repository.hydrate(principal(), [])).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects expired and revoked role sessions even when hydrating an empty page", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "key-list-role" } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const assumed = {
      ...principal(),
      subjectType: "assumed_role" as const,
      assumedRoleId: role.id,
      roleSessionId: session.id,
    };
    await repository.hydrate(assumed, []);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { expiresAt: new Date(0) } });
    await expect(repository.hydrate(assumed, [])).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramRoleSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() + 60000), revokedAt: new Date() },
    });
    await expect(repository.hydrate(assumed, [])).rejects.toMatchObject({ statusCode: 403 });
  });
  it("immediately reflects resource-group membership changes in list grants", async () => {
    const own = await key(),
      hidden = await key();
    const group = await ram.createResourceGroup(owner, { name: "key-list-resource-group" });
    const arn = accessKeyArn(owner, actor, own.id);
    await ram.addResourceGroupMember(owner, group.id, { resourceArn: arn });
    const policy = await ram.createPolicy(owner, {
      name: "key-list-scoped-policy",
      document: { Version: "1", Statement: { Effect: "Allow", Action: action, Resource: "*" } },
    });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "resource-group",
      scopeResourceId: group.id,
    });
    expect((await service.listKeys(actor, request())).map((row) => row.id)).toEqual([own.id]);
    const member = await prisma.ramResourceGroupMember.findFirstOrThrow({
      where: { resourceGroupId: group.id, resourceArn: arn },
    });
    await ram.removeResourceGroupMember(owner, group.id, member.id);
    expect(await service.listKeys(actor, request())).toEqual([]);
    expect(hidden.id).not.toBe(own.id);
  });
  it.each(["legacy", "shadow"] as const)(
    "retains masked legacy results in %s mode and still enforces legacy read permission",
    async (mode) => {
      const own = await key();
      await grant(action, "*", "Deny");
      env.security.iamAuthorizationMode = mode;
      await expect(service.listKeysPage(actor, { page: 1, pageSize: 1 }, request())).rejects.toMatchObject({
        statusCode: 403,
      });
      await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.ACCESSKEY_READ] } });
      const page = await service.listKeysPage(actor, { page: 1, pageSize: 1 }, request());
      expect(page.items.map((row) => row.id)).toEqual([own.id]);
      expect(JSON.stringify(page)).not.toContain(own.key);
    },
  );
  it.each([0, -1, 10001, 1.5])("rejects invalid service page %s", async (page) => {
    await expect(service.listKeysPage(actor, { page, pageSize: 1 }, request())).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
