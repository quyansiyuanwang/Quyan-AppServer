import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, MANAGED_STATUS } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { ArticleService } from "@/services/article/article.service";
import { ArticleController } from "@/api/controllers/v1/article/article.controller";
import { ArticleManagementRepository } from "@/store/content/article-management.repository";
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
let initialArticleCount: number;
const createdArticleCount = async () => (await prisma.article.count()) - initialArticleCount;
const account = () => "acs:quyan:*:" + owner + ":account";
const input = () => ({
  title: "  Creation fixture  ",
  slug: "creation-iam-" + randomUUID(),
  content: "Synthetic fixture content",
});
const run = <T>(operation: (request: TypedRequest) => Promise<T>, auth = {}, userId = actor) =>
  new AsyncResource("article-creation-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId },
      params: {},
      body: { accountId: foreign, authorId: peer },
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
  Resource = account(),
  Effect: "Allow" | "Deny" = "Allow",
  principalType: "user" | "role" = "user",
  principalId = actor,
) {
  const policy = await ram.createPolicy(owner, {
    name: "article-create-policy-" + randomUUID(),
    document: { Version: "1", Statement: { Effect, Action, Resource } },
  });
  await ram.createAuthorization(owner, { principalType, principalId, policyId: policy.id, scopeType: "account" });
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  initialArticleCount = await prisma.article.count();
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "article-create-user-" + randomUUID(),
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

describe("IAM trusted parent-account article creation", () => {
  it("creates a draft under the current actor without accepting client lifecycle or identity overrides", async () => {
    await grant("quyan:article:Create");
    const dto = {
      ...input(),
      authorId: peer,
      accountId: foreign,
      status: -1,
      publishStatus: "published",
      publishedAt: new Date(),
      isDefault: true,
      sortOrder: 99,
      viewCount: 99,
      id: "forged",
    };
    const result = await run(async (request) => {
      const created = await controller.createArticle(dto, request);
      expect(
        request.iamDecisions?.every(
          (decision) => decision.action === "quyan:article:Create" && decision.resource === account(),
        ),
      ).toBe(true);
      expect(request.iamDecisions?.length).toBeGreaterThan(0);
      return created;
    });
    expect(result).toMatchObject({
      title: "Creation fixture",
      authorId: actor,
      publishStatus: "draft",
      isDefault: false,
      viewCount: 0,
      sortOrder: 0,
    });
    expect(await prisma.article.findUniqueOrThrow({ where: { id: result.id } })).toMatchObject({
      status: MANAGED_STATUS.ENABLED,
      publishedAt: null,
    });
    expect(BusinessLogService.getInstance().logOperation).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: actor, targetResourceId: result.id }),
    );
    await expect(run((request) => controller.publishArticle(result.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      run((request) => controller.updateArticle(result.id, { title: "denied" }, request)),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(run((request) => controller.deleteArticle(result.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("denies direct service creation by default and lets explicit Deny override an account Allow", async () => {
    const dto = input();
    await expect(run((request) => service.createArticle(dto, actor, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant("quyan:article:Create");
    await grant("quyan:article:Create", account(), "Deny");
    await expect(run((request) => controller.createArticle(dto, request))).rejects.toMatchObject({ statusCode: 403 });
    expect(await createdArticleCount()).toBe(0);
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });
  it("cannot create with a concrete article-only wildcard Action grant", async () => {
    const row = await prisma.article.create({ data: { ...input(), authorId: peer } });
    await grant("quyan:article:*", articleArn(owner, row.id));
    await expect(run((request) => controller.createArticle(input(), request))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await createdArticleCount()).toBe(1);
  });
  it("does not widen a resource-scoped authorization into the parent account", async () => {
    const row = await prisma.article.create({ data: { ...input(), authorId: peer } });
    const policy = await ram.createPolicy(owner, {
      name: "article-create-scoped-" + randomUUID(),
      document: {
        Version: "1",
        Statement: { Effect: "Allow", Action: "quyan:article:*", Resource: "*" },
      },
    });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "resource",
      scopeArn: articleArn(owner, row.id),
    });
    await expect(run((request) => controller.createArticle(input(), request))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await createdArticleCount()).toBe(1);
  });
  it.each(["missing", "subject", "principal", "argument", "account", "actor-alias", "owner-alias"])(
    "rejects %s identity before persistence",
    async (kind) => {
      await grant("quyan:article:Create", "*");
      await expect(
        run((request) => {
          if (kind === "missing") delete request.authContext;
          if (kind === "subject") request.user = { ...request.user!, userId: peer };
          if (kind === "principal") request.authContext!.principalUserId = peer;
          if (kind === "account") request.authContext!.accountOwnerId = foreign;
          if (kind === "actor-alias") {
            request.user!.userId = actor.toUpperCase();
            request.authContext!.principalUserId = actor.toUpperCase();
          }
          if (kind === "owner-alias") request.authContext!.accountOwnerId = owner.toUpperCase();
          return service.createArticle(
            input(),
            kind === "argument" ? peer : kind === "actor-alias" ? actor.toUpperCase() : actor,
            request,
          );
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(await createdArticleCount()).toBe(0);
    },
  );
  it.each(["actor-disabled", "actor-reassigned", "actor-account-alias", "owner-disabled", "owner-reassigned"])(
    "rechecks %s in the creation transaction after Allow",
    async (kind) => {
      await grant("quyan:article:Create");
      const iam = IamAuthorizationService.getInstance(),
        original = iam.authorize.bind(iam);
      vi.spyOn(iam, "authorize").mockImplementation(async (request) => {
        const result = await original(request);
        expect(result.decision).toBe("Allow");
        await prisma.user.update({
          where: { id: kind.startsWith("owner") ? owner : actor },
          data: kind.endsWith("disabled")
            ? { status: 0 }
            : { accountOwnerId: kind === "actor-account-alias" ? owner.toUpperCase() : foreign },
        });
        return result;
      });
      await expect(run((request) => service.createArticle(input(), actor, request))).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(await createdArticleCount()).toBe(0);
      expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
    },
  );
  it("rejects malformed input and public permission restrictions without creating anything", async () => {
    await grant("quyan:article:Create");
    for (const dto of [
      { ...input(), title: " " },
      { ...input(), content: "" },
      { ...input(), slug: "../foreign" },
      { ...input(), isPublic: true, requirePermission: Permission.ARTICLE_READ },
    ])
      await expect(run((request) => service.createArticle(dto, actor, request))).rejects.toMatchObject({
        statusCode: 400,
      });
    expect(await createdArticleCount()).toBe(0);
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });
  it.each([MANAGED_STATUS.ENABLED, MANAGED_STATUS.DISABLED, MANAGED_STATUS.DELETED])(
    "preserves global slug uniqueness against a foreign article with status %s",
    async (status) => {
      const dto = input();
      await prisma.article.create({ data: { ...dto, authorId: foreign, status } });
      await grant("quyan:article:Create");
      await expect(run((request) => controller.createArticle(dto, request))).rejects.toMatchObject({
        statusCode: 400,
        messageKey: "article.slugExists",
      });
      expect(await createdArticleCount()).toBe(1);
      expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
    },
  );
  it.each(["P2002", "P2034"])("maps creation database conflict %s to a safe localized response", async (code) => {
    await grant("quyan:article:Create");
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("fixture-only conflict", {
        code,
        clientVersion: Prisma.prismaVersion.client,
      }),
    );
    await expect(run((request) => service.createArticle(input(), actor, request))).rejects.toMatchObject({
      statusCode: code === "P2002" ? 400 : 409,
      messageKey: code === "P2002" ? "article.slugExists" : "errors.conflict",
    });
    expect(await createdArticleCount()).toBe(0);
  });
  it("commits at most one concurrent creation for the same globally unique slug", async () => {
    await grant("quyan:article:Create");
    const dto = input();
    const outcomes = await Promise.allSettled([
      run((request) => service.createArticle(dto, actor, request)),
      run((request) => service.createArticle(dto, actor, request)),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    expect(failure?.status).toBe("rejected");
    if (failure?.status === "rejected") expect([400, 409]).toContain(failure.reason.statusCode);
    expect(await createdArticleCount()).toBe(1);
    expect(BusinessLogService.getInstance().logOperation).toHaveBeenCalledTimes(1);
  });
  it("keeps AccessKey and account-owner creation bound to the executing author", async () => {
    await grant("quyan:article:Create");
    expect(
      (await run((request) => controller.createArticle(input(), request), { subjectType: "access_key" })).authorId,
    ).toBe(actor);
    await grant("quyan:article:Create", account(), "Allow", "user", owner);
    expect((await run((request) => controller.createArticle(input(), request), {}, owner)).authorId).toBe(owner);
  });
  it("uses role Conditions without importing the caller's creation grant", async () => {
    await grant("quyan:article:Create");
    const role = await prisma.ramRole.create({
      data: { name: "article-create-role-" + randomUUID(), accountOwnerId: owner },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Creation fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id };
    await expect(run((request) => controller.createArticle(input(), request), auth)).rejects.toMatchObject({
      statusCode: 403,
    });
    const policy = await ram.createPolicy(owner, {
      name: "article-create-condition-" + randomUUID(),
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:article:Create",
          Resource: account(),
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
      run((request) => {
        Object.defineProperty(request, "secure", { value: false });
        request.headers["x-secure-transport"] = "true";
        return controller.createArticle(input(), request);
      }, auth),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await run((request) => controller.createArticle(input(), request), auth)).authorId).toBe(actor);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(run((request) => service.createArticle(input(), actor, request), auth)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("supports the legacy create bridge with removals remaining explicit Deny", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.ARTICLE_CREATE] } });
    expect((await run((request) => controller.createArticle(input(), request))).authorId).toBe(actor);
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.ARTICLE_CREATE] } });
    await expect(run((request) => controller.createArticle(input(), request))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each(["legacy", "shadow"] as const)("retains legacy enforcement and input isolation in %s mode", async (mode) => {
    await grant("quyan:article:Create", "*", "Deny");
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.ARTICLE_CREATE] } });
    env.security.iamAuthorizationMode = mode;
    const dto = { ...input(), publishStatus: "published", isDefault: true, status: -1, authorId: peer, viewCount: 99 };
    const result = await run((request) => controller.createArticle(dto, request));
    expect(result).toMatchObject({ authorId: actor, publishStatus: "draft", isDefault: false, viewCount: 0 });
    expect((await prisma.article.findUniqueOrThrow({ where: { id: result.id } })).status).toBe(MANAGED_STATUS.ENABLED);
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
    await expect(run((request) => controller.createArticle(input(), request))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("the persistence whitelist also holds for internal repository callers", async () => {
    const result = await ArticleManagementRepository.getInstance().create(
      { ...input(), ...{ publishStatus: "published", authorId: peer, isDefault: true } },
      owner,
      actor,
    );
    expect(result).toMatchObject({ authorId: actor, publishStatus: "draft", isDefault: false, publishedAt: null });
  });
});
