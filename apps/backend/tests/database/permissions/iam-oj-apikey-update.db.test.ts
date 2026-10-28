import { OjApiKeyMutationIamService } from "@/services/oj-submitter/oj-apikey-mutation-iam.service";
import { OjApiKeyMutationRepository } from "@/store/oj-submitter/oj-apikey-mutation.repository";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { ojApiKeyArn } from "@/iam/resources/oj-apikey-resources";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, peer: string, foreign: string;

const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "oj-update-" + randomUUID(),
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
const key = (userId = actor) =>
  prisma.oJAPIKey.create({ data: { userId, name: "fixture", key: "fixture-only-" + randomUUID() } });
async function bind(document: unknown) {
  const parsed = parseIamPolicy(document),
    policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "oj-update-" + randomUUID(),
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
const grant = (id: string, action = "quyan:oj:UpdateApiKey") =>
  bind({ Version: "1", Statement: { Effect: "Allow", Action: action, Resource: ojApiKeyArn(owner, actor, id) } });
describe("transactional OJ API Key updates", () => {
  it("updates authorized metadata without returning the stored credential or full channel config", async () => {
    const selected = await key();
    await grant(selected.id);
    const updated = await service.update(selected.id, actor, { name: "new", expiresAt: null }, request());
    expect(updated.name).toBe("new");
    expect(updated.key).toBeUndefined();
    expect(updated.channel).toBeNull();
    expect((await prisma.oJAPIKey.findUnique({ where: { id: selected.id } }))?.key).toBe(selected.key);
  });
  it("returns the credential only under its independent Reveal grant, and Deny removes disclosure", async () => {
    const selected = await key();
    await grant(selected.id);
    await grant(selected.id, "quyan:oj:RevealApiKey");
    expect((await service.update(selected.id, actor, { name: "new" }, request())).key).toBe(selected.key);
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: "quyan:oj:RevealApiKey", Resource: ojApiKeyArn(owner, actor, selected.id) },
    });
    expect((await service.update(selected.id, actor, { name: "newer" }, request())).key).toBeUndefined();
  });
  it("does not permit other users' keys even with wildcard IAM", async () => {
    const selected = await key(peer),
      outside = await key(foreign);
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "quyan:oj:UpdateApiKey", Resource: "*" } });
    for (const id of [selected.id, outside.id])
      await expect(service.update(id, actor, { name: "spoofed" }, request())).rejects.toMatchObject({
        statusCode: 403,
      });
    expect((await prisma.oJAPIKey.findUnique({ where: { id: selected.id } }))?.name).toBe("fixture");
  });
  it("refuses policy revocation and target/user revision changes after preparation", async () => {
    const selected = await key(),
      binding = await grant(selected.id),
      prepared = await service.prepareUpdate(selected.id, actor, { name: "new" }, request());
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    await expect(repository.update(prepared.data, prepared.guard)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: 1 } });
    await prisma.oJAPIKey.update({ where: { id: selected.id }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(repository.update(prepared.data, prepared.guard)).rejects.toMatchObject({ statusCode: 403 });
    const fresh = await service.prepareUpdate(selected.id, actor, { name: "new" }, request());
    await prisma.user.update({ where: { id: actor }, data: { updateTime: new Date(Date.now() + 2000) } });
    await expect(repository.update(fresh.data, fresh.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.oJAPIKey.findUnique({ where: { id: selected.id } }))?.name).toBe("fixture");
  });
  it("reads only channel selection metadata and rechecks the channel before binding", async () => {
    const selected = await key();
    await grant(selected.id);
    const channel = await prisma.relayChannel.create({
      data: {
        name: "update-channel-" + randomUUID(),
        openaiUpstreamApiKey: "fixture-private",
        routingConfig: { private: "fixture" },
      },
    });
    const metadata = (await RelayChannelRepository.getInstance().findVisibleSelectionMetadataById(channel.id))!;
    expect(Object.keys(metadata).sort()).toEqual(
      ["id", "name", "status", "updateTime", "visibilityMode", "visibilityConfig", "channelType"].sort(),
    );
    const prepared = await service.prepareUpdate(selected.id, actor, { channelId: channel.id }, request());
    await prisma.relayChannel.update({ where: { id: channel.id }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(repository.update(prepared.data, prepared.guard)).rejects.toMatchObject({ statusCode: 403 });
    const updated = await service.update(selected.id, actor, { channelId: channel.id }, request());
    expect(updated.channel).toEqual({ name: channel.name });
    expect(JSON.stringify(updated)).not.toContain("fixture-private");
    expect((await service.update(selected.id, actor, { channelId: null }, request())).channel).toBeNull();
  });
  it("preserves hidden/private channel and automatic-pool selection restrictions", async () => {
    const selected = await key();
    await grant(selected.id);
    for (const data of [
      { visibilityMode: "private" },
      { visibilityMode: "hidden" },
      { channelType: "automatic-proxy-pool" },
    ]) {
      const channel = await prisma.relayChannel.create({ data: { name: "restricted-" + randomUUID(), ...data } });
      await expect(service.update(selected.id, actor, { channelId: channel.id }, request())).rejects.toBeDefined();
    }
    expect((await prisma.oJAPIKey.findUnique({ where: { id: selected.id } }))?.channelId).toBeNull();
  });
  it("rolls back a metadata update if the final permission recheck fails", async () => {
    const selected = await key();
    await grant(selected.id);
    const prepared = await service.prepareUpdate(selected.id, actor, { name: "new" }, request()),
      check = prepared.guard.identity.recheck;
    let checks = 0;
    prepared.guard.identity.recheck = async () => {
      if (++checks === 2) throw new Error("fixture denied");
      await check();
    };
    await expect(repository.update(prepared.data, prepared.guard)).rejects.toThrow("fixture denied");
    expect((await prisma.oJAPIKey.findUnique({ where: { id: selected.id } }))?.name).toBe("fixture");
  });
});
