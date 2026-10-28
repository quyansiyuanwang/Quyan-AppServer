import { AsyncResource } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { DeveloperProjectManagementService } from "@/services/developer/developer-project-management.service";
import { DeveloperProjectController } from "@/api/controllers/v1/developer/developer-project.controller";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { developerProjectApiKeyArn } from "@/iam/resources/developer-resources";
import { DeveloperProjectRepository } from "@/store/developer/developer-project.repository";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const service = DeveloperProjectManagementService.getInstance();
const controller = new DeveloperProjectController();
const ram = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string;
const arn = (projectId: string, id: string) => developerProjectApiKeyArn(owner, projectId, id);
const run = <T>(operation: (request: TypedRequest) => Promise<T>, auth = {}) =>
  new AsyncResource("project-key-iam-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId: actor },
      params: {},
      body: {},
      headers: { "x-action": "quyan:developer:GetProject", "x-account-id": foreign },
      ip: "127.0.0.1",
      secure: true,
      authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user", ...auth },
    } as unknown as TypedRequest;
    setRequestContext(request);
    return operation(request);
  });
const project = (userId = actor, createTime = new Date()) =>
  prisma.developerProject.create({
    data: {
      userId,
      name: "Project fixture " + randomUUID(),
      slug: "project-key-iam-" + randomUUID(),
      createTime,
    },
  });
async function grant(
  Action: string | string[],
  Resource: string,
  Effect: "Allow" | "Deny" = "Allow",
  targetType: "user" | "role" = "user",
  targetId = actor,
) {
  const policy = await ram.createPolicy(owner, {
    name: "project-key-iam-" + randomUUID(),
    document: {
      Version: "1",
      Statement: { Effect, Action, Resource },
    },
  });
  await ram.createAuthorization(owner, {
    principalType: targetType,
    principalId: targetId,
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
          username: "project-key-iam-user-" + randomUUID(),
          password: "fixture-only",
          userType: accountOwnerId ? "ram_user" : "root",
          accountOwnerId,
          parentUserId: accountOwnerId,
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
  env.security.iamAuthorizationMode = originalMode;
  vi.restoreAllMocks();
});

/** Disposable test-only credentials; never configured as a production default. */
async function keyFixture(projectId: string, createTime = new Date(), status = 1) {
  const rawKey = "sk-dk-" + randomUUID(),
    keyHash = createHash("sha256").update(rawKey).digest("hex");
  const record = await prisma.developerProjectApiKey.create({
    data: {
      projectId,
      createTime,
      status,
      name: "Key fixture",
      keyHash,
      keyPrefix: rawKey.slice(0, 12),
      scopes: ["kv:read"],
    },
  });
  return { ...record, rawKey };
}
describe("IAM project API key metadata and revocation", () => {
  it("delegates one peer credential metadata row without returning raw keys or hashes", async () => {
    const target = await project(peer),
      visible = await keyFixture(target.id),
      hidden = await keyFixture(target.id);
    await grant("quyan:developer:ListProjectApiKeys", arn(target.id, visible.id));
    const items = await run((request) => controller.listKeys(target.id, request));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: visible.id, resourceArn: arn(target.id, visible.id), scopes: ["kv:read"] });
    for (const field of ["key", "keyHash", "legacyKeyHash", "rawKey"]) expect(items[0]).not.toHaveProperty(field);
    for (const value of [visible.rawKey, visible.keyHash, hidden.id])
      expect(JSON.stringify(items)).not.toContain(value);
    await expect(run((request) => controller.revokeKey(target.id, visible.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.developerProjectApiKey.findUniqueOrThrow({ where: { id: visible.id } })).status).toBe(1);
  });
  it("revokes only the concrete key and invalidates its independent project-key authentication", async () => {
    const target = await project(peer),
      selected = await keyFixture(target.id),
      other = await keyFixture(target.id);
    const repository = DeveloperProjectRepository.getInstance();
    expect((await repository.authenticateProjectKey(selected.rawKey, ["kv:read"])).id).toBe(selected.id);
    await grant("quyan:developer:RevokeProjectApiKey", arn(target.id, selected.id));
    await run((request) => controller.revokeKey(target.id, selected.id, request));
    expect((await prisma.developerProjectApiKey.findUniqueOrThrow({ where: { id: selected.id } })).status).toBe(0);
    await expect(repository.authenticateProjectKey(selected.rawKey, ["kv:read"])).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(run(() => service.revokeProjectApiKey(target.id, other.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await repository.authenticateProjectKey(other.rawKey, ["kv:read"])).id).toBe(other.id);
    expect((await prisma.developerProject.findUniqueOrThrow({ where: { id: target.id } })).userId).toBe(peer);
  });
  it("honors key Deny on revoke and list even in the presence of Allow", async () => {
    const target = await project(peer),
      key = await keyFixture(target.id);
    await grant(["quyan:developer:RevokeProjectApiKey", "quyan:developer:ListProjectApiKeys"], arn(target.id, key.id));
    await grant(
      ["quyan:developer:RevokeProjectApiKey", "quyan:developer:ListProjectApiKeys"],
      arn(target.id, key.id),
      "Deny",
    );
    await expect(run(() => service.revokeProjectApiKey(target.id, key.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await run(() => service.listProjectApiKeysPage(target.id, actor))).items).toEqual([]);
    expect((await prisma.developerProjectApiKey.findUniqueOrThrow({ where: { id: key.id } })).status).toBe(1);
  });
  it("rejects cross-account, cross-project and disabled credential targets", async () => {
    const target = await project(peer),
      second = await project(peer),
      outside = await project(foreign);
    const key = await keyFixture(target.id),
      remote = await keyFixture(outside.id);
    await grant("quyan:developer:RevokeProjectApiKey", "acs:developer:*:" + owner + ":project-api-key/*/*");
    await expect(run(() => service.revokeProjectApiKey(second.id, key.id, actor))).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(run(() => service.revokeProjectApiKey(outside.id, remote.id, actor))).rejects.toMatchObject({
      statusCode: 404,
    });
    await prisma.developerProjectApiKey.update({ where: { id: key.id }, data: { status: 0 } });
    await expect(run(() => service.revokeProjectApiKey(target.id, key.id, actor))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect((await prisma.developerProjectApiKey.findUniqueOrThrow({ where: { id: remote.id } })).status).toBe(1);
  });
  it("paginates active metadata before filtering without a total or credential fields", async () => {
    const target = await project(peer),
      visible = await keyFixture(target.id, new Date("2026-01-01T00:00:00Z"));
    await keyFixture(target.id, new Date("2026-02-01T00:00:00Z"));
    await keyFixture(target.id, new Date("2026-03-01T00:00:00Z"), 0);
    await grant("quyan:developer:ListProjectApiKeys", arn(target.id, visible.id));
    expect(await run((request) => controller.listKeysPage(target.id, request, 1, 1))).toEqual({
      items: [],
      page: 1,
      pageSize: 1,
      hasNext: true,
    });
    const page = await run((request) => controller.listKeysPage(target.id, request, 2, 1));
    expect(page.items.map((item) => item.id)).toEqual([visible.id]);
    expect(page.hasNext).toBe(false);
    expect(page).not.toHaveProperty("total");
    expect(page.items[0]).not.toHaveProperty("key");
  });
  it("does not expand a project metadata Allow to every credential", async () => {
    const target = await project(peer);
    await keyFixture(target.id);
    await grant("quyan:developer:ListProjectApiKeys", "acs:developer:*:" + owner + ":project/" + target.id);
    expect(await run((request) => controller.listKeys(target.id, request))).toEqual([]);
  });
  it("observes resource-group removal immediately and stops recognizing revoked key members", async () => {
    const target = await project(peer),
      key = await keyFixture(target.id);
    const group = await ram.createResourceGroup(owner, { name: "key-group-" + randomUUID() });
    const full = await ram.addResourceGroupMember(owner, group.id, { resourceArn: arn(target.id, key.id) });
    const policy = await ram.createPolicy(owner, {
      name: "key-group-policy-" + randomUUID(),
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: ["quyan:developer:ListProjectApiKeys", "quyan:developer:RevokeProjectApiKey"],
          Resource: "acs:developer:*:" + owner + ":project-api-key/*/*",
        },
      },
    });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "resource-group",
      scopeResourceId: group.id,
    });
    expect((await run(() => service.listProjectApiKeysPage(target.id, actor))).items).toHaveLength(1);
    await ram.removeResourceGroupMember(owner, group.id, full.members[0].id);
    expect((await run(() => service.listProjectApiKeysPage(target.id, actor))).items).toEqual([]);
    await ram.addResourceGroupMember(owner, group.id, { resourceArn: arn(target.id, key.id) });
    await run(() => service.revokeProjectApiKey(target.id, key.id, actor));
    expect((await run(() => service.listProjectApiKeysPage(target.id, actor))).items).toEqual([]);
  });
  it("isolates role grants from caller grants and supports AccessKey-based revocation", async () => {
    const target = await project(peer),
      key = await keyFixture(target.id);
    await grant("quyan:developer:RevokeProjectApiKey", arn(target.id, key.id));
    const role = await prisma.ramRole.create({ data: { name: "key-role-" + randomUUID(), accountOwnerId: owner } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Key fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id };
    await expect(run(() => service.revokeProjectApiKey(target.id, key.id, actor), auth)).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant("quyan:developer:RevokeProjectApiKey", arn(target.id, key.id), "Allow", "role", role.id);
    await run(() => service.revokeProjectApiKey(target.id, key.id, actor), auth);
    const another = await keyFixture(target.id);
    await grant("quyan:developer:RevokeProjectApiKey", arn(target.id, another.id));
    await run(() => service.revokeProjectApiKey(target.id, another.id, actor), { subjectType: "access_key" });
    expect((await prisma.developerProjectApiKey.findUniqueOrThrow({ where: { id: another.id } })).status).toBe(0);
  });
  it("does not fabricate Allow for an empty key collection when policies are unavailable", async () => {
    const target = await project(peer);
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockRejectedValue(
      new Error("provider-unavailable"),
    );
    await expect(run(() => service.listProjectApiKeysPage(target.id, actor))).rejects.toThrow("provider-unavailable");
    await expect(run(() => service.revokeProjectApiKey(target.id, "missing", actor))).rejects.toThrow(
      "provider-unavailable",
    );
  });
  it.each(["legacy", "shadow"] as const)("retains personal credential management in %s", async (mode) => {
    const own = await project(actor),
      other = await project(peer);
    const key = await keyFixture(own.id),
      delegated = await keyFixture(other.id);
    await grant("quyan:developer:RevokeProjectApiKey", arn(other.id, delegated.id));
    env.security.iamAuthorizationMode = mode;
    expect((await run(() => service.listProjectApiKeysPage(own.id, actor))).items).toHaveLength(1);
    await run(() => service.revokeProjectApiKey(own.id, key.id, actor));
    await expect(run(() => service.revokeProjectApiKey(other.id, delegated.id, actor))).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
