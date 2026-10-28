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
        redirectUris: ["https://fixture.example.test/callback"],
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
const bridge = AuthCenterClientService.getInstance();
const grant = () => bind({ Effect: "Allow", Action: "quyan:auth_center:UpdateClient", Resource: arn(visible) });
const prepare = () => service.prepare("quyan:auth_center:UpdateClient", actor, visible, request());
describe("auth center client configuration updates database", () => {
  it("updates an authorized application without requiring read grants or querying hashes", async () => {
    await grant();
    const legacy = vi.spyOn(AuthCenterClientRepository.getInstance(), "update");
    const query = vi.spyOn(prisma.authCenterClient, "findMany");
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
    expect(
      await bridge.updateClient(visible, actor, { name: "  updated  ", description: "fixture description" }, request()),
    ).toMatchObject({ id: visible, name: "updated", description: "fixture description", hasClientSecret: true });
    expect(legacy).not.toHaveBeenCalled();
    for (const [args] of query.mock.calls) expect(args?.select).not.toHaveProperty("clientSecretHash");
    expect(JSON.stringify(audit.mock.calls)).not.toContain("fixture-hash-never-selected");
    expect(await prisma.authCenterClient.findUnique({ where: { id: hidden } })).toMatchObject({ name: "fixture" });
    await expect(bridge.getClient(visible, actor, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("resets approved or rejected application reviews only after a real configuration edit", async () => {
    await grant();
    await prisma.authCenterClient.update({
      where: { id: visible },
      data: {
        reviewStatus: "approved",
        reviewComment: "fixture review",
        reviewedByUserId: owner,
        reviewedAt: new Date(),
      },
    });
    expect(await bridge.updateClient(visible, actor, {}, request())).toMatchObject({ reviewStatus: "approved" });
    expect(await bridge.updateClient(visible, actor, { name: "updated" }, request())).toMatchObject({
      reviewStatus: "draft",
    });
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({
      reviewComment: null,
      reviewedAt: null,
      reviewedByUserId: null,
    });
  });
  it("clears credentials when changing to a public client and preserves omitted settings", async () => {
    await grant();
    expect(await bridge.updateClient(visible, actor, { clientType: "public" }, request())).toMatchObject({
      clientType: "public",
      isPkceRequired: true,
      hasClientSecret: false,
    });
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({
      clientSecretHash: null,
      clientSecretPreview: null,
      grantTypes: ["authorization_code"],
    });
  });
  it.each([
    { userId: "peer" },
    { reviewStatus: "approved" },
    { clientSecretHash: "injected" },
    { status: -1 },
    { refreshTokenLifetime: 1 },
  ])("rejects invalid or injected application input %j", async (data) => {
    await grant();
    await expect(bridge.updateClient(visible, actor, data as any, request())).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({
      name: "fixture",
      status: 1,
      reviewStatus: "draft",
    });
  });
  it("enforces public-client PKCE and rejects credential grants before writing", async () => {
    await grant();
    await expect(
      bridge.updateClient(visible, actor, { clientType: "public", grantTypes: ["client_credentials"] }, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({
      clientType: "confidential",
    });
    expect(
      await bridge.updateClient(visible, actor, { clientType: "public", isPkceRequired: false }, request()),
    ).toMatchObject({ clientType: "public", isPkceRequired: true });
  });
  it("cannot edit peers, other accounts or Denied records", async () => {
    await bind({ Effect: "Allow", Action: "quyan:auth_center:UpdateClient", Resource: "*" });
    for (const id of [await client(peer), await client(foreign)])
      await expect(bridge.updateClient(id, actor, { name: "injected" }, request())).rejects.toMatchObject({
        statusCode: 403,
      });
    await bind({ Effect: "Deny", Action: "quyan:auth_center:UpdateClient", Resource: arn(visible) });
    await expect(bridge.updateClient(visible, actor, { name: "denied" }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rolls back a configuration edit on final policy denial or revoked scope grantability", async () => {
    await grant();
    const prepared = await prepare(),
      check = prepared!.guard.users.recheck;
    let calls = 0;
    prepared!.guard.users.recheck = async () => {
      await check();
      if (++calls === 2) throw new Error("fixture final deny");
    };
    await expect(mutations.update({ name: "rollback" }, prepared!.guard)).rejects.toThrow("fixture final deny");
    const scopes = await prepare();
    let scopeCalls = 0;
    scopes!.guard.scopeCheck = async () => {
      if (++scopeCalls === 2) throw new Error("fixture scope revoked");
    };
    await expect(mutations.update({ scopes: ["profile"] }, scopes!.guard)).rejects.toThrow("fixture scope revoked");
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({
      name: "fixture",
      scopes: ["auth_center_client"],
    });
  });
  it("cannot inject approval, raw credentials or unchecked scopes through an update guard", async () => {
    await grant();
    const prepared = await prepare();
    for (const patch of [
      { reviewStatus: "approved" },
      { clientSecretHash: "injected" },
      { scopes: ["email"] },
      { status: -1 },
    ])
      await expect(mutations.update(patch as any, prepared!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({
      reviewStatus: "draft",
      status: 1,
    });
  });
  it("rechecks the actual application version and current account membership", async () => {
    await grant();
    const prepared = await prepare();
    await prisma.authCenterClient.update({
      where: { id: visible },
      data: { name: "concurrent", updateTime: new Date(Date.now() + 1000) },
    });
    await expect(mutations.update({ name: "stale" }, prepared!.guard)).rejects.toMatchObject({ statusCode: 403 });
    const membership = await prepare();
    await prisma.user.update({ where: { id: actor }, data: { accountOwnerId: foreign } });
    await expect(mutations.update({ name: "foreign" }, membership!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({ name: "concurrent" });
  });
  it("checks requested scopes against the assumed role rather than the user's broader grants", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.USER_UPDATE_SELF_EMAIL] } });
    const authorization = await grant();
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
    await expect(bridge.updateClient(visible, actor, { scopes: ["email"] }, req)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await bridge.updateClient(visible, actor, { scopes: ["profile"] }, req)).toMatchObject({
      scopes: ["profile"],
    });
  });
  it.each(["legacy", "shadow"] as const)("preserves legacy editing once in %s", async (mode) => {
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.AUTH_CENTER_CLIENT_UPDATE] },
    });
    await bind({ Effect: "Deny", Action: "quyan:auth_center:UpdateClient", Resource: "*" });
    env.security.iamAuthorizationMode = mode;
    const old = vi.spyOn(AuthCenterClientRepository.getInstance(), "update");
    expect(await bridge.updateClient(visible, actor, { name: "legacy" }, request())).toMatchObject({ name: "legacy" });
    expect(old).toHaveBeenCalledTimes(1);
  });
});
