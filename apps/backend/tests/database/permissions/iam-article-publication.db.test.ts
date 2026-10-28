import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
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
import { articleResourceResolver } from "@/iam/request/article-resource-resolvers";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const ram = RamService.getInstance(),
  service = ArticleService.getInstance(),
  controller = new ArticleController();
const repository = ArticleManagementRepository.getInstance(),
  originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string;
const arn = (id: string) => articleArn(owner, id);
const article = (authorId = peer, publishStatus = "draft") =>
  prisma.article.create({
    data: {
      authorId,
      title: "Publication test",
      content: "Synthetic article fixture content",
      slug: "publication-iam-" + randomUUID(),
      publishStatus,
    },
  });
const run = <T>(id: string, operation: (request: TypedRequest) => Promise<T>, auth = {}, userId = actor) =>
  new AsyncResource("article-publication-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId },
      params: { id },
      body: { accountId: foreign },
      headers: { "x-action": "quyan:article:Read", "x-account-id": foreign },
      secure: true,
      ip: "127.0.0.1",
      authContext: { principalUserId: userId, accountOwnerId: owner, subjectType: "sub_user", ...auth },
    } as unknown as TypedRequest;
    setRequestContext(request);
    return operation(request);
  });
async function grant(
  Resource: string,
  Effect: "Allow" | "Deny" = "Allow",
  Action = "quyan:article:Publish",
  principalType: "user" | "role" = "user",
  principalId = actor,
) {
  const policy = await ram.createPolicy(owner, {
    name: "publication-policy-" + randomUUID(),
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
          username: "publication-user-" + randomUUID(),
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

describe("article publication IAM", () => {
  it("publishes and retracts an exact peer article without changing its owner, content or default selection", async () => {
    const row = await article(),
      sibling = await article();
    await grant(arn(row.id));
    const published = await run(row.id, (request) => controller.publishArticle(row.id, request));
    expect(published).toMatchObject({
      id: row.id,
      authorId: peer,
      publishStatus: "published",
      isDefault: false,
      content: row.content,
    });
    expect(published.publishedAt).toBeDefined();
    const retracted = await run(row.id, (request) => controller.unpublishArticle(row.id, request));
    expect(retracted.publishStatus).toBe("draft");
    expect(retracted.publishedAt).toBe(published.publishedAt);
    expect((await prisma.article.findUniqueOrThrow({ where: { id: sibling.id } })).publishStatus).toBe("draft");
    await expect(run(sibling.id, (request) => controller.publishArticle(sibling.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each(["quyan:article:Read", "quyan:article:Update", "quyan:article:Delete"])(
    "does not import %s into publication",
    async (action) => {
      const row = await article();
      await grant(arn(row.id), "Allow", action);
      await expect(run(row.id, (request) => service.publishArticle(row.id, actor, request))).rejects.toMatchObject({
        statusCode: 403,
      });
      expect((await prisma.article.findUniqueOrThrow({ where: { id: row.id } })).publishStatus).toBe("draft");
    },
  );
  it("defaults to deny and checks explicit Deny before returning publication state", async () => {
    const row = await article(peer, "published");
    await expect(run(row.id, (request) => controller.unpublishArticle(row.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant(arn(row.id));
    await grant(arn(row.id), "Deny");
    await expect(run(row.id, (request) => controller.publishArticle(row.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(run(row.id, (request) => service.unpublishArticle(row.id, actor, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.article.findUniqueOrThrow({ where: { id: row.id } })).publishStatus).toBe("published");
  });
  it("refuses foreign-account targets even with wildcard permission and spoofed client account", async () => {
    const row = await article(foreign);
    await grant("*");
    await expect(run(row.id, (request) => controller.publishArticle(row.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(run(row.id, (request) => service.publishArticle(row.id, actor, request))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect((await prisma.article.findUniqueOrThrow({ where: { id: row.id } })).publishStatus).toBe("draft");
  });
  it.each(["article", "author", "owner", "actor"])("rejects an inactive %s", async (kind) => {
    const row = await article();
    await grant(arn(row.id));
    if (kind === "article") await prisma.article.update({ where: { id: row.id }, data: { status: 0 } });
    else
      await prisma.user.update({
        where: { id: kind === "author" ? peer : kind === "owner" ? owner : actor },
        data: { status: 0 },
      });
    await expect(run(row.id, (request) => controller.publishArticle(row.id, request))).rejects.toBeDefined();
    expect((await prisma.article.findUniqueOrThrow({ where: { id: row.id } })).publishStatus).toBe("draft");
  });
  it("rejects ID case aliases and historical author foreign-key aliases", async () => {
    const row = await article();
    await grant("*");
    await expect(
      run(row.id.toUpperCase(), (request) => controller.publishArticle(row.id.toUpperCase(), request)),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await repository.findTarget(row.id.toUpperCase(), owner)).toBeUndefined();
    await prisma.article.update({ where: { id: row.id }, data: { authorId: peer.toUpperCase() } });
    expect(await repository.findTarget(row.id, owner)).toBeUndefined();
    expect(await RamResourceGroupRepository.getInstance().resourceExistsInAccount(arn(row.id), owner)).toBe(false);
  });
  it.each([
    "author",
    "public",
    "requirePermission",
    "state",
    "article-status",
    "author-status",
    "owner-status",
    "actor-status",
  ])("rechecks %s after authorization before committing", async (change) => {
    const row = await article();
    await grant(arn(row.id));
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorize.bind(iam);
    vi.spyOn(iam, "authorize").mockImplementation(async (input) => {
      const result = await original(input);
      if (change === "author") await prisma.article.update({ where: { id: row.id }, data: { authorId: actor } });
      if (change === "public") await prisma.article.update({ where: { id: row.id }, data: { isPublic: true } });
      if (change === "requirePermission")
        await prisma.article.update({ where: { id: row.id }, data: { requirePermission: Permission.ARTICLE_READ } });
      if (change === "state")
        await prisma.article.update({ where: { id: row.id }, data: { publishStatus: "published" } });
      if (change === "article-status") await prisma.article.update({ where: { id: row.id }, data: { status: 0 } });
      if (change.endsWith("-status") && change !== "article-status")
        await prisma.user.update({
          where: { id: change === "author-status" ? peer : change === "owner-status" ? owner : actor },
          data: { status: 0 },
        });
      return result;
    });
    await expect(run(row.id, (request) => service.publishArticle(row.id, actor, request))).rejects.toBeDefined();
    const persisted = await prisma.article.findUniqueOrThrow({ where: { id: row.id } });
    expect(persisted.publishStatus).toBe(change === "state" ? "published" : "draft");
    expect(persisted.publishedAt).toBeNull();
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });
  it("rechecks changed fields even when updateTime is identical", async () => {
    const row = await article(),
      target = (await repository.findTarget(row.id, owner))!;
    await prisma.article.update({ where: { id: row.id }, data: { isPublic: true, updateTime: target.updateTime } });
    await expect(repository.transition(target, owner, actor, "published")).rejects.toMatchObject({ statusCode: 404 });
    expect((await prisma.article.findUniqueOrThrow({ where: { id: row.id } })).publishStatus).toBe("draft");
  });
  it("supports live resource-group membership without widening the publication scope", async () => {
    const row = await article(),
      sibling = await article();
    const group = await ram.createResourceGroup(owner, { name: "publication-group-" + randomUUID() });
    const full = await ram.addResourceGroupMember(owner, group.id, { resourceArn: arn(row.id) });
    const policy = await ram.createPolicy(owner, {
      name: "publication-group-policy-" + randomUUID(),
      document: { Version: "1", Statement: { Effect: "Allow", Action: "quyan:article:Publish", Resource: "*" } },
    });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "resource-group",
      scopeResourceId: group.id,
    });
    expect((await run(row.id, (request) => controller.publishArticle(row.id, request))).publishStatus).toBe(
      "published",
    );
    await expect(run(sibling.id, (request) => controller.publishArticle(sibling.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    await ram.removeResourceGroupMember(owner, group.id, full.members[0].id);
    await expect(run(row.id, (request) => controller.unpublishArticle(row.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("uses trusted request conditions and ignores a forged secure-transport header", async () => {
    const row = await article();
    const policy = await ram.createPolicy(owner, {
      name: "publication-condition-" + randomUUID(),
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:article:Publish",
          Resource: arn(row.id),
          Condition: { Bool: { "acs:SecureTransport": true } },
        },
      },
    });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "account",
    });
    await expect(
      run(row.id, (request) => {
        Object.defineProperty(request, "secure", { value: false });
        request.headers["x-secure-transport"] = "true";
        return controller.publishArticle(row.id, request);
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await run(row.id, (request) => controller.publishArticle(row.id, request))).publishStatus).toBe(
      "published",
    );
  });
  it("uses role-session policies instead of the caller grants and refuses revoked sessions", async () => {
    const row = await article();
    await grant(arn(row.id));
    const role = await prisma.ramRole.create({
      data: { name: "publication-role-" + randomUUID(), accountOwnerId: owner },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Publication fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id };
    await expect(run(row.id, (request) => controller.publishArticle(row.id, request), auth)).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant(arn(row.id), "Allow", "quyan:article:Publish", "role", role.id);
    expect((await run(row.id, (request) => controller.publishArticle(row.id, request), auth)).publishStatus).toBe(
      "published",
    );
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(run(row.id, (request) => controller.unpublishArticle(row.id, request), auth)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(
      (await run(row.id, (request) => controller.unpublishArticle(row.id, request), { subjectType: "access_key" }))
        .publishStatus,
    ).toBe("draft");
  });
  it("fails closed without a principal or when the service actor differs from authentication", async () => {
    const row = await article();
    await grant(arn(row.id));
    await expect(
      run(row.id, (request) => {
        delete request.authContext;
        return service.publishArticle(row.id, actor, request);
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(run(row.id, (request) => service.publishArticle(row.id, peer, request))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each(["legacy", "shadow"] as const)(
    "preserves legacy publication in %s mode while comparing IAM denial",
    async (mode) => {
      const row = await article();
      await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.ARTICLE_PUBLISH] } });
      await grant(arn(row.id), "Deny");
      env.security.iamAuthorizationMode = mode;
      expect((await run(row.id, (request) => controller.publishArticle(row.id, request))).publishStatus).toBe(
        "published",
      );
    },
  );
  it("preserves an existing root publisher grant and refuses disclosure for repeated or unsupported state", async () => {
    const row = await article(owner);
    await prisma.user.update({ where: { id: owner }, data: { permissionAdds: [Permission.ARTICLE_PUBLISH] } });
    expect((await run(row.id, (request) => controller.publishArticle(row.id, request), {}, owner)).publishStatus).toBe(
      "published",
    );
    await expect(run(row.id, (request) => controller.publishArticle(row.id, request), {}, owner)).rejects.toMatchObject(
      { statusCode: 400 },
    );
    await prisma.article.update({ where: { id: row.id }, data: { publishStatus: "unsupported-fixture-state" } });
    await expect(
      run(row.id, (request) => controller.unpublishArticle(row.id, request), {}, owner),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
  it("resolves only metadata and never takes Action or account from client input", async () => {
    const row = await article();
    await run(row.id, async (request) => {
      const principal = getIamPrincipal(request)!;
      expect(await articleResourceResolver({ request, principal })).toBe(arn(row.id));
      expect(await repository.findTarget(row.id, owner)).not.toHaveProperty("content");
      request.params.id = row.id.toUpperCase();
      expect(await articleResourceResolver({ request, principal })).toBeUndefined();
    });
  });
});
