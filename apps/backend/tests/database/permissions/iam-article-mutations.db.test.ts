import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, MANAGED_STATUS } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { ArticleService } from "@/services/article/article.service";
import { ArticleController } from "@/api/controllers/v1/article/article.controller";
import { ArticleManagementRepository } from "@/store/content/article-management.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { articleArn } from "@/iam/resources/article-resources";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const ram = RamService.getInstance(),
  service = ArticleService.getInstance(),
  controller = new ArticleController();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string;
const arn = (id: string) => articleArn(owner, id);
const article = (authorId = peer) =>
  prisma.article.create({
    data: {
      authorId,
      title: "Mutation fixture",
      content: "Synthetic article fixture content",
      slug: "mutation-iam-" + randomUUID(),
    },
  });
const run = <T>(id: string, operation: (request: TypedRequest) => Promise<T>, auth = {}, userId = actor) =>
  new AsyncResource("article-mutation-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId },
      params: { id },
      body: { accountId: foreign },
      headers: { "x-action": "quyan:article:Publish", "x-account-id": foreign },
      secure: true,
      ip: "127.0.0.1",
      authContext: { principalUserId: userId, accountOwnerId: owner, subjectType: "sub_user", ...auth },
    } as unknown as TypedRequest;
    setRequestContext(request);
    return operation(request);
  });
async function grant(
  Action: string,
  Resource: string,
  Effect: "Allow" | "Deny" = "Allow",
  principalType: "user" | "role" = "user",
  principalId = actor,
) {
  const policy = await ram.createPolicy(owner, {
    name: "article-mutation-policy-" + randomUUID(),
    document: { Version: "1", Statement: { Effect, Action, Resource } },
  });
  await ram.createAuthorization(owner, { principalType, principalId, policyId: policy.id, scopeType: "account" });
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "article-mutation-user-" + randomUUID(),
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
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined);
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
  vi.restoreAllMocks();
});
const operations: {
  name: "Update" | "Delete";
  invoke: (id: string, request: TypedRequest) => Promise<unknown>;
  direct: (id: string, request: TypedRequest) => Promise<unknown>;
}[] = [
  {
    name: "Update",
    invoke: (id: string, request: TypedRequest) => controller.updateArticle(id, { title: "Updated fixture" }, request),
    direct: (id: string, request: TypedRequest) =>
      service.updateArticle(id, { title: "Updated fixture" }, actor, request),
  },
  {
    name: "Delete",
    invoke: (id: string, request: TypedRequest) => controller.deleteArticle(id, request),
    direct: (id: string, request: TypedRequest) => service.deleteArticle(id, actor, request),
  },
];
const persisted = (id: string) => prisma.article.findUniqueOrThrow({ where: { id } });

describe("IAM concrete article mutations", () => {
  it("edits an exact peer article without replacing ownership, publication state, default flags or counters", async () => {
    const row = await article(),
      sibling = await article();
    await grant("quyan:article:Update", arn(row.id));
    const input = {
      title: "  Updated fixture  ",
      content: "Updated synthetic content",
      slug: "changed-" + randomUUID(),
      authorId: actor,
      status: -1,
      publishStatus: "published",
      publishedAt: "2026-10-09",
      isDefault: true,
      viewCount: 999,
      sortOrder: 999,
    };
    const result = await run(row.id, (request) => controller.updateArticle(row.id, input, request));
    expect(result).toMatchObject({
      id: row.id,
      title: "Updated fixture",
      content: input.content,
      authorId: peer,
      publishStatus: "draft",
      isDefault: false,
      viewCount: 0,
      sortOrder: 0,
    });
    expect((await persisted(row.id)).status).toBe(MANAGED_STATUS.ENABLED);
    expect(BusinessLogService.getInstance().logOperation).toHaveBeenCalledWith(
      expect.objectContaining({ changes: { title: "Updated fixture", content: input.content, slug: input.slug } }),
    );
    await expect(
      run(sibling.id, (request) => controller.updateArticle(sibling.id, { title: "forbidden" }, request)),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(run(row.id, (request) => controller.deleteArticle(row.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(run(row.id, (request) => controller.publishArticle(row.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("deletes only an authorized peer article and immediately removes it from live resource-group eligibility", async () => {
    const row = await article(),
      sibling = await article();
    await grant("quyan:article:Delete", arn(row.id));
    expect(await run(row.id, (request) => controller.deleteArticle(row.id, request))).toEqual({ success: true });
    expect((await persisted(row.id)).status).toBe(MANAGED_STATUS.DELETED);
    expect((await persisted(sibling.id)).status).toBe(MANAGED_STATUS.ENABLED);
    expect(await RamResourceGroupRepository.getInstance().resourceExistsInAccount(arn(row.id), owner)).toBe(false);
    await expect(run(row.id, (request) => controller.deleteArticle(row.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each(operations)("defaults to deny and honors explicit Deny for $name", async (operation) => {
    const row = await article();
    await expect(run(row.id, (request) => operation.direct(row.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant("quyan:article:" + operation.name, arn(row.id));
    await grant("quyan:article:" + operation.name, arn(row.id), "Deny");
    await expect(run(row.id, (request) => operation.invoke(row.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await persisted(row.id)).toMatchObject({ title: row.title, status: MANAGED_STATUS.ENABLED });
  });
  it.each(operations)(
    "refuses foreign-account $name with wildcard permission and client spoofing",
    async (operation) => {
      const row = await article(foreign);
      await grant("quyan:article:" + operation.name, "*");
      await expect(run(row.id, (request) => operation.invoke(row.id, request))).rejects.toMatchObject({
        statusCode: 403,
      });
      await expect(run(row.id, (request) => operation.direct(row.id, request))).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(await persisted(row.id)).toMatchObject({ title: row.title, status: MANAGED_STATUS.ENABLED });
    },
  );
  it.each(operations)("rejects ID and author foreign-key case aliases for $name", async (operation) => {
    const row = await article();
    await grant("quyan:article:" + operation.name, "*");
    await expect(
      run(row.id.toUpperCase(), (request) => operation.invoke(row.id.toUpperCase(), request)),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.article.update({ where: { id: row.id }, data: { authorId: peer.toUpperCase() } });
    await expect(run(row.id, (request) => operation.invoke(row.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await persisted(row.id)).status).toBe(MANAGED_STATUS.ENABLED);
  });
  it("preserves visibility rules and requires explicit removal of an access restriction before making an article public", async () => {
    const row = await article();
    await grant("quyan:article:Update", arn(row.id));
    await prisma.article.update({ where: { id: row.id }, data: { requirePermission: Permission.ARTICLE_READ } });
    await expect(
      run(row.id, (request) => controller.updateArticle(row.id, { isPublic: true }, request)),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect((await persisted(row.id)).isPublic).toBe(false);
    const updated = await run(row.id, (request) =>
      controller.updateArticle(row.id, { isPublic: true, requirePermission: "" }, request),
    );
    expect(updated).toMatchObject({ isPublic: true, requirePermission: "", publishStatus: "draft" });
    await expect(
      run(row.id, (request) =>
        controller.updateArticle(row.id, { requirePermission: Permission.ARTICLE_READ }, request),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it("does not persist a cross-account slug collision or reveal its owner", async () => {
    const row = await article(),
      collision = await article(foreign);
    await grant("quyan:article:Update", arn(row.id));
    await expect(
      run(row.id, (request) => controller.updateArticle(row.id, { slug: collision.slug }, request)),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect((await persisted(row.id)).slug).toBe(row.slug);
    expect((await persisted(collision.id)).authorId).toBe(foreign);
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });
  it.each(operations)("rechecks author reassignment for $name after the IAM decision", async (operation) => {
    const row = await article();
    await grant("quyan:article:" + operation.name, arn(row.id));
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorize.bind(iam);
    vi.spyOn(iam, "authorize").mockImplementation(async (input) => {
      const result = await original(input);
      await prisma.article.update({ where: { id: row.id }, data: { authorId: foreign } });
      return result;
    });
    await expect(run(row.id, (request) => operation.direct(row.id, request))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(await persisted(row.id)).toMatchObject({
      title: row.title,
      status: MANAGED_STATUS.ENABLED,
      authorId: foreign,
    });
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });
  it.each(["public", "permission", "default", "sort", "slug"])(
    "rejects same-timestamp snapshot drift in %s",
    async (change) => {
      const row = await article(),
        target = (await ArticleManagementRepository.getInstance().findTarget(row.id, owner))!;
      const data = {
        updateTime: target.updateTime,
        ...(change === "public"
          ? { isPublic: true }
          : change === "permission"
            ? { requirePermission: Permission.ARTICLE_READ }
            : change === "default"
              ? { isDefault: true }
              : change === "sort"
                ? { sortOrder: 10 }
                : { slug: "drifted-" + randomUUID() }),
      };
      await prisma.article.update({ where: { id: row.id }, data });
      await expect(
        ArticleManagementRepository.getInstance().update(target, owner, actor, { title: "must-not-write" }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(ArticleManagementRepository.getInstance().delete(target, owner, actor)).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(await persisted(row.id)).toMatchObject({ title: row.title, status: MANAGED_STATUS.ENABLED });
    },
  );
  it.each(operations)("rechecks actor availability before $name writes", async (operation) => {
    const row = await article();
    await grant("quyan:article:" + operation.name, arn(row.id));
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorize.bind(iam);
    vi.spyOn(iam, "authorize").mockImplementation(async (input) => {
      const result = await original(input);
      await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
      return result;
    });
    await expect(run(row.id, (request) => operation.direct(row.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await persisted(row.id)).toMatchObject({ title: row.title, status: MANAGED_STATUS.ENABLED });
  });
  it.each(operations)("uses resource-group scope without widening $name", async (operation) => {
    const row = await article(),
      sibling = await article();
    const group = await ram.createResourceGroup(owner, { name: "article-mutation-group-" + randomUUID() });
    const membership = await ram.addResourceGroupMember(owner, group.id, { resourceArn: arn(row.id) });
    const policy = await ram.createPolicy(owner, {
      name: "article-mutation-group-policy-" + randomUUID(),
      document: {
        Version: "1",
        Statement: { Effect: "Allow", Action: "quyan:article:" + operation.name, Resource: "*" },
      },
    });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "resource-group",
      scopeResourceId: group.id,
    });
    await expect(run(sibling.id, (request) => operation.invoke(sibling.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    if (operation.name === "Update") {
      await run(row.id, (request) => operation.invoke(row.id, request));
      await ram.removeResourceGroupMember(owner, group.id, membership.members[0].id);
      await expect(run(row.id, (request) => operation.invoke(row.id, request))).rejects.toMatchObject({
        statusCode: 403,
      });
    } else await run(row.id, (request) => operation.invoke(row.id, request));
  });
  it("uses request Conditions and role policies without importing the caller grants", async () => {
    const row = await article();
    await grant("quyan:article:Update", arn(row.id));
    const role = await prisma.ramRole.create({
      data: { name: "article-mutation-role-" + randomUUID(), accountOwnerId: owner },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Mutation fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id };
    await expect(
      run(row.id, (request) => controller.updateArticle(row.id, { title: "denied" }, request), auth),
    ).rejects.toMatchObject({ statusCode: 403 });
    const policy = await ram.createPolicy(owner, {
      name: "article-mutation-condition-" + randomUUID(),
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:article:Update",
          Resource: arn(row.id),
          Condition: { Bool: { "acs:SecureTransport": true } },
        },
      },
    });
    await ram.createAuthorization(owner, {
      principalType: "role",
      principalId: role.id,
      policyId: policy.id,
      scopeType: "account",
    });
    await expect(
      run(
        row.id,
        (request) => {
          Object.defineProperty(request, "secure", { value: false });
          request.headers["x-secure-transport"] = "true";
          return controller.updateArticle(row.id, { title: "denied" }, request);
        },
        auth,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      (await run(row.id, (request) => controller.updateArticle(row.id, { title: "role update" }, request), auth)).title,
    ).toBe("role update");
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(
      run(row.id, (request) => controller.updateArticle(row.id, { title: "denied" }, request), auth),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      (
        await run(row.id, (request) => controller.updateArticle(row.id, { title: "key update" }, request), {
          subjectType: "access_key",
        })
      ).title,
    ).toBe("key update");
  });
  it("keeps legacy permissions author-only through both the enforce middleware and service boundary", async () => {
    const own = await article(actor),
      other = await article();
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.ARTICLE_UPDATE, Permission.ARTICLE_DELETE] },
    });
    await expect(
      run(other.id, (request) => controller.updateArticle(other.id, { title: "denied" }, request)),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(run(other.id, (request) => service.deleteArticle(other.id, actor, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(
      (await run(own.id, (request) => controller.updateArticle(own.id, { title: "Owned edit" }, request))).title,
    ).toBe("Owned edit");
    expect(await run(own.id, (request) => controller.deleteArticle(own.id, request))).toEqual({ success: true });
    expect((await persisted(other.id)).status).toBe(MANAGED_STATUS.ENABLED);
  });
  it.each(["legacy", "shadow"] as const)("retains author-only edits/deletion in %s mode", async (mode) => {
    const own = await article(actor),
      other = await article();
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.ARTICLE_UPDATE, Permission.ARTICLE_DELETE] },
    });
    await grant("quyan:article:Update", "*", "Deny");
    await grant("quyan:article:Delete", "*", "Deny");
    env.security.iamAuthorizationMode = mode;
    expect(
      (await run(own.id, (request) => controller.updateArticle(own.id, { title: "Legacy own" }, request))).title,
    ).toBe("Legacy own");
    await expect(
      run(other.id, (request) => controller.updateArticle(other.id, { title: "denied" }, request)),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(run(other.id, (request) => controller.deleteArticle(other.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await run(own.id, (request) => controller.deleteArticle(own.id, request))).toEqual({ success: true });
  });
  it("keeps existing legacy publisher/edit/delete capabilities and rejects missing or mismatched identity", async () => {
    const row = await article(owner);
    await prisma.user.update({
      where: { id: owner },
      data: { permissionAdds: [Permission.ARTICLE_UPDATE, Permission.ARTICLE_DELETE] },
    });
    expect(
      (await run(row.id, (request) => controller.updateArticle(row.id, { title: "Root update" }, request), {}, owner))
        .title,
    ).toBe("Root update");
    await expect(
      run(row.id, (request) => {
        delete request.authContext;
        return service.deleteArticle(row.id, actor, request);
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(run(row.id, (request) => service.deleteArticle(row.id, peer, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await run(row.id, (request) => controller.deleteArticle(row.id, request), {}, owner)).toEqual({
      success: true,
    });
  });
});
