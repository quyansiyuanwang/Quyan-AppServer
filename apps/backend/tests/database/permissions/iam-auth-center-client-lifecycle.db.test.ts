import { AuthCenterClientMutationIamService } from "@/services/users/auth-center-client-mutation-iam.service";
import { AuthCenterClientMutationRepository } from "@/store/users/auth-center-client-mutation.repository";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { AuthCenterClientService } from "@/services/users/auth-center-client.service";
import { AuthCenterClientRepository } from "@/store/users/auth-center-client.repository";
import BusinessLogService from "@/services/system/businesslog.service";
import { prisma } from "@/config/database";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode;
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
const client = async (userId: string) =>
  (
    await prisma.authCenterClient.create({
      data: {
        userId,
        name: "fixture",
        clientId: "fixture-" + randomUUID(),
        clientSecretHash: "fixture-hash-never-selected",
        clientSecretPreview: "fixture-mask",
        grantTypes: ["authorization_code"],
        scopes: ["auth_center_client"],
        redirectUris: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const arn = (id: string) => `acs:auth-center:*:${owner}:client/${actor}/${id}`;
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  foreign = await user();
  visible = await client(actor);
  hidden = await client(actor);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
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
const service = AuthCenterClientMutationIamService.getInstance(),
  mutations = AuthCenterClientMutationRepository.getInstance();
const lifecycleGrant = () =>
  bind({
    Effect: "Allow",
    Action: [
      "quyan:auth_center:RotateClientSecret",
      "quyan:auth_center:DeleteClient",
      "quyan:auth_center:SubmitClientReview",
    ],
    Resource: arn(visible),
  });
const prepare = (action: "quyan:auth_center:RotateClientSecret" | "quyan:auth_center:DeleteClient") =>
  service.prepare(action, actor, visible, request());

describe("Auth center application credential lifecycle database", () => {
  it("rotates one authorized application and never exposes old or new hashes", async () => {
    await lifecycleGrant();
    const prepared = await prepare("quyan:auth_center:RotateClientSecret");
    const result = await service.update(
      { clientSecretHash: "fixture-new-hash", clientSecretPreview: "fixture-new-preview" },
      prepared!.guard,
    );
    expect(result).toMatchObject({ id: visible, hasClientSecret: true, clientSecretPreview: "fixture-new-preview" });
    expect(result).not.toHaveProperty("clientSecretHash");
    expect((await prisma.authCenterClient.findUnique({ where: { id: visible } }))!.clientSecretHash).toBe(
      "fixture-new-hash",
    );
    expect((await prisma.authCenterClient.findUnique({ where: { id: hidden } }))!.clientSecretHash).toBe(
      "fixture-hash-never-selected",
    );
  });
  it("detail Read grants do not allow rotation or deletion", async () => {
    await bind({ Effect: "Allow", Action: "quyan:auth_center:GetClient", Resource: arn(visible) });
    for (const action of ["quyan:auth_center:RotateClientSecret", "quyan:auth_center:DeleteClient"] as const)
      await expect(prepare(action)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("explicit Deny and another user's app cannot be rotated or deleted", async () => {
    await lifecycleGrant();
    await bind({ Effect: "Deny", Action: "quyan:auth_center:RotateClientSecret", Resource: arn(visible) });
    await expect(prepare("quyan:auth_center:RotateClientSecret")).rejects.toMatchObject({ statusCode: 403 });
    for (const id of [await client(peer), await client(foreign)])
      await expect(service.prepare("quyan:auth_center:DeleteClient", actor, id, request())).rejects.toMatchObject({
        statusCode: 403,
      });
  });
  it("revokes only the authorized record and does not disclose credential hashes", async () => {
    await lifecycleGrant();
    const prepared = await prepare("quyan:auth_center:DeleteClient");
    expect(await service.revoke(prepared!.guard)).not.toHaveProperty("clientSecretHash");
    expect((await prisma.authCenterClient.findUnique({ where: { id: visible } }))!.status).toBe(-1);
    expect((await prisma.authCenterClient.findUnique({ where: { id: hidden } }))!.status).toBe(1);
    await expect(prepare("quyan:auth_center:DeleteClient")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back both secret changes and deletion on final authorization failure", async () => {
    await lifecycleGrant();
    for (const action of ["quyan:auth_center:RotateClientSecret", "quyan:auth_center:DeleteClient"] as const) {
      const prepared = await prepare(action),
        check = prepared!.guard.users.recheck;
      let calls = 0;
      prepared!.guard.users.recheck = async () => {
        await check();
        if (++calls === 2) throw new Error("fixture final deny");
      };
      await expect(
        action === "quyan:auth_center:DeleteClient"
          ? mutations.revoke(prepared!.guard)
          : mutations.update(
              { clientSecretHash: "fixture-rollback", clientSecretPreview: "fixture-rollback-preview" },
              prepared!.guard,
            ),
      ).rejects.toThrow("fixture final deny");
    }
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({
      status: 1,
      clientSecretHash: "fixture-hash-never-selected",
    });
  });
  it("rejects stale record versions and revoked grants after preparation", async () => {
    const binding = await lifecycleGrant(),
      prepared = await prepare("quyan:auth_center:RotateClientSecret");
    await prisma.authCenterClient.update({ where: { id: visible }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(
      service.update(
        { clientSecretHash: "fixture-stale", clientSecretPreview: "fixture-stale-preview" },
        prepared!.guard,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    const deletion = await prepare("quyan:auth_center:DeleteClient");
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    await expect(service.revoke(deletion!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.authCenterClient.findUnique({ where: { id: visible } }))!.status).toBe(1);
  });
  it("refuses to reuse a rotation guard to delete or edit unrelated settings", async () => {
    await lifecycleGrant();
    const prepared = await prepare("quyan:auth_center:RotateClientSecret");
    await expect(service.revoke(prepared!.guard)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.update({ name: "injected" }, prepared!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({
      status: 1,
      name: "fixture",
    });
  });
  it("submits review only on an authorized, current record", async () => {
    await lifecycleGrant();
    const bridge = AuthCenterClientService.getInstance();
    expect(await bridge.submitForReview(visible, actor, request())).toMatchObject({
      id: visible,
      reviewStatus: "pending",
    });
    expect(await prisma.authCenterClient.findUnique({ where: { id: hidden } })).toMatchObject({
      reviewStatus: "draft",
    });
    await expect(bridge.submitForReview(hidden, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(bridge.submitForReview(visible, actor, request())).rejects.toMatchObject({ statusCode: 400 });
  });
  it("rolls back review submission on the final IAM decision", async () => {
    await lifecycleGrant();
    const prepared = await service.prepare("quyan:auth_center:SubmitClientReview", actor, visible, request());
    const check = prepared!.guard.users.recheck;
    let calls = 0;
    prepared!.guard.users.recheck = async () => {
      await check();
      if (++calls === 2) throw new Error("fixture final deny");
    };
    await expect(
      service.update(
        {
          reviewStatus: "pending",
          submittedAt: new Date(),
          reviewComment: null,
          reviewedAt: null,
          reviewedByUserId: null,
        },
        prepared!.guard,
      ),
    ).rejects.toThrow("fixture final deny");
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({
      reviewStatus: "draft",
      submittedAt: null,
    });
  });
  it("returns a fresh secret once without old credentials in the response or business audit", async () => {
    await lifecycleGrant();
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
    const bridge = AuthCenterClientService.getInstance();
    const result = await bridge.regenerateSecret(visible, actor, request());
    expect(result.clientSecret).toMatch(/^atcs_/);
    expect(result).not.toHaveProperty("clientSecretHash");
    expect(JSON.stringify(audit.mock.calls)).not.toContain(result.clientSecret);
    expect(JSON.stringify(audit.mock.calls)).not.toContain("fixture-hash-never-selected");
    await bridge.deleteClient(visible, actor, request());
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({ status: -1 });
  });
  it("refuses rotation for public applications without changing credentials", async () => {
    await lifecycleGrant();
    await prisma.authCenterClient.update({
      where: { id: visible },
      data: { clientType: "public", clientSecretHash: null, clientSecretPreview: null },
    });
    await expect(
      AuthCenterClientService.getInstance().regenerateSecret(visible, actor, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({
      clientSecretHash: null,
    });
  });
  it("refuses stale account membership before writing", async () => {
    await lifecycleGrant();
    const prepared = await prepare("quyan:auth_center:DeleteClient");
    await prisma.user.update({ where: { id: actor }, data: { accountOwnerId: foreign } });
    await expect(service.revoke(prepared!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({ status: 1 });
  });
  it.each(["legacy", "shadow"] as const)("preserves existing lifecycle writes once in %s", async (mode) => {
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.AUTH_CENTER_CLIENT_UPDATE, Permission.AUTH_CENTER_CLIENT_DELETE] },
    });
    await bind({ Effect: "Deny", Action: "quyan:auth_center:*", Resource: "*" });
    env.security.iamAuthorizationMode = mode;
    const old = AuthCenterClientRepository.getInstance();
    const update = vi.spyOn(old, "update"),
      revoke = vi.spyOn(old, "delete");
    const bridge = AuthCenterClientService.getInstance();
    await bridge.submitForReview(visible, actor, request());
    await bridge.deleteClient(visible, actor, request());
    expect(update).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledTimes(1);
  });
  it("refuses a revoked assumed-role session before committing deletion", async () => {
    const authorization = await lifecycleGrant();
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "fixture-role-" + randomUUID() } });
    await prisma.ramAuthorization.update({
      where: { id: authorization.id },
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
    });
    const req = request();
    Object.assign(req.authContext!, { assumedRoleId: role.id, roleSessionId: session.id });
    const prepared = await service.prepare("quyan:auth_center:DeleteClient", actor, visible, req);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.revoke(prepared!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({ status: 1 });
  });
  it("refuses a bearer token revoked after preparing rotation", async () => {
    await lifecycleGrant();
    const login = await prisma.oAuthClient.create({
      data: {
        userId: actor,
        name: "fixture login",
        clientId: "login-" + randomUUID(),
        reviewStatus: "approved",
        grantTypes: ["authorization_code"],
        scopes: ["auth_center_client"],
        redirectUris: [],
      },
    });
    const token = await prisma.oAuthAccessToken.create({
      data: {
        userId: actor,
        oauthClientId: login.id,
        tokenHash: "fixture-" + randomUUID(),
        scopes: ["auth_center_client"],
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    req.oauthAccessToken = {
      id: token.id,
      oauthClientId: login.id,
      userId: actor,
      scopes: ["auth_center_client"],
      expiresAt: token.expiresAt.toISOString(),
    } as any;
    const prepared = await service.prepare("quyan:auth_center:RotateClientSecret", actor, visible, req);
    await prisma.oAuthAccessToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    await expect(
      service.update({ clientSecretHash: "fixture-new", clientSecretPreview: "fixture-preview" }, prepared!.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({
      clientSecretHash: "fixture-hash-never-selected",
    });
  });
});
