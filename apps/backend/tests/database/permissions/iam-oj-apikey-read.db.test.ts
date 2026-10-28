import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
        username: "oj-read-" + randomUUID(),
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
      name: "oj-read-" + randomUUID(),
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
describe("OJ resource reads", () => {
  it("scans only the actual subject metadata with no credential or upstream configuration", async () => {
    const selected = await key(),
      other = await key(peer);
    const rows = await repository.scan(principal());
    expect(rows.map((row) => row.id)).toEqual([selected.id]);
    expect(Object.keys(rows[0]).sort()).toEqual(["createTime", "id", "status", "updateTime", "userId"]);
    expect(rows.some((row) => row.id === other.id)).toBe(false);
    await expect(repository.scan(principal(foreign))).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not select credential columns without independent reveal permission", async () => {
    const selected = await key(),
      target = (await repository.target(principal(), selected.id))!;
    const spy = vi.spyOn(prisma.oJAPIKey, "findMany");
    try {
      const rows = await repository.hydrate(principal(), [target], []);
      expect(rows[0]).not.toHaveProperty("key");
      expect(rows[0]).not.toHaveProperty("legacyKey");
      expect(spy.mock.calls[0][0]?.select).not.toHaveProperty("key");
      expect(spy.mock.calls[0][0]?.select?.channel).toEqual({ select: { name: true } });
      spy.mockClear();
      expect((await repository.hydrate(principal(), [target], [target.id]))[0].key).toBe(selected.key);
      expect(spy.mock.calls[0][0]?.select?.key).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
  it("fails closed for misbound owners and skips resources changed after scan", async () => {
    const selected = await key(),
      target = (await repository.target(principal(), selected.id))!;
    await expect(repository.hydrate(principal(), [{ ...target, userId: peer }], [])).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(repository.hydrate(principal(), [target], ["different"])).rejects.toMatchObject({ statusCode: 403 });
    await prisma.oJAPIKey.update({
      where: { id: selected.id },
      data: { updateTime: new Date(target.updateTime.getTime() + 1000) },
    });
    expect(await repository.hydrate(principal(), [target], [target.id])).toEqual([]);
  });
  it("supports metadata-only policies and exact per-key disclosure", async () => {
    const selected = await key(),
      other = await key(),
      selectedArn = ojApiKeyArn(owner, actor, selected.id);
    const actions = ["quyan:oj:ListApiKeys", "quyan:oj:GetApiKey", "quyan:oj:GetApiKeyStats"];
    await bind({
      Version: "1",
      Statement: [
        { Effect: "Allow", Action: actions, Resource: "acs:oj:*:" + owner + ":api-key/" + actor + "/*" },
        { Effect: "Allow", Action: "quyan:oj:RevealApiKey", Resource: selectedArn },
      ],
    });
    const service = OjApiKeyIamService.getInstance(),
      rows = await service.list(actor, request());
    expect(rows.find((row) => row.id === selected.id)?.key).toBeDefined();
    expect(rows.find((row) => row.id === other.id)).not.toHaveProperty("key");
    expect((await service.get(actor, other.id, request())).key).toBeUndefined();
  });
  it("filters denied keys out of both list and aggregate usage", async () => {
    const selected = await key(),
      hidden = await key();
    await prisma.oJAPIKey.update({ where: { id: selected.id }, data: { requestCount: 7, totalTokens: 11 } });
    await prisma.oJAPIKey.update({ where: { id: hidden.id }, data: { requestCount: 999, totalTokens: 9999 } });
    await bind({
      Version: "1",
      Statement: [
        {
          Effect: "Allow",
          Action: ["quyan:oj:ListApiKeys", "quyan:oj:GetApiKeyStats"],
          Resource: "acs:oj:*:" + owner + ":api-key/" + actor + "/*",
        },
        { Effect: "Deny", Action: "quyan:oj:*", Resource: ojApiKeyArn(owner, actor, hidden.id) },
      ],
    });
    expect((await OjApiKeyIamService.getInstance().list(actor, request())).map((row) => row.id)).toEqual([selected.id]);
    expect(await OjApiKeyIamService.getInstance().stats(actor, request())).toEqual({
      totalKeys: 1,
      activeKeys: 1,
      totalRequests: 7,
      totalTokens: 11,
    });
  });
  it("binding revocation changes subsequent reads without a stale cache grant", async () => {
    const selected = await key(),
      binding = await bind({
        Version: "1",
        Statement: { Effect: "Allow", Action: "quyan:oj:GetApiKey", Resource: ojApiKeyArn(owner, actor, selected.id) },
      });
    expect((await OjApiKeyIamService.getInstance().get(actor, selected.id, request())).id).toBe(selected.id);
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    await expect(OjApiKeyIamService.getInstance().get(actor, selected.id, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("checks account disablement and revoked role sessions before hydration", async () => {
    const selected = await key(),
      target = (await repository.target(principal(), selected.id))!;
    await expect(
      repository.hydrate(
        { ...principal(), subjectType: "assumed_role", assumedRoleId: "role", roleSessionId: "missing" },
        [target],
        [target.id],
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(repository.hydrate(principal(), [target], [target.id])).rejects.toMatchObject({ statusCode: 403 });
  });
});
