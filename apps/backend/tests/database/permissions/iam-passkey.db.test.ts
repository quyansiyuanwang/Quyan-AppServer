import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { PasskeyManagementRepository } from "@/store/auth/passkey-management.repository";
import { PasskeyCredentialRepository } from "@/store/auth/passkey-credential.repository";
import { PasskeyIamService } from "@/services/auth/passkey-iam.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { passkeyArn } from "@/iam/resources/passkey-resources";
import { passkeyResourceResolver } from "@/iam/request/passkey-resource-resolvers";
import type { TypedRequest } from "@/types/express";
import type { IamPrincipal } from "@quyan/shared";
const repository = PasskeyManagementRepository.getInstance();
let owner: string, actor: string, peer: string, foreign: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "passkey-fixture-" + randomUUID(),
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
const principal = (accountOwnerId = owner, subjectUserId = actor): IamPrincipal => ({
  subjectUserId,
  principalUserId: subjectUserId,
  accountOwnerId,
  subjectType: "sub_user",
});
const credential = (userId = actor) =>
  prisma.passkeyCredential.create({
    data: {
      userId,
      credentialId: "webauthn-" + randomUUID(),
      publicKey: Buffer.from("fixture-key-material"),
      name: "fixture",
    },
  });
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    params: {},
    headers: {},
  }) as unknown as TypedRequest;
async function bind(document: unknown) {
  const parsed = parseIamPolicy(document);
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "passkey-policy-" + randomUUID(),
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
describe("Passkey storage and policy boundaries", () => {
  it("scans only scoped metadata, and neither management nor legacy listing loads key material", async () => {
    const selected = await credential();
    await credential(peer);
    const rows = await repository.scan(principal());
    expect(rows.map((r) => r.id)).toEqual([selected.id]);
    for (const row of rows) {
      expect(row).not.toHaveProperty("publicKey");
      expect(row).not.toHaveProperty("credentialId");
      expect(row).not.toHaveProperty("name");
      expect(row).not.toHaveProperty("counter");
    }
    const views = await repository.hydrate(principal(), rows);
    expect(views[0].credentialId).toBe(selected.credentialId);
    expect(views[0]).not.toHaveProperty("publicKey");
    const legacy = await PasskeyCredentialRepository.getInstance().listByUserId(actor);
    expect(legacy[0]).not.toHaveProperty("publicKey");
    expect(legacy[0]).not.toHaveProperty("counter");
    expect(await repository.target(principal(owner, peer), selected.credentialId)).toBeNull();
    await expect(repository.scan(principal(foreign))).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses persisted ARN identity and validates real resource-group account ownership", async () => {
    const selected = await credential(),
      req = request();
    req.params.credentialId = selected.credentialId;
    expect(await passkeyResourceResolver({ request: req, principal: principal() })).toBe(
      passkeyArn(owner, actor, selected.id),
    );
    const groups = RamResourceGroupRepository.getInstance();
    expect(await groups.resourceExistsInAccount(passkeyArn(owner, actor, selected.id), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(passkeyArn(owner, peer, selected.id), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(passkeyArn(foreign, actor, selected.id), foreign)).toBe(false);
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    expect(await groups.resourceExistsInAccount(passkeyArn(owner, actor, selected.id), owner)).toBe(false);
    await expect(repository.target(principal(), selected.credentialId)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not hydrate or delete stale credentials after a concurrent change", async () => {
    const selected = await credential(),
      target = (await repository.target(principal(), selected.credentialId))!;
    await prisma.passkeyCredential.update({
      where: { id: selected.id },
      data: { name: "changed", updateTime: new Date(target.updateTime.getTime() + 1_000) },
    });
    expect(await repository.hydrate(principal(), [target])).toEqual([]);
    await expect(repository.revoke(principal(), target)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.passkeyCredential.findUnique({ where: { id: selected.id } })).not.toBeNull();
    await repository.revoke(principal(), (await repository.target(principal(), selected.credentialId))!);
    expect(await prisma.passkeyCredential.findUnique({ where: { id: selected.id } })).toBeNull();
  });
  it("checks user and account revisions when committing registration", async () => {
    const snapshot = await repository.actor(principal());
    const data = { userId: actor, credentialId: "fresh-" + randomUUID(), publicKey: Buffer.from("fixture-only") };
    await expect(repository.create(principal(), snapshot, { ...data, userId: peer })).rejects.toMatchObject({
      statusCode: 403,
    });
    await prisma.user.update({
      where: { id: owner },
      data: { name: "changed", updateTime: new Date(snapshot.ownerUpdateTime.getTime() + 1_000) },
    });
    await expect(repository.create(principal(), snapshot, data)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.passkeyCredential.count({ where: { credentialId: data.credentialId } })).toBe(0);
    await repository.create(principal(), await repository.actor(principal()), data);
    expect(await prisma.passkeyCredential.count({ where: { credentialId: data.credentialId } })).toBe(1);
  });
  it("rejects disabled actors or accounts before deletion", async () => {
    const selected = await credential(),
      target = (await repository.target(principal(), selected.credentialId))!;
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(repository.revoke(principal(), target)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.passkeyCredential.findUnique({ where: { id: selected.id } })).not.toBeNull();
  });
  it("filters exact ARN grants and explicit Deny, then immediately observes authorization revocation", async () => {
    const selected = await credential(),
      denied = await credential(),
      hidden = await credential();
    const binding = await bind({
      Version: "1",
      Statement: [
        {
          Effect: "Allow",
          Action: ["quyan:auth:ListPasskeys", "quyan:auth:DeletePasskey"],
          Resource: [passkeyArn(owner, actor, selected.id), passkeyArn(owner, actor, denied.id)],
        },
        { Effect: "Deny", Action: "quyan:auth:*", Resource: passkeyArn(owner, actor, denied.id) },
      ],
    });
    expect((await PasskeyIamService.getInstance().list(actor, request())).map((r) => r.id)).toEqual([selected.id]);
    await expect(PasskeyIamService.getInstance().revoke(actor, denied.credentialId, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(PasskeyIamService.getInstance().revoke(actor, hidden.credentialId, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    expect(await PasskeyIamService.getInstance().list(actor, request())).toEqual([]);
    await expect(PasskeyIamService.getInstance().revoke(actor, selected.credentialId, request())).rejects.toMatchObject(
      { statusCode: 403 },
    );
    expect(await prisma.passkeyCredential.count({ where: { userId: actor } })).toBe(3);
  });
  it("requires explicit registration grants and never maps credential scope to user scope", async () => {
    const selected = await credential();
    await bind({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:auth:ListPasskeys",
        Resource: passkeyArn(owner, actor, selected.id),
      },
    });
    await expect(
      PasskeyIamService.getInstance().authorizeRegistration(actor, "quyan:auth:RegisterPasskey", request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    await bind({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:auth:RegisterPasskey",
        Resource: "acs:quyan:*:" + owner + ":user/" + actor,
      },
    });
    expect(
      (await PasskeyIamService.getInstance().authorizeRegistration(actor, "quyan:auth:RegisterPasskey", request()))
        .snapshot.id,
    ).toBe(actor);
  });
});
