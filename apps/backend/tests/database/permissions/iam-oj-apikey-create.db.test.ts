import { OjApiKeyMutationIamService } from "@/services/oj-submitter/oj-apikey-mutation-iam.service";
import { OjApiKeyMutationRepository } from "@/store/oj-submitter/oj-apikey-mutation.repository";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, peer: string, foreign: string;

const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "oj-create-" + randomUUID(),
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
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
async function bind(document: unknown) {
  const parsed = parseIamPolicy(document),
    policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "oj-create-" + randomUUID(),
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
const service = OjApiKeyMutationIamService.getInstance(),
  repository = OjApiKeyMutationRepository.getInstance();
const grant = () =>
  bind({
    Version: "1",
    Statement: {
      Effect: "Allow",
      Action: "quyan:oj:CreateApiKey",
      Resource: "acs:quyan:*:" + owner + ":user/" + actor,
    },
  });
const create = (input = {}, req = request()) => service.create(actor, input, "fixture-new-" + randomUUID(), req);
describe("transactional OJ API Key issuance", () => {
  it("issues one fresh credential on the authorized subject and returns only channel display metadata", async () => {
    await grant();
    const existing = await prisma.oJAPIKey.create({
        data: { userId: actor, key: "fixture-existing-private-" + randomUUID() },
      }),
      channel = await prisma.relayChannel.create({
        data: { name: "issue-" + randomUUID(), openaiUpstreamApiKey: "fixture-upstream-private" },
      });
    const result = await create({ name: "fresh", channelId: channel.id });
    expect(result.userId).toBe(actor);
    expect(result.key).not.toBe(existing.key);
    expect(result.channel).toEqual({ name: channel.name });
    expect(JSON.stringify(result)).not.toContain("fixture-upstream-private");
    expect(await prisma.oJAPIKey.count({ where: { userId: actor } })).toBe(2);
  });
  it("explicit Deny blocks issuance without leaving a key row", async () => {
    await grant();
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:oj:CreateApiKey",
        Resource: "acs:quyan:*:" + owner + ":user/" + actor,
      },
    });
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.oJAPIKey.count({ where: { userId: actor } })).toBe(0);
  });
  it("cannot issue a credential on behalf of another account or user", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "quyan:oj:CreateApiKey", Resource: "*" } });
    for (const id of [peer, foreign])
      await expect(service.create(id, {}, "fixture-unused", request())).rejects.toMatchObject({ statusCode: 403 });
    const req = request();
    req.authContext!.accountOwnerId = foreign;
    await expect(create({}, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.oJAPIKey.count({ where: { userId: { in: [actor, peer, foreign] } } })).toBe(0);
  });
  it("refuses stale user, owner and authorization state before creating keys", async () => {
    const binding = await grant(),
      prepared = await service.prepareCreate(actor, {}, request());
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    await expect(repository.create({ userId: actor, key: "fixture-revoked" }, prepared.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: 1 } });
    await prisma.user.update({ where: { id: owner }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(
      repository.create({ userId: actor, key: "fixture-stale-owner" }, prepared.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.oJAPIKey.count({ where: { userId: actor } })).toBe(0);
  });
  it("rolls back the new key when a final permission check fails", async () => {
    await grant();
    const prepared = await service.prepareCreate(actor, {}, request()),
      check = prepared.guard.identity.recheck;
    let count = 0;
    prepared.guard.identity.recheck = async () => {
      if (++count === 2) throw new Error("fixture denied");
      await check();
    };
    await expect(repository.create({ userId: actor, key: "fixture-rollback" }, prepared.guard)).rejects.toThrow(
      "fixture denied",
    );
    expect(await prisma.oJAPIKey.count({ where: { userId: actor } })).toBe(0);
  });
  it("rechecks channel snapshots and rejects inaccessible or automatic channels", async () => {
    await grant();
    const channel = await prisma.relayChannel.create({ data: { name: "issue-snapshot-" + randomUUID() } }),
      prepared = await service.prepareCreate(actor, { channelId: channel.id }, request());
    await prisma.relayChannel.update({ where: { id: channel.id }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(
      repository.create({ userId: actor, channelId: channel.id, key: "fixture-stale-channel" }, prepared.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    for (const data of [
      { visibilityMode: "private" },
      { visibilityMode: "hidden" },
      { channelType: "automatic-proxy-pool" },
    ]) {
      const restricted = await prisma.relayChannel.create({
        data: { name: "issue-restricted-" + randomUUID(), ...data },
      });
      await expect(create({ channelId: restricted.id })).rejects.toBeDefined();
    }
    expect(await prisma.oJAPIKey.count({ where: { userId: actor } })).toBe(0);
  });
  it("cannot commit an issuance after the role session is revoked", async () => {
    const binding = await grant(),
      role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "issue-role-" + randomUUID() } });
    await prisma.ramAuthorization.update({
      where: { id: binding.id },
      data: { principalType: "role", principalId: role.id },
    });
    const session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: owner,
          subjectUserId: actor,
          roleId: role.id,
          sessionName: "fixture",
          expiresAt: new Date(Date.now() + 60000),
        },
      }),
      req = request();
    req.authContext = { ...req.authContext!, assumedRoleId: role.id, roleSessionId: session.id };
    const prepared = await service.prepareCreate(actor, {}, req);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(
      repository.create({ userId: actor, key: "fixture-expired-session" }, prepared.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.oJAPIKey.count({ where: { userId: actor } })).toBe(0);
  });
});
