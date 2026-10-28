import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { ArticleService } from "@/services/article/article.service";
import { ArticleController } from "@/api/controllers/v1/article/article.controller";
import { ArticleRepository } from "@/store/content/article.repository";
import { ArticleManagementRepository } from "@/store/content/article-management.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { LegacyPolicyBackfillService } from "@/iam/migration/legacy-policy-backfill.service";
import { articleArn } from "@/iam/resources/article-resources";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const ram = RamService.getInstance(),
  service = ArticleService.getInstance(),
  controller = new ArticleController();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string;
const arn = (id: string) => articleArn(owner, id);
const article = (authorId = peer, publishStatus = "draft", data = {}) =>
  prisma.article.create({
    data: {
      authorId,
      publishStatus,
      title: "List fixture",
      content: "Never return this synthetic body in list metadata",
      slug: "list-iam-" + randomUUID(),
      ...data,
    },
  });
const run = <T>(operation: (request: TypedRequest) => Promise<T>, auth = {}, userId = actor) =>
  new AsyncResource("article-list-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId },
      params: {},
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
  Action: string,
  Resource = "*",
  Effect: "Allow" | "Deny" = "Allow",
  principalType: "user" | "role" = "user",
  principalId = actor,
) {
  const policy = await ram.createPolicy(owner, {
    name: "article-list-policy-" + randomUUID(),
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
          username: "article-list-user-" + randomUUID(),
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
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe("IAM account-isolated article management listing", () => {
  it("returns only exact authorized metadata, including a peer draft, without loading content or implying other capabilities", async () => {
    const allowed = await article(),
      sibling = await article(),
      other = await article(foreign, "published", { isPublic: true });
    await grant("quyan:article:ListArticles", arn(allowed.id));
    const legacyRead = vi.spyOn(ArticleRepository.getInstance(), "findAll");
    const result = await run((request) => controller.listArticles(request));
    expect(ids(result)).toEqual([allowed.id]);
    expect(result[0]).not.toHaveProperty("content");
    expect(legacyRead).not.toHaveBeenCalled();
    expect(ids(result)).not.toContain(sibling.id);
    expect(ids(result)).not.toContain(other.id);
    await expect(
      run((request) => controller.updateArticle(allowed.id, { title: "denied" }, request)),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(run((request) => controller.publishArticle(allowed.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("returns an empty authorized view by default or when an explicit Deny overrides Allow", async () => {
    const row = await article();
    expect(await run((request) => controller.listArticles(request))).toEqual([]);
    await grant("quyan:article:ListArticles", arn(row.id));
    await grant("quyan:article:ListArticles", arn(row.id), "Deny");
    expect(await run((request) => controller.listArticles(request))).toEqual([]);
  });
  it("does not interpret canonical Read or an account-only Read grant as native ListArticles", async () => {
    await article();
    await grant("quyan:article:Read", "*");
    expect(await run((request) => controller.listArticles(request))).toEqual([]);
  });
  it("does not return foreign, inactive-author, inactive-article, malformed-ID or unsupported-state siblings under a wildcard grant", async () => {
    const valid = await article();
    await article(foreign, "published", { isPublic: true });
    await article(peer, "published", { status: 0 });
    await article(peer, "published", { status: -1 });
    await article(peer, "unsupported");
    await article(peer, "published", { id: "invalid/resource" });
    const inactive = await prisma.user.create({
      data: {
        username: "inactive-list-" + randomUUID(),
        password: "fixture-only",
        userType: "ram_user",
        accountOwnerId: owner,
        parentUserId: owner,
        status: 0,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    await article(inactive.id, "published");
    await grant("quyan:article:ListArticles");
    expect(ids(await run((request) => controller.listArticles(request)))).toEqual([valid.id]);
  });
  it("rejects author foreign-key and stored account aliases without hiding a valid sibling", async () => {
    const valid = await article(actor),
      alias = await article(peer);
    await prisma.article.update({ where: { id: alias.id }, data: { authorId: peer.toUpperCase() } });
    await grant("quyan:article:ListArticles");
    expect(ids(await run((request) => controller.listArticles(request)))).toEqual([valid.id]);
    await prisma.user.update({ where: { id: peer }, data: { accountOwnerId: owner.toUpperCase() } });
    expect(ids(await run((request) => controller.listArticles(request)))).toEqual([valid.id]);
  });
  it("applies additional article access requirements after resource authorization", async () => {
    const permitted = await article(peer, "published"),
      restricted = await article(peer, "published", { requirePermission: Permission.RAM_USER_READ });
    await grant("quyan:article:ListArticles");
    expect(ids(await run((request) => controller.listArticles(request)))).toEqual([permitted.id]);
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RAM_USER_READ] } });
    expect(new Set(ids(await run((request) => controller.listArticles(request))))).toEqual(
      new Set([permitted.id, restricted.id]),
    );
  });
  it("checks actual service filters and identity rather than spoofed body, headers or actor arguments", async () => {
    const row = await article(peer, "published", { category: "fixture-category" });
    await grant("quyan:article:ListArticles");
    expect(
      ids(
        await run((request) => service.listArticles(actor, { category: "fixture-category", authorId: peer }, request)),
      ),
    ).toEqual([row.id]);
    expect(await run((request) => service.listArticles(actor, { authorId: foreign }, request))).toEqual([]);
    await expect(service.listArticles(actor)).rejects.toMatchObject({ statusCode: 403 });
    await expect(run((request) => service.listArticles(peer, undefined, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      run((request) => {
        delete request.authContext;
        return controller.listArticles(request);
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      run((request) => service.listArticles(actor, { authorId: "../foreign" }, request)),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it.each(["subject", "principal", "actor-alias", "account-alias"])("rejects %s principal confusion", async (kind) => {
    await grant("quyan:article:ListArticles");
    await expect(
      run((request) => {
        if (kind === "subject") request.user!.userId = peer;
        if (kind === "principal") request.authContext!.principalUserId = peer;
        if (kind === "actor-alias") {
          request.user!.userId = actor.toUpperCase();
          request.authContext!.principalUserId = actor.toUpperCase();
        }
        if (kind === "account-alias") request.authContext!.accountOwnerId = owner.toUpperCase();
        return controller.listArticles(request);
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses bounded database/evaluation pages without truncating the compatible array response", async () => {
    const count = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 2,
      prefix = "bulk-list-" + randomUUID();
    await prisma.article.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        id: prefix + "-" + index.toString().padStart(4, "0"),
        authorId: peer,
        title: "Bulk metadata",
        slug: prefix + "-" + index,
        content: "Synthetic bulk content",
        sortOrder: count - index,
      })),
    });
    await grant("quyan:article:ListArticles");
    const listPage = vi.spyOn(ArticleManagementRepository.getInstance(), "listPage"),
      authorizeMany = vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany");
    const result = await run((request) => controller.listArticles(request));
    expect(result).toHaveLength(count);
    expect(listPage).toHaveBeenCalledTimes(2);
    expect(authorizeMany.mock.calls.map(([request]) => request.resources.length)).toEqual([
      IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
      2,
    ]);
    expect(result.map((row) => row.sortOrder)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    expect(result.every((row) => !("content" in row))).toBe(true);
  });
  it.each(["owner-disabled", "owner-reassigned", "actor-disabled"])(
    "does not rescue %s identity with an empty collection",
    async (change) => {
      await prisma.user.update({
        where: { id: change.startsWith("owner") ? owner : actor },
        data: change.endsWith("disabled") ? { status: 0 } : { accountOwnerId: foreign },
      });
      await expect(run((request) => controller.listArticles(request))).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it.each(["foreign-author", "publication", "requirement", "disabled"])(
    "drops a target that changes %s after its IAM decision",
    async (change) => {
      const row = await article();
      await grant("quyan:article:ListArticles", arn(row.id));
      const iam = IamAuthorizationService.getInstance(),
        original = iam.authorizeMany.bind(iam);
      vi.spyOn(iam, "authorizeMany").mockImplementation(async (request) => {
        const result = await original(request);
        await prisma.article.update({
          where: { id: row.id },
          data: {
            updateTime: row.updateTime,
            ...(change === "foreign-author"
              ? { authorId: foreign }
              : change === "publication"
                ? { publishStatus: "published" }
                : change === "requirement"
                  ? { requirePermission: Permission.RAM_USER_READ }
                  : { status: 0 }),
          },
        });
        return result;
      });
      expect(await run((request) => controller.listArticles(request))).toEqual([]);
    },
  );
  it("fails closed on missing batch decisions or policy/metadata failures", async () => {
    await article();
    await grant("quyan:article:ListArticles");
    const iam = IamAuthorizationService.getInstance();
    vi.spyOn(iam, "authorizeMany").mockResolvedValueOnce([]);
    await expect(run((request) => controller.listArticles(request))).rejects.toMatchObject({ statusCode: 403 });
    vi.spyOn(ArticleManagementRepository.getInstance(), "listPage").mockRejectedValueOnce(
      new Error("synthetic metadata failure"),
    );
    await expect(run((request) => controller.listArticles(request))).rejects.toThrow("synthetic metadata failure");
    vi.spyOn(iam, "loadPolicies").mockRejectedValueOnce(new Error("synthetic policy failure"));
    await expect(run((request) => controller.listArticles(request))).rejects.toThrow("synthetic policy failure");
  });
  it("uses live resource-group membership without widening the listed rows", async () => {
    const row = await article(),
      sibling = await article();
    const group = await ram.createResourceGroup(owner, { name: "article-list-group-" + randomUUID() });
    const member = await ram.addResourceGroupMember(owner, group.id, { resourceArn: arn(row.id) });
    const policy = await ram.createPolicy(owner, {
      name: "article-list-group-policy-" + randomUUID(),
      document: { Version: "1", Statement: { Effect: "Allow", Action: "quyan:article:ListArticles", Resource: "*" } },
    });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "resource-group",
      scopeResourceId: group.id,
    });
    expect(ids(await run((request) => controller.listArticles(request)))).toEqual([row.id]);
    await ram.removeResourceGroupMember(owner, group.id, member.members[0].id);
    expect(await run((request) => controller.listArticles(request))).toEqual([]);
    expect((await prisma.article.findUniqueOrThrow({ where: { id: sibling.id } })).status).toBe(1);
  });
  it("uses role grants instead of caller grants, applies transport Conditions and AccessKey identity", async () => {
    const row = await article();
    await grant("quyan:article:ListArticles", arn(row.id));
    expect(ids(await run((request) => controller.listArticles(request), { subjectType: "access_key" }))).toEqual([
      row.id,
    ]);
    const role = await prisma.ramRole.create({
      data: { name: "article-list-role-" + randomUUID(), accountOwnerId: owner },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "List fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id };
    expect(await run((request) => controller.listArticles(request), auth)).toEqual([]);
    const policy = await ram.createPolicy(owner, {
      name: "article-list-role-policy-" + randomUUID(),
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:article:ListArticles",
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
    expect(ids(await run((request) => controller.listArticles(request), auth))).toEqual([row.id]);
    expect(
      await run((request) => {
        Object.defineProperty(request, "secure", { value: false });
        request.headers["x-secure-transport"] = "true";
        return controller.listArticles(request);
      }, auth),
    ).toEqual([]);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(run((request) => controller.listArticles(request), auth)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["additional", "backfilled"])(
    "preserves legacy own-draft/published visibility for %s grants",
    async (source) => {
      const own = await article(actor),
        published = await article(peer, "published"),
        peerDraft = await article();
      if (source === "additional")
        await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.ARTICLE_READ] } });
      else {
        const policy = await prisma.ramPolicy.create({
          data: {
            accountOwnerId: owner,
            name: "legacy-read-list-" + randomUUID(),
            permissions: [Permission.ARTICLE_READ],
          },
        });
        await prisma.ramPolicyAttachment.create({
          data: { accountOwnerId: owner, policyId: policy.id, targetType: "user", targetId: actor },
        });
        await LegacyPolicyBackfillService.getInstance().run({ accountOwnerId: owner, apply: true });
      }
      expect(new Set(ids(await run((request) => controller.listArticles(request))))).toEqual(
        new Set([own.id, published.id]),
      );
      await grant("quyan:article:ListArticles", arn(peerDraft.id));
      expect(new Set(ids(await run((request) => controller.listArticles(request))))).toEqual(
        new Set([own.id, published.id, peerDraft.id]),
      );
      await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.ARTICLE_READ] } });
      expect(await run((request) => controller.listArticles(request))).toEqual([]);
    },
  );
  it.each(["legacy", "shadow"] as const)("retains legacy permissions and draft guards in %s mode", async (mode) => {
    await grant("quyan:article:ListArticles", "*", "Deny");
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.ARTICLE_READ] } });
    env.security.iamAuthorizationMode = mode;
    const previous = await run((request) => controller.listArticles(request));
    const own = await article(actor),
      published = await article(peer, "published"),
      peerDraft = await article();
    expect(new Set(ids(await run((request) => controller.listArticles(request))))).toEqual(
      new Set([...ids(previous), own.id, published.id]),
    );
    expect(ids(await run((request) => controller.listArticles(request)))).not.toContain(peerDraft.id);
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
    await expect(run((request) => controller.listArticles(request))).rejects.toMatchObject({ statusCode: 403 });
  });
});
