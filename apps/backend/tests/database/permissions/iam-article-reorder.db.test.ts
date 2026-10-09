import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { RamService } from "@/services/users/ram.service";
import { ArticleService } from "@/services/article/article.service";
import { ArticleController } from "@/api/controllers/v1/article/article.controller";
import { ArticleManagementRepository } from "@/store/content/article-management.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { articleArn } from "@/iam/resources/article-resources";
import { articleReorderResourceResolver } from "@/iam/request/article-resource-resolvers";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";
import type { ReorderArticleItem } from "@/api/dto/article/article.dto";

const ram = RamService.getInstance(),
  service = ArticleService.getInstance(),
  controller = new ArticleController(),
  repository = ArticleManagementRepository.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string;
const arn = (id: string) => articleArn(owner, id);
const article = (authorId = peer) =>
  prisma.article.create({
    data: {
      authorId,
      title: "Reorder fixture",
      content: "Synthetic batch fixture",
      slug: "reorder-iam-" + randomUUID(),
    },
  });
const run = <T>(items: ReorderArticleItem[], operation: (request: TypedRequest) => Promise<T>, auth = {}) =>
  new AsyncResource("article-reorder-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId: actor },
      params: {},
      body: { items, accountId: foreign, action: "quyan:article:Publish" },
      headers: { "x-action": "quyan:article:Publish", "x-account-id": foreign },
      secure: true,
      ip: "127.0.0.1",
      authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user", ...auth },
    } as unknown as TypedRequest;
    setRequestContext(request);
    return operation(request);
  });
const reorder = (items: ReorderArticleItem[], auth = {}) =>
  run(items, (request) => controller.reorderArticles({ items }, request), auth);
const orders = async (ids: string[]) =>
  (await prisma.article.findMany({ where: { id: { in: ids } }, select: { id: true, sortOrder: true } }))
    .map((row) => row.sortOrder)
    .sort((a, b) => a - b);
async function grant(
  Resource: string | string[],
  Effect: "Allow" | "Deny" = "Allow",
  Action = "quyan:article:ReorderArticles",
  principalType: "user" | "role" = "user",
  principalId = actor,
) {
  const policy = await ram.createPolicy(owner, {
    name: "article-reorder-policy-" + randomUUID(),
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
          username: "article-reorder-user-" + randomUUID(),
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

describe("IAM atomic article reorder", () => {
  it("authorizes each peer article and preserves request-to-target order without altering any other fields", async () => {
    const first = await article(),
      second = await article(actor),
      hidden = await article();
    await grant([arn(first.id), arn(second.id)]);
    const items = [
      { id: second.id, sortOrder: 12 },
      { id: first.id, sortOrder: 7 },
    ];
    const targets = await repository.findTargets(
      items.map((item) => item.id),
      owner,
    );
    expect(targets?.map((target) => target.id)).toEqual(items.map((item) => item.id));
    expect(targets?.[0]).not.toHaveProperty("content");
    expect(await reorder(items)).toEqual({ success: true });
    expect(await prisma.article.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      sortOrder: 7,
      authorId: peer,
      content: first.content,
      publishStatus: "draft",
      isDefault: false,
    });
    expect(await prisma.article.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
      sortOrder: 12,
      authorId: actor,
    });
    expect(await orders([hidden.id])).toEqual([0]);
  });
  it.each(["implicit", "explicit"])("refuses the entire batch when the last row has %s denial", async (kind) => {
    const first = await article(),
      second = await article();
    await grant(kind === "implicit" ? arn(first.id) : [arn(first.id), arn(second.id)]);
    if (kind === "explicit") await grant(arn(second.id), "Deny");
    await expect(
      reorder([
        { id: first.id, sortOrder: 1 },
        { id: second.id, sortOrder: 2 },
      ]),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await orders([first.id, second.id])).toEqual([0, 0]);
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });
  it("independently authorizes actual service arguments instead of trusting a permitted request-body first ID", async () => {
    const first = await article(),
      second = await article();
    await grant(arn(first.id));
    const permittedBody = [{ id: first.id, sortOrder: 1 }],
      actual = [...permittedBody, { id: second.id, sortOrder: 2 }];
    await expect(
      run(permittedBody, (request) => controller.reorderArticles({ items: actual }, request)),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await orders([first.id, second.id])).toEqual([0, 0]);
  });
  it("refuses cross-account rows despite wildcard Allow and forged client account", async () => {
    const first = await article(),
      second = await article(foreign);
    await grant("*");
    await expect(
      reorder([
        { id: first.id, sortOrder: 1 },
        { id: second.id, sortOrder: 2 },
      ]),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await orders([first.id, second.id])).toEqual([0, 0]);
  });
  it.each(["missing", "inactive", "case-alias", "foreign-key-alias"])(
    "refuses a %s batch member without writing the other rows",
    async (kind) => {
      const first = await article(),
        second = await article();
      await grant("*");
      if (kind === "inactive") await prisma.article.update({ where: { id: second.id }, data: { status: 0 } });
      if (kind === "foreign-key-alias")
        await prisma.article.update({ where: { id: second.id }, data: { authorId: peer.toUpperCase() } });
      const id =
        kind === "missing" ? "missing-fixture-id" : kind === "case-alias" ? second.id.toUpperCase() : second.id;
      await expect(
        reorder([
          { id: first.id, sortOrder: 1 },
          { id, sortOrder: 2 },
        ]),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(await orders([first.id, second.id])).toEqual([0, 0]);
    },
  );
  it.each(["author-transfer", "author-status", "actor-status", "visibility", "sort-order", "default"])(
    "rechecks %s drift on every row after authorization",
    async (kind) => {
      const first = await article(actor),
        second = await article(peer);
      await grant("*");
      const iam = IamAuthorizationService.getInstance(),
        original = iam.authorizeMany.bind(iam);
      vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
        const results = await original(input);
        if (kind === "author-transfer")
          await prisma.article.update({ where: { id: second.id }, data: { authorId: foreign } });
        if (kind === "author-status") await prisma.user.update({ where: { id: peer }, data: { status: 0 } });
        if (kind === "actor-status") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
        if (kind === "visibility") await prisma.article.update({ where: { id: second.id }, data: { isPublic: true } });
        if (kind === "sort-order") await prisma.article.update({ where: { id: second.id }, data: { sortOrder: 90 } });
        if (kind === "default") await prisma.article.update({ where: { id: second.id }, data: { isDefault: true } });
        return results;
      });
      const items = [
        { id: first.id, sortOrder: 1 },
        { id: second.id, sortOrder: 2 },
      ];
      await expect(run(items, (request) => service.reorderArticles(items, actor, request))).rejects.toBeDefined();
      expect(await orders([first.id, second.id])).toEqual(kind === "sort-order" ? [0, 90] : [0, 0]);
      expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
    },
  );
  it("rolls back an earlier write when a later database operation fails", async () => {
    const first = await article(),
      second = await article(),
      ids = [first.id, second.id].sort();
    const targets = (await repository.findTargets(ids, owner))!;
    // Deliberate repository-layer fault fixture: bypass HTTP validation to provoke a real MySQL Int overflow on the second write.
    await expect(
      repository.reorder(
        [
          { target: targets[0], sortOrder: 1 },
          { target: targets[1], sortOrder: 2_147_483_648 },
        ],
        owner,
        actor,
      ),
    ).rejects.toBeDefined();
    expect(await orders(ids)).toEqual([0, 0]);
  });
  it.each(["short", "sparse", "unavailable"])("fails closed when the decision response is %s", async (kind) => {
    const first = await article(),
      second = await article();
    await grant("*");
    const iam = IamAuthorizationService.getInstance();
    if (kind === "unavailable")
      vi.spyOn(iam, "authorizeMany").mockRejectedValue(new Error("Synthetic evaluator outage"));
    else vi.spyOn(iam, "authorizeMany").mockResolvedValue(kind === "short" ? [] : new Array(2));
    const items = [
      { id: first.id, sortOrder: 1 },
      { id: second.id, sortOrder: 2 },
    ];
    await expect(run(items, (request) => service.reorderArticles(items, actor, request))).rejects.toBeDefined();
    expect(await orders([first.id, second.id])).toEqual([0, 0]);
  });
  it("does not import editing-only JSON grants into the distinct reorder capability", async () => {
    const row = await article();
    await grant(arn(row.id), "Allow", "quyan:article:Update");
    await expect(reorder([{ id: row.id, sortOrder: 10 }])).rejects.toMatchObject({ statusCode: 403 });
    expect(await orders([row.id])).toEqual([0]);
  });
  it("rejects absent/mismatched identity and ignores an unrelated Action grant", async () => {
    const row = await article(),
      items = [{ id: row.id, sortOrder: 10 }];
    await grant(arn(row.id), "Allow", "quyan:article:Publish");
    await expect(reorder(items)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      run(items, (request) => {
        delete request.authContext;
        return service.reorderArticles(items, actor, request);
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(run(items, (request) => service.reorderArticles(items, peer, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await orders([row.id])).toEqual([0]);
  });
  it("rejects duplicate or oversized batches at the service boundary before persistence", async () => {
    const row = await article();
    await grant("*");
    const duplicate = [
      { id: row.id, sortOrder: 1 },
      { id: row.id, sortOrder: 2 },
    ];
    await expect(run(duplicate, (request) => service.reorderArticles(duplicate, actor, request))).rejects.toMatchObject(
      { statusCode: 400 },
    );
    const large = Array.from({ length: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 1 }, (_, index) => ({
      id: "large-fixture-" + index,
      sortOrder: index,
    }));
    await expect(run(large, (request) => service.reorderArticles(large, actor, request))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(await orders([row.id])).toEqual([0]);
  });
  it("uses live group membership and refuses partial writes after member removal", async () => {
    const first = await article(),
      second = await article(),
      group = await ram.createResourceGroup(owner, { name: "reorder-group-" + randomUUID() });
    await ram.addResourceGroupMember(owner, group.id, { resourceArn: arn(first.id) });
    const full = await ram.addResourceGroupMember(owner, group.id, { resourceArn: arn(second.id) });
    const policy = await ram.createPolicy(owner, {
      name: "reorder-group-policy-" + randomUUID(),
      document: {
        Version: "1",
        Statement: { Effect: "Allow", Action: "quyan:article:ReorderArticles", Resource: "*" },
      },
    });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "resource-group",
      scopeResourceId: group.id,
    });
    const items = [
      { id: first.id, sortOrder: 1 },
      { id: second.id, sortOrder: 2 },
    ];
    expect(await reorder(items)).toEqual({ success: true });
    await ram.removeResourceGroupMember(
      owner,
      group.id,
      full.members.find((member) => member.resourceArn === arn(second.id))!.id,
    );
    await expect(reorder(items.map((item) => ({ ...item, sortOrder: 100 })))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await orders([first.id, second.id])).toEqual([1, 2]);
  });
  it("honors request Conditions and validates role sessions without importing caller policies", async () => {
    const first = await article(),
      second = await article();
    await grant("*");
    const role = await prisma.ramRole.create({ data: { name: "reorder-role-" + randomUUID(), accountOwnerId: owner } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Reorder fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id },
      items = [
        { id: first.id, sortOrder: 1 },
        { id: second.id, sortOrder: 2 },
      ];
    await expect(reorder(items, auth)).rejects.toMatchObject({ statusCode: 403 });
    const policy = await ram.createPolicy(owner, {
      name: "reorder-role-policy-" + randomUUID(),
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:article:ReorderArticles",
          Resource: [arn(first.id), arn(second.id)],
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
        items,
        (request) => {
          Object.defineProperty(request, "secure", { value: false });
          return controller.reorderArticles({ items }, request);
        },
        auth,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await reorder(items, auth)).toEqual({ success: true });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(reorder(items, auth)).rejects.toMatchObject({ statusCode: 403 });
    expect(await reorder(items, { subjectType: "access_key" })).toEqual({ success: true });
  });
  it.each(["legacy", "shadow"] as const)("retains historical reorder permissions in %s mode", async (mode) => {
    const row = await article(actor);
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.ARTICLE_UPDATE] } });
    await grant(arn(row.id), "Deny");
    env.security.iamAuthorizationMode = mode;
    expect(await reorder([{ id: row.id, sortOrder: 10 }])).toEqual({ success: true });
    expect(await orders([row.id])).toEqual([10]);
  });
  it("resolves every persisted member with server-owned account and keeps denied decision audit for the whole batch", async () => {
    const first = await article(),
      second = await article(),
      items = [
        { id: second.id, sortOrder: 2 },
        { id: first.id, sortOrder: 1 },
      ];
    await grant(arn(first.id));
    await run(items, async (request) => {
      expect(await articleReorderResourceResolver({ request, principal: getIamPrincipal(request)! })).toEqual([
        arn(second.id),
        arn(first.id),
      ]);
      await expect(service.reorderArticles(items, actor, request)).rejects.toMatchObject({ statusCode: 403 });
      expect(
        request.iamDecisions?.map((decision) => ({ resource: decision.resource, decision: decision.decision })),
      ).toEqual([
        { resource: arn(second.id), decision: "ImplicitDeny" },
        { resource: arn(first.id), decision: "Allow" },
      ]);
    });
  });
});
