import { OAuthClientMutationIamService } from "@/services/users/oauth-client-mutation-iam.service";
import { OAuthClientMutationRepository } from "@/store/users/oauth-client-mutation.repository";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { OAuthClientIamService } from "@/services/users/oauth-client-iam.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, peer: string, foreign: string, visible: string, hidden: string;
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
const client = async (userId: string, isSystemClient = false) =>
  (
    await prisma.oAuthClient.create({
      data: {
        userId,
        name: "fixture",
        clientId: "fixture-" + randomUUID(),
        clientSecretHash: "fixture-hash-never-selected",
        clientSecretPreview: "fixture-mask",
        grantTypes: ["authorization_code"],
        scopes: ["oauth_client"],
        redirectUris: [],
        isSystemClient,
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
const arn = (id: string) => `acs:oauth:*:${owner}:client/${actor}/${id}`;
const reads = OAuthClientIamService.getInstance();
beforeEach(async () => {
  vi.restoreAllMocks();
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  foreign = await user();
  visible = await client(actor);
  hidden = await client(actor);
});
async function bind(statements: unknown, scope?: { group: string }) {
  const parsed = parseIamPolicy({ Version: "1", Statement: statements });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "oauth-read-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  return prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: scope ? "resource-group" : "account",
      scopeResourceId: scope?.group,
      scopeKey: scope ? "resource-group:" + scope.group : "account",
      createdBy: owner,
    },
  });
}
const readGrant = () =>
  bind({ Effect: "Allow", Action: ["quyan:oauth:ListClients", "quyan:oauth:GetClient"], Resource: arn(visible) });
const service = OAuthClientMutationIamService.getInstance(),
  mutations = OAuthClientMutationRepository.getInstance();
const writeGrant = () =>
  bind({
    Effect: "Allow",
    Action: ["quyan:oauth:UpdateClient", "quyan:oauth:SubmitClientReview"],
    Resource: arn(visible),
  });
const prepare = () => service.prepare("quyan:oauth:UpdateClient", actor, visible, request());
describe("OAuth application writes database", () => {
  it("authorizes a selected app update without exposing hashes or needing read permissions", async () => {
    await writeGrant();
    const prepared = await prepare();
    const updated = await service.update({ name: "updated" }, prepared!.guard);
    expect(updated).toMatchObject({ id: visible, name: "updated", hasClientSecret: true });
    expect(updated).not.toHaveProperty("clientSecretHash");
    await expect(reads.get(actor, visible, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.prepare("quyan:oauth:UpdateClient", actor, hidden, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("read grants and explicit Deny cannot mutate applications", async () => {
    await readGrant();
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    await writeGrant();
    await bind({ Effect: "Deny", Action: "quyan:oauth:UpdateClient", Resource: arn(visible) });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.oAuthClient.findUnique({ where: { id: visible } }))!.name).toBe("fixture");
  });
  it("rolls back writes after policy or account membership changes", async () => {
    const binding = await writeGrant(),
      prepared = await prepare();
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    await expect(service.update({ name: "denied" }, prepared!.guard)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: 1 } });
    const membership = await prepare();
    await prisma.user.update({ where: { id: actor }, data: { accountOwnerId: foreign } });
    await expect(service.update({ name: "foreign" }, membership!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.oAuthClient.findUnique({ where: { id: visible } }))!.name).toBe("fixture");
  });
  it("rejects concurrent resource changes and platform resource spoofing", async () => {
    await writeGrant();
    const prepared = await prepare();
    await prisma.oAuthClient.update({
      where: { id: visible },
      data: { name: "concurrent", updateTime: new Date(Date.now() + 1000) },
    });
    await expect(service.update({ name: "stale" }, prepared!.guard)).rejects.toMatchObject({ statusCode: 403 });
    for (const id of [await client(peer), await client(foreign), await client(actor, true)])
      await expect(service.prepare("quyan:oauth:UpdateClient", actor, id, request())).rejects.toMatchObject({
        statusCode: 403,
      });
    expect((await prisma.oAuthClient.findUnique({ where: { id: visible } }))!.name).toBe("concurrent");
  });
  it("rolls back if final authorization or scope grantability fails", async () => {
    await writeGrant();
    const prepared = await prepare(),
      check = prepared!.guard.users.recheck;
    let checks = 0;
    prepared!.guard.users.recheck = async () => {
      await check();
      if (++checks === 2) throw new Error("fixture final denial");
    };
    await expect(mutations.update({ name: "rollback" }, prepared!.guard)).rejects.toThrow("fixture final denial");
    const scopes = await prepare();
    let scopeChecks = 0;
    scopes!.guard.scopeCheck = async () => {
      if (++scopeChecks === 2) throw new Error("fixture scope revoked");
    };
    await expect(mutations.update({ scopes: ["profile"] }, scopes!.guard)).rejects.toThrow("fixture scope revoked");
    const stored = await prisma.oAuthClient.findUnique({ where: { id: visible } });
    expect(stored!.name).toBe("fixture");
    expect(stored!.scopes).toEqual(["oauth_client"]);
  });
  it("requires a separate action for review submission", async () => {
    await bind({ Effect: "Allow", Action: "quyan:oauth:UpdateClient", Resource: arn(visible) });
    await expect(service.prepare("quyan:oauth:SubmitClientReview", actor, visible, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await bind({ Effect: "Allow", Action: "quyan:oauth:SubmitClientReview", Resource: arn(visible) });
    const prepared = await service.prepare("quyan:oauth:SubmitClientReview", actor, visible, request());
    expect(await service.update({ reviewStatus: "pending", submittedAt: new Date() }, prepared!.guard)).toMatchObject({
      id: visible,
      reviewStatus: "pending",
    });
  });
  it("checks revoked OAuth credentials inside the transaction before committing", async () => {
    await writeGrant();
    const login = await client(actor);
    await prisma.oAuthClient.update({ where: { id: login }, data: { reviewStatus: "approved" } });
    const token = await prisma.oAuthAccessToken.create({
      data: {
        userId: actor,
        oauthClientId: login,
        tokenHash: "fixture-" + randomUUID(),
        scopes: ["oauth_client"],
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    req.oauthAccessToken = {
      id: token.id,
      oauthClientId: login,
      userId: actor,
      scopes: ["oauth_client"],
      expiresAt: token.expiresAt.toISOString(),
    } as any;
    const prepared = await service.prepare("quyan:oauth:UpdateClient", actor, visible, req);
    await prisma.oAuthAccessToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    await expect(service.update({ name: "revoked" }, prepared!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.oAuthClient.findUnique({ where: { id: visible } }))!.name).toBe("fixture");
  });
});
