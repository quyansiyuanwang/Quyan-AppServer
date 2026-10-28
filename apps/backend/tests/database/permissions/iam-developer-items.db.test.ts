import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { DeveloperProjectManagementService } from "@/services/developer/developer-project-management.service";
import { DeveloperProjectController } from "@/api/controllers/v1/developer/developer-project.controller";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { developerKvArn, developerSecretArn } from "@/iam/resources/developer-resources";
import { DeveloperProjectRepository } from "@/store/developer/developer-project.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const service = DeveloperProjectManagementService.getInstance();
const controller = new DeveloperProjectController();
const ram = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string;
const kvArn = (projectId: string, key: string) => developerKvArn(owner, projectId, key);
const secretArn = (projectId: string, alias: string) => developerSecretArn(owner, projectId, alias);
const originalSecretKey = process.env.DEVELOPER_SECRETS_MASTER_KEY;
const run = <T>(operation: (request: TypedRequest) => Promise<T>, auth = {}) =>
  new AsyncResource("developer-item-iam-fixture").runInAsyncScope(async () => {
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
      slug: "item-iam-" + randomUUID(),
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
    name: "item-iam-" + randomUUID(),
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
  process.env.DEVELOPER_SECRETS_MASTER_KEY = "d".repeat(64);
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "item-iam-user-" + randomUUID(),
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
  if (originalSecretKey === undefined) delete process.env.DEVELOPER_SECRETS_MASTER_KEY;
  else process.env.DEVELOPER_SECRETS_MASTER_KEY = originalSecretKey;
  vi.restoreAllMocks();
});

const kv = (projectId: string, key: string, expiresAt: Date | null = null) =>
  prisma.developerKvEntry.create({ data: { projectId, key, expiresAt, value: { fixture: key } } });
const secret = (projectId: string, alias: string) =>
  prisma.developerSecret.create({
    data: { projectId, alias, ciphertext: "fixture-only", iv: "fixture-only", authTag: "fixture-only", keyVersion: 1 },
  });
describe("developer item resource authorization", () => {
  it("rejects case aliases that MySQL equates to a differently authorized stored key", async () => {
    const target = await project(peer);
    const row = await kv(target.id, "ProtectedKey");
    await grant(
      ["quyan:developer:GetKv", "quyan:developer:SetKv", "quyan:developer:DeleteKv"],
      "acs:developer:*:" + owner + ":kv-item/" + target.id + "/*",
    );
    await grant(
      ["quyan:developer:GetKv", "quyan:developer:SetKv", "quyan:developer:DeleteKv"],
      kvArn(target.id, "ProtectedKey"),
      "Deny",
    );
    await expect(run(() => service.getProjectKv(target.id, actor, "protectedkey"))).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      run(() => service.setProjectKv(target.id, actor, "protectedkey", { value: "must-not-write" })),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(run(() => service.deleteProjectKv(target.id, actor, "protectedkey"))).rejects.toMatchObject({
      statusCode: 404,
    });
    const unchanged = await prisma.developerKvEntry.findUniqueOrThrow({ where: { id: row.id } });
    expect(unchanged).toMatchObject({ key: "ProtectedKey", version: 1, value: { fixture: "ProtectedKey" } });
    const group = RamResourceGroupRepository.getInstance();
    expect(await group.resourceExistsInAccount(kvArn(target.id, "protectedkey"), owner)).toBe(false);
    expect(await group.resourceExistsInAccount(kvArn(target.id, "ProtectedKey"), owner)).toBe(true);
    await expect(run(() => service.getProject(target.id.toUpperCase(), actor))).rejects.toMatchObject({
      statusCode: 404,
    });
  });
  it("rechecks an exact KV identity inside transactional writes and deletion", async () => {
    const target = await project(peer),
      row = await kv(target.id, "ExistingKey");
    const repository = DeveloperProjectRepository.getInstance();
    await expect(repository.setProjectKvExact(target.id, peer, "existingkey", { value: 0 })).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(repository.deleteProjectKvExact(target.id, peer, "existingkey")).rejects.toMatchObject({
      statusCode: 404,
    });
    expect((await prisma.developerKvEntry.findUniqueOrThrow({ where: { id: row.id } })).key).toBe("ExistingKey");
    await expect(repository.getProjectKvReadOnly(target.id, peer, "existingkey")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("delegates one peer KV key, preserves ownership and rejects other keys and projects", async () => {
    const first = await project(peer),
      second = await project(peer);
    await kv(first.id, "config:prod.v1");
    await kv(first.id, "other");
    await kv(second.id, "config:prod.v1");
    await grant(
      ["quyan:developer:GetKv", "quyan:developer:SetKv", "quyan:developer:DeleteKv"],
      kvArn(first.id, "config:prod.v1"),
    );
    const read = await run((request) => controller.getKv(first.id, "config:prod.v1", request));
    expect(read).toMatchObject({ key: "config:prod.v1", resourceArn: kvArn(first.id, "config:prod.v1") });
    await run((request) => controller.setKv(first.id, "config:prod.v1", { value: { changed: true } }, request));
    expect(
      await prisma.developerKvEntry.findUnique({
        where: { projectId_key: { projectId: first.id, key: "config:prod.v1" } },
      }),
    ).toMatchObject({ value: { changed: true }, version: 2 });
    for (const [projectId, key] of [
      [first.id, "other"],
      [second.id, "config:prod.v1"],
    ]) {
      await expect(run(() => service.getProjectKv(projectId, actor, key))).rejects.toMatchObject({ statusCode: 403 });
      await expect(run(() => service.setProjectKv(projectId, actor, key, { value: 0 }))).rejects.toMatchObject({
        statusCode: 403,
      });
      await expect(run(() => service.deleteProjectKv(projectId, actor, key))).rejects.toMatchObject({
        statusCode: 403,
      });
    }
    await run((request) => controller.deleteKv(first.id, "config:prod.v1", request));
    expect(
      await prisma.developerKvEntry.findUnique({
        where: { projectId_key: { projectId: first.id, key: "config:prod.v1" } },
      }),
    ).toBeNull();
    expect((await prisma.developerProject.findUniqueOrThrow({ where: { id: first.id } })).userId).toBe(peer);
  });
  it("allows creation of exactly one new key and does not inherit project read permission", async () => {
    const target = await project(peer);
    await grant("quyan:developer:GetProject", "acs:developer:*:" + owner + ":project/" + target.id);
    await expect(run(() => service.setProjectKv(target.id, actor, "new", { value: 1 }))).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant("quyan:developer:SetKv", kvArn(target.id, "new"));
    expect(await run(() => service.setProjectKv(target.id, actor, "new", { value: 1 }))).toMatchObject({
      key: "new",
      resourceArn: kvArn(target.id, "new"),
    });
    await expect(run(() => service.getProjectKv(target.id, actor, "new"))).rejects.toMatchObject({ statusCode: 403 });
    await expect(run(() => service.setProjectKv(target.id, actor, "another", { value: 1 }))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("lets an explicit item Deny prevent a write and records its decision without exposing the value", async () => {
    const target = await project(peer);
    const row = await kv(target.id, "key");
    await grant("quyan:developer:SetKv", kvArn(target.id, "key"));
    await grant("quyan:developer:SetKv", kvArn(target.id, "key"), "Deny");
    await run(async (request) => {
      await expect(controller.setKv(target.id, "key", { value: "must-not-write" }, request)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(request.iamDecisions?.at(-1)).toMatchObject({
        action: "quyan:developer:SetKv",
        decision: "ExplicitDeny",
        resource: kvArn(target.id, "key"),
      });
      expect(JSON.stringify(request.iamDecisions)).not.toContain("must-not-write");
    });
    expect((await prisma.developerKvEntry.findUniqueOrThrow({ where: { id: row.id } })).value).toEqual({
      fixture: "key",
    });
  });
  it("isolates accounts and disabled project owners even with wildcard item policy", async () => {
    const foreignProject = await project(foreign),
      target = await project(peer);
    await kv(foreignProject.id, "key");
    await kv(target.id, "key");
    await grant("quyan:developer:GetKv", "acs:developer:*:" + owner + ":kv-item/*/*");
    await expect(run(() => service.getProjectKv(foreignProject.id, actor, "key"))).rejects.toMatchObject({
      statusCode: 404,
    });
    await prisma.user.update({ where: { id: peer }, data: { status: 0 } });
    await expect(run(() => service.getProjectKv(target.id, actor, "key"))).rejects.toMatchObject({ statusCode: 404 });
  });
  it("paginates metadata before item filtering, supports an empty next page and keeps page as a valid key", async () => {
    const target = await project(peer);
    await kv(target.id, "a-hidden");
    await kv(target.id, "page");
    await grant(["quyan:developer:ListKv", "quyan:developer:GetKv"], kvArn(target.id, "page"));
    const first = await run((request) => controller.listKvPage(target.id, request, 1, 1));
    expect(first).toEqual({ items: [], page: 1, pageSize: 1, hasNext: true });
    const second = await run((request) => controller.listKvPage(target.id, request, 2, 1));
    expect(second).not.toHaveProperty("total");
    expect(second.hasNext).toBe(false);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({ key: "page", resourceArn: kvArn(target.id, "page") });
    expect(second.items[0]).not.toHaveProperty("value");
    expect((await run((request) => controller.getKv(target.id, "page", request))).key).toBe("page");
  });
  it("does not expand a project List grant to individual KV or secret metadata", async () => {
    const target = await project(peer);
    await kv(target.id, "key");
    await secret(target.id, "API_KEY");
    await grant(
      ["quyan:developer:ListKv", "quyan:developer:ListSecrets"],
      "acs:developer:*:" + owner + ":project/" + target.id,
    );
    expect((await run(() => service.listProjectKvPage(target.id, actor))).items).toEqual([]);
    expect(await run(() => service.listSecrets(target.id, actor))).toEqual([]);
  });
  it("does not delete expired entries when reading or listing, including entries without Delete permission", async () => {
    const target = await project(peer);
    const expired = await kv(target.id, "expired", new Date(Date.now() - 1000));
    const hidden = await kv(target.id, "hidden", new Date(Date.now() - 1000));
    await kv(target.id, "valid");
    await grant("quyan:developer:GetKv", kvArn(target.id, "expired"));
    await grant("quyan:developer:ListKv", kvArn(target.id, "valid"));
    await expect(run(() => service.getProjectKv(target.id, actor, "expired"))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect((await run(() => service.listProjectKv(target.id, actor))).map((item) => item.key)).toEqual(["valid"]);
    expect(await prisma.developerKvEntry.count({ where: { id: { in: [expired.id, hidden.id] } } })).toBe(2);
  });
  it("authorizes one peer Secret alias for creation, update and deletion without returning its encrypted material", async () => {
    const target = await project(peer);
    await secret(target.id, "OTHER");
    await grant(["quyan:developer:PutSecret", "quyan:developer:DeleteSecret"], secretArn(target.id, "API_KEY"));
    const created = await run((request) =>
      controller.upsertSecret(target.id, { alias: "API_KEY", value: "fixture-only-input" }, request),
    );
    expect(created).toMatchObject({ alias: "API_KEY", resourceArn: secretArn(target.id, "API_KEY") });
    for (const field of ["value", "ciphertext", "iv", "authTag"]) expect(created).not.toHaveProperty(field);
    expect(JSON.stringify(created)).not.toContain("fixture-only-input");
    await run(() => service.upsertSecret(target.id, actor, { alias: "API_KEY", value: "fixture-only-update" }));
    expect(
      (
        await prisma.developerSecret.findUniqueOrThrow({
          where: { projectId_alias: { projectId: target.id, alias: "API_KEY" } },
        })
      ).keyVersion,
    ).toBe(2);
    await expect(
      run(() => service.upsertSecret(target.id, actor, { alias: "OTHER", value: "fixture-only-input" })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(run(() => service.deleteSecret(target.id, "OTHER", actor))).rejects.toMatchObject({ statusCode: 403 });
    await run((request) => controller.deleteSecret(target.id, "API_KEY", request));
    expect(
      await prisma.developerSecret.findUnique({
        where: { projectId_alias: { projectId: target.id, alias: "API_KEY" } },
      }),
    ).toBeNull();
  });
  it("filters Secret metadata by alias, honors new Deny policies on the next request and hides ciphertext", async () => {
    const target = await project(peer);
    await secret(target.id, "A_HIDDEN");
    await secret(target.id, "VISIBLE");
    await grant("quyan:developer:ListSecrets", secretArn(target.id, "VISIBLE"));
    expect(await run((request) => controller.listSecretsPage(target.id, request, 1, 1))).toEqual({
      items: [],
      page: 1,
      pageSize: 1,
      hasNext: true,
    });
    const page = await run((request) => controller.listSecretsPage(target.id, request, 2, 1));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ alias: "VISIBLE", resourceArn: secretArn(target.id, "VISIBLE") });
    for (const field of ["value", "ciphertext", "iv", "authTag"]) expect(page.items[0]).not.toHaveProperty(field);
    await grant("quyan:developer:ListSecrets", secretArn(target.id, "VISIBLE"), "Deny");
    expect((await run(() => service.listSecretsPage(target.id, actor))).items).toEqual([]);
  });
  it("fails closed when loading policies even if either resource collection is empty", async () => {
    const target = await project(peer);
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockRejectedValue(
      new Error("provider-unavailable"),
    );
    await expect(run(() => service.listProjectKvPage(target.id, actor))).rejects.toThrow("provider-unavailable");
    await expect(run(() => service.listSecretsPage(target.id, actor))).rejects.toThrow("provider-unavailable");
    await expect(run(() => service.setProjectKv(target.id, actor, "key", { value: 1 }))).rejects.toThrow(
      "provider-unavailable",
    );
    expect(await prisma.developerKvEntry.count({ where: { projectId: target.id } })).toBe(0);
  });
  it("supports resource-group item scopes and observes removal, disabled data and noncanonical encoded keys", async () => {
    const target = await project(peer);
    await kv(target.id, "key");
    await secret(target.id, "API_KEY");
    const group = await ram.createResourceGroup(owner, { name: "items-" + randomUUID() });
    const full = await ram.addResourceGroupMember(owner, group.id, { resourceArn: kvArn(target.id, "key") });
    await ram.addResourceGroupMember(owner, group.id, { resourceArn: secretArn(target.id, "API_KEY") });
    const policy = await ram.createPolicy(owner, {
      name: "group-items-" + randomUUID(),
      document: {
        Version: "1",
        Statement: [
          { Effect: "Allow", Action: "quyan:developer:GetKv", Resource: "acs:developer:*:" + owner + ":kv-item/*/*" },
          {
            Effect: "Allow",
            Action: "quyan:developer:ListSecrets",
            Resource: "acs:developer:*:" + owner + ":secret/*/*",
          },
        ],
      },
    });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "resource-group",
      scopeResourceId: group.id,
    });
    expect((await run(() => service.getProjectKv(target.id, actor, "key"))).key).toBe("key");
    expect((await run(() => service.listSecretsPage(target.id, actor))).items).toHaveLength(1);
    await ram.removeResourceGroupMember(owner, group.id, full.members[0].id);
    await expect(run(() => service.getProjectKv(target.id, actor, "key"))).rejects.toMatchObject({ statusCode: 403 });
    const groups = RamResourceGroupRepository.getInstance();
    await kv(target.id, "a");
    expect(await groups.resourceExistsInAccount(kvArn(target.id, "a").replace(/YQ$/, "YR"), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(secretArn(target.id, "API_KEY"), foreign)).toBe(false);
    await prisma.developerSecret.updateMany({ where: { projectId: target.id }, data: { status: 0 } });
    expect((await run(() => service.listSecretsPage(target.id, actor))).items).toEqual([]);
  });
  it("does not inherit caller item grants into a role session and rejects revoked sessions", async () => {
    const target = await project(peer);
    await kv(target.id, "key");
    await grant("quyan:developer:GetKv", kvArn(target.id, "key"));
    const role = await prisma.ramRole.create({ data: { name: "item-role-" + randomUUID(), accountOwnerId: owner } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Item fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id };
    await expect(run(() => service.getProjectKv(target.id, actor, "key"), auth)).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant("quyan:developer:GetKv", kvArn(target.id, "key"), "Allow", "role", role.id);
    expect((await run(() => service.getProjectKv(target.id, actor, "key"), auth)).key).toBe("key");
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(run(() => service.getProjectKv(target.id, actor, "key"), auth)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("evaluates AccessKey item requests with the same exact policy", async () => {
    const target = await project(peer);
    await kv(target.id, "key");
    await expect(
      run(() => service.getProjectKv(target.id, actor, "key"), { subjectType: "access_key" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:developer:GetKv", kvArn(target.id, "key"));
    expect((await run(() => service.getProjectKv(target.id, actor, "key"), { subjectType: "access_key" })).key).toBe(
      "key",
    );
  });
  it.each(["legacy", "shadow"] as const)(
    "preserves personal item ownership in %s without using IAM to expand access",
    async (mode) => {
      const own = await project(actor),
        delegated = await project(peer);
      await kv(own.id, "key");
      await kv(delegated.id, "key");
      await grant("quyan:developer:GetKv", kvArn(delegated.id, "key"));
      env.security.iamAuthorizationMode = mode;
      expect((await run(() => service.getProjectKv(own.id, actor, "key"))).key).toBe("key");
      await expect(run(() => service.getProjectKv(delegated.id, actor, "key"))).rejects.toMatchObject({
        statusCode: 404,
      });
      expect((await run(() => service.listProjectKvPage(own.id, actor))).items).toHaveLength(1);
    },
  );
  it("rejects invalid item pagination and mismatched authenticated account context", async () => {
    const target = await project(peer);
    await expect(run(() => service.listSecretsPage(target.id, actor, { page: 0 }))).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      run(() => service.listProjectKvPage(target.id, actor), { accountOwnerId: foreign }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
