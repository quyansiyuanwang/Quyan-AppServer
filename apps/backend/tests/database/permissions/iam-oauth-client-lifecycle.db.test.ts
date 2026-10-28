import { OAuthClientMutationIamService } from "@/services/users/oauth-client-mutation-iam.service";
import { OAuthClientMutationRepository } from "@/store/users/oauth-client-mutation.repository";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
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
const service = OAuthClientMutationIamService.getInstance(),
  mutations = OAuthClientMutationRepository.getInstance();
const lifecycleGrant = () =>
  bind({
    Effect: "Allow",
    Action: ["quyan:oauth:RotateClientSecret", "quyan:oauth:DeleteClient"],
    Resource: arn(visible),
  });
const prepare = (action: "quyan:oauth:RotateClientSecret" | "quyan:oauth:DeleteClient") =>
  service.prepare(action, actor, visible, request());

describe("OAuth application credential lifecycle database", () => {
  it("rotates one authorized application and never exposes old or new hashes", async () => {
    await lifecycleGrant();
    const prepared = await prepare("quyan:oauth:RotateClientSecret");
    const result = await service.update(
      { clientSecretHash: "fixture-new-hash", clientSecretPreview: "fixture-new-preview" },
      prepared!.guard,
    );
    expect(result).toMatchObject({ id: visible, hasClientSecret: true, clientSecretPreview: "fixture-new-preview" });
    expect(result).not.toHaveProperty("clientSecretHash");
    expect((await prisma.oAuthClient.findUnique({ where: { id: visible } }))!.clientSecretHash).toBe(
      "fixture-new-hash",
    );
    expect((await prisma.oAuthClient.findUnique({ where: { id: hidden } }))!.clientSecretHash).toBe(
      "fixture-hash-never-selected",
    );
  });
  it("ordinary UpdateClient grants do not allow rotation or deletion", async () => {
    await bind({ Effect: "Allow", Action: "quyan:oauth:UpdateClient", Resource: arn(visible) });
    for (const action of ["quyan:oauth:RotateClientSecret", "quyan:oauth:DeleteClient"] as const)
      await expect(prepare(action)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("explicit Deny and another user's app cannot be rotated or deleted", async () => {
    await lifecycleGrant();
    await bind({ Effect: "Deny", Action: "quyan:oauth:RotateClientSecret", Resource: arn(visible) });
    await expect(prepare("quyan:oauth:RotateClientSecret")).rejects.toMatchObject({ statusCode: 403 });
    for (const id of [await client(peer), await client(foreign), await client(actor, true)])
      await expect(service.prepare("quyan:oauth:DeleteClient", actor, id, request())).rejects.toMatchObject({
        statusCode: 403,
      });
  });
  it("revokes only the authorized record and does not disclose credential hashes", async () => {
    await lifecycleGrant();
    const prepared = await prepare("quyan:oauth:DeleteClient");
    expect(await service.revoke(prepared!.guard)).not.toHaveProperty("clientSecretHash");
    expect((await prisma.oAuthClient.findUnique({ where: { id: visible } }))!.status).toBe(-1);
    expect((await prisma.oAuthClient.findUnique({ where: { id: hidden } }))!.status).toBe(1);
    await expect(prepare("quyan:oauth:DeleteClient")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back both secret changes and deletion on final authorization failure", async () => {
    await lifecycleGrant();
    for (const action of ["quyan:oauth:RotateClientSecret", "quyan:oauth:DeleteClient"] as const) {
      const prepared = await prepare(action),
        check = prepared!.guard.users.recheck;
      let calls = 0;
      prepared!.guard.users.recheck = async () => {
        await check();
        if (++calls === 2) throw new Error("fixture final deny");
      };
      await expect(
        action === "quyan:oauth:DeleteClient"
          ? mutations.revoke(prepared!.guard)
          : mutations.update({ clientSecretHash: "fixture-rollback" }, prepared!.guard),
      ).rejects.toThrow("fixture final deny");
    }
    expect(await prisma.oAuthClient.findUnique({ where: { id: visible } })).toMatchObject({
      status: 1,
      clientSecretHash: "fixture-hash-never-selected",
    });
  });
  it("rejects stale record versions and revoked grants after preparation", async () => {
    const binding = await lifecycleGrant(),
      prepared = await prepare("quyan:oauth:RotateClientSecret");
    await prisma.oAuthClient.update({ where: { id: visible }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.update({ clientSecretHash: "fixture-stale" }, prepared!.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    const deletion = await prepare("quyan:oauth:DeleteClient");
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    await expect(service.revoke(deletion!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.oAuthClient.findUnique({ where: { id: visible } }))!.status).toBe(1);
  });
});
