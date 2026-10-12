import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { OjApiKeyManagementRepository } from "@/store/oj-submitter/oj-apikey-management.repository";
import { OjApiKeyIamService } from "@/services/oj-submitter/oj-apikey-iam.service";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { ojApiKeyArn } from "@/iam/resources/oj-apikey-resources";
import type { TypedRequest } from "@/types/express";
import type { IamPrincipal } from "@quyan/shared";
let owner: string, actor: string, peer: string, foreign: string;
const repository = OjApiKeyManagementRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "oj-delete-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
beforeEach(async () => {
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  foreign = await user();
});
const principal = (accountOwnerId = owner): IamPrincipal => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId,
  subjectType: "sub_user",
});
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
const key = (userId = actor) =>
  prisma.oJAPIKey.create({ data: { userId, name: "fixture", key: "fixture-only-" + randomUUID() } });
async function bind(document: unknown) {
  const parsed = parseIamPolicy(document),
    policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "oj-delete-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
  return prisma.ramAuthorization.create({
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
describe("OJ API Key deletion storage", () => {
  it("reads only scoped metadata and validates owner without an ORM relation", async () => {
    const selected = await key(),
      other = await key(peer),
      target = await repository.target(principal(), selected.id);
    expect(target).toMatchObject({ id: selected.id, userId: actor });
    expect(target).not.toHaveProperty("key");
    expect(target).not.toHaveProperty("legacyKey");
    expect(target).not.toHaveProperty("channel");
    expect(await repository.target(principal(), other.id)).toBeNull();
    await expect(repository.target(principal(foreign), selected.id)).rejects.toMatchObject({ statusCode: 403 });
    const groups = RamResourceGroupRepository.getInstance();
    expect(await groups.resourceExistsInAccount(ojApiKeyArn(owner, actor, selected.id), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(ojApiKeyArn(owner, peer, selected.id), owner)).toBe(false);
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    expect(await groups.resourceExistsInAccount(ojApiKeyArn(owner, actor, selected.id), owner)).toBe(false);
  });
  it("rejects stale, misbound and cross-account snapshots without deleting", async () => {
    const selected = await key(),
      target = (await repository.target(principal(), selected.id))!;
    await expect(repository.revoke(principal(foreign), target)).rejects.toMatchObject({ statusCode: 403 });
    await expect(repository.revoke(principal(), { ...target, userId: peer })).rejects.toMatchObject({
      statusCode: 403,
    });
    await prisma.oJAPIKey.update({
      where: { id: selected.id },
      data: { name: "changed", updateTime: new Date(target.updateTime.getTime() + 1_000) },
    });
    await expect(repository.revoke(principal(), target)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.oJAPIKey.findUnique({ where: { id: selected.id } }))?.status).toBe(1);
  });
  it("revokes only the current owned record and cannot repeat deletion", async () => {
    const selected = await key(),
      target = (await repository.target(principal(), selected.id))!;
    const result = await repository.revoke(principal(), target);
    expect(Object.keys(result).sort()).toEqual(["id", "name", "userId"]);
    expect((await prisma.oJAPIKey.findUnique({ where: { id: selected.id } }))?.status).toBe(-1);
    await expect(repository.revoke(principal(), target)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks disabled accounts and forged role sessions inside mutation", async () => {
    const selected = await key(),
      target = (await repository.target(principal(), selected.id))!;
    await expect(
      repository.revoke(
        { ...principal(), subjectType: "assumed_role", assumedRoleId: "role", roleSessionId: "missing" },
        target,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(repository.revoke(principal(), target)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.oJAPIKey.findUnique({ where: { id: selected.id } }))?.status).toBe(1);
  });
  it("enforces real exact-resource policies, Deny and immediate binding revocation", async () => {
    const selected = await key(),
      denied = await key(),
      arn = ojApiKeyArn(owner, actor, selected.id);
    const binding = await bind({
      Version: "1",
      Statement: [
        { Effect: "Allow", Action: "quyan:oj:DeleteApiKey", Resource: [arn, ojApiKeyArn(owner, actor, denied.id)] },
        { Effect: "Deny", Action: "quyan:oj:DeleteApiKey", Resource: ojApiKeyArn(owner, actor, denied.id) },
      ],
    });
    await expect(OjApiKeyIamService.getInstance().revoke(actor, denied.id, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    await expect(OjApiKeyIamService.getInstance().revoke(actor, selected.id, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: 1 } });
    await OjApiKeyIamService.getInstance().revoke(actor, selected.id, request());
    expect((await prisma.oJAPIKey.findUnique({ where: { id: selected.id } }))?.status).toBe(-1);
  });
});
