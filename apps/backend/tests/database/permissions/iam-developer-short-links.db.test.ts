import * as outbound from "@/util/developer-outbound-url";
import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { DeveloperProjectManagementService } from "@/services/developer/developer-project-management.service";
import { DeveloperProjectController } from "@/api/controllers/v1/developer/developer-project.controller";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { developerShortLinkArn } from "@/iam/resources/developer-resources";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const service = DeveloperProjectManagementService.getInstance();
const controller = new DeveloperProjectController();
const ram = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string;
const projectArn = (id: string) => "acs:developer:*:" + owner + ":project/" + id;
const arn = (projectId: string, id: string) => developerShortLinkArn(owner, projectId, id);
const run = <T>(operation: (request: TypedRequest) => Promise<T>, auth = {}) =>
  new AsyncResource("short-link-iam-fixture").runInAsyncScope(async () => {
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
      slug: "short-link-iam-" + randomUUID(),
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
    name: "short-link-iam-" + randomUUID(),
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
          username: "short-link-iam-user-" + randomUUID(),
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

const link = (projectId: string, createTime = new Date()) =>
  prisma.developerShortLink.create({
    data: { projectId, createTime, code: "link-fixture-" + randomUUID(), targetUrl: "https://example.com/fixture" },
  });
describe("IAM short-link management", () => {
  it("delegates exactly one peer link, preserves ownership and requires a separate statistical action", async () => {
    const target = await project(peer),
      first = await link(target.id),
      second = await link(target.id);
    await grant(["quyan:developer:UpdateShortLink", "quyan:developer:DeleteShortLink"], arn(target.id, first.id));
    const changed = await run((request) =>
      controller.updateShortLink(target.id, first.id, { enabled: false }, request),
    );
    expect(changed).toMatchObject({ id: first.id, enabled: false, resourceArn: arn(target.id, first.id) });
    await expect(
      run(() => service.updateShortLink(target.id, second.id, actor, { enabled: false })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(run(() => service.getShortLinkStats(target.id, first.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.developerProject.findUniqueOrThrow({ where: { id: target.id } })).userId).toBe(peer);
    await run((request) => controller.deleteShortLink(target.id, first.id, request));
    expect(await prisma.developerShortLink.findUnique({ where: { id: first.id } })).toBeNull();
    expect((await prisma.developerShortLink.findUniqueOrThrow({ where: { id: second.id } })).enabled).toBe(true);
  });
  it("does not let Allow override item Deny or use client action headers to choose the operation", async () => {
    const target = await project(peer),
      row = await link(target.id);
    await grant("quyan:developer:UpdateShortLink", arn(target.id, row.id));
    await grant("quyan:developer:UpdateShortLink", arn(target.id, row.id), "Deny");
    await run(async (request) => {
      request.headers["x-action"] = "quyan:developer:ListShortLinks";
      await expect(controller.updateShortLink(target.id, row.id, { enabled: false }, request)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(request.iamDecisions?.at(-1)).toMatchObject({
        action: "quyan:developer:UpdateShortLink",
        decision: "ExplicitDeny",
      });
    });
    expect((await prisma.developerShortLink.findUniqueOrThrow({ where: { id: row.id } })).enabled).toBe(true);
  });
  it("authorizes creation on the project without granting management of the new link", async () => {
    const target = await project(peer),
      other = await project(peer);
    const body = { targetUrl: "https://1.1.1.1/iam-fixture", code: "created-fixture-" + randomUUID() };
    await expect(run(() => service.createShortLink(target.id, actor, body))).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:developer:CreateShortLink", projectArn(target.id));
    const created = await run((request) => controller.createShortLink(target.id, body, request));
    expect(created.resourceArn).toBe(arn(target.id, created.id));
    expect((await prisma.developerShortLink.findUniqueOrThrow({ where: { id: created.id } })).projectId).toBe(
      target.id,
    );
    await expect(
      run(() => service.createShortLink(other.id, actor, { ...body, code: "another-" + randomUUID() })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      run(() => service.updateShortLink(target.id, created.id, actor, { enabled: false })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await run(() => service.listShortLinksPage(target.id, actor))).items).toEqual([]);
  });
  it("retains the outbound URL guard after IAM allows create or update", async () => {
    const target = await project(peer),
      row = await link(target.id);
    await grant("quyan:developer:CreateShortLink", projectArn(target.id));
    await grant("quyan:developer:UpdateShortLink", arn(target.id, row.id));
    await expect(
      run(() =>
        service.createShortLink(target.id, actor, {
          targetUrl: "http://127.0.0.1/private",
          code: "blocked-" + randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      run(() => service.updateShortLink(target.id, row.id, actor, { targetUrl: "http://127.0.0.1/private" })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerShortLink.count({ where: { projectId: target.id } })).toBe(1);
    expect((await prisma.developerShortLink.findUniqueOrThrow({ where: { id: row.id } })).targetUrl).toBe(
      "https://example.com/fixture",
    );
  });
  it.each(["link", "owner"] as const)(
    "does not write after %s becomes inactive during URL validation",
    async (targetType) => {
      const target = await project(peer),
        row = await link(target.id);
      await grant("quyan:developer:UpdateShortLink", arn(target.id, row.id));
      const validate = outbound.assertSafeOutboundUrl;
      vi.spyOn(outbound, "assertSafeOutboundUrl").mockImplementation(async (url) => {
        const safe = await validate(url);
        if (targetType === "link")
          await prisma.developerShortLink.update({ where: { id: row.id }, data: { status: 0 } });
        else await prisma.user.update({ where: { id: peer }, data: { status: 0 } });
        return safe;
      });
      await expect(
        run(() => service.updateShortLink(target.id, row.id, actor, { targetUrl: "https://1.1.1.1/changed" })),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect((await prisma.developerShortLink.findUniqueOrThrow({ where: { id: row.id } })).targetUrl).toBe(
        "https://example.com/fixture",
      );
    },
  );
  it("rejects cross-project link IDs, disabled links and foreign projects even with wildcard grants", async () => {
    const target = await project(peer),
      other = await project(peer),
      outside = await project(foreign);
    const row = await link(target.id),
      remote = await link(outside.id);
    await grant(
      ["quyan:developer:UpdateShortLink", "quyan:developer:DeleteShortLink", "quyan:developer:GetShortLinkStats"],
      "acs:developer:*:" + owner + ":short-link/*/*",
    );
    await expect(run(() => service.updateShortLink(other.id, row.id, actor, { enabled: false }))).rejects.toMatchObject(
      { statusCode: 404 },
    );
    await expect(run(() => service.deleteShortLink(other.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(run(() => service.getShortLinkStats(outside.id, remote.id, actor))).rejects.toMatchObject({
      statusCode: 404,
    });
    await prisma.developerShortLink.update({ where: { id: row.id }, data: { status: 0 } });
    await expect(
      run(() => service.updateShortLink(target.id, row.id, actor, { enabled: false })),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(run(() => service.deleteShortLink(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(run(() => service.getShortLinkStats(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(await prisma.developerShortLink.count({ where: { id: row.id } })).toBe(1);
  });
  it("filters active list candidates before returning rows, leaves empty pages traversable and exposes no hidden total", async () => {
    const target = await project(peer),
      visible = await link(target.id, new Date("2026-01-01T00:00:00Z"));
    await link(target.id, new Date("2026-02-01T00:00:00Z"));
    const disabled = await link(target.id, new Date("2026-03-01T00:00:00Z"));
    await prisma.developerShortLink.update({ where: { id: disabled.id }, data: { status: 0 } });
    await grant("quyan:developer:ListShortLinks", arn(target.id, visible.id));
    expect(await run((request) => controller.listShortLinksPage(target.id, request, 1, 1))).toEqual({
      items: [],
      page: 1,
      pageSize: 1,
      hasNext: true,
    });
    const page = await run((request) => controller.listShortLinksPage(target.id, request, 2, 1));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: visible.id, resourceArn: arn(target.id, visible.id) });
    expect(page.hasNext).toBe(false);
    expect(page).not.toHaveProperty("total");
    await grant("quyan:developer:ListShortLinks", arn(target.id, visible.id), "Deny");
    expect(await run((request) => controller.listShortLinks(target.id, request))).toEqual([]);
  });
  it("protects visitor detail with GetShortLinkStats and only returns statistics for the granted link", async () => {
    const target = await project(peer),
      row = await link(target.id),
      other = await link(target.id);
    await prisma.developerShortLinkClick.create({
      data: {
        shortLinkId: row.id,
        ipAddress: "127.0.0.1",
        sourceHost: "fixture.example",
        country: "TEST",
        userAgent: "fixture",
      },
    });
    await grant("quyan:developer:ListShortLinks", arn(target.id, row.id));
    await expect(run((request) => controller.getShortLinkStats(target.id, row.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant("quyan:developer:GetShortLinkStats", arn(target.id, row.id));
    const stats = await run((request) => controller.getShortLinkStats(target.id, row.id, request));
    expect(stats).toMatchObject({ linkId: row.id, resourceArn: arn(target.id, row.id), totalRecords: 1 });
    expect(stats.recentClicks[0]).toMatchObject({ ipAddress: "127.0.0.1", sourceHost: "fixture.example" });
    await expect(run(() => service.getShortLinkStats(target.id, other.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("honors resource-group removal and validates link membership against both parent and account", async () => {
    const target = await project(peer),
      row = await link(target.id),
      other = await project(peer);
    const group = await ram.createResourceGroup(owner, { name: "short-links-" + randomUUID() });
    const full = await ram.addResourceGroupMember(owner, group.id, { resourceArn: arn(target.id, row.id) });
    await expect(
      ram.addResourceGroupMember(owner, group.id, { resourceArn: arn(other.id, row.id) }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const policy = await ram.createPolicy(owner, {
      name: "scoped-links-" + randomUUID(),
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:developer:ListShortLinks",
          Resource: "acs:developer:*:" + owner + ":short-link/*/*",
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
    expect((await run(() => service.listShortLinksPage(target.id, actor))).items).toHaveLength(1);
    await ram.removeResourceGroupMember(owner, group.id, full.members[0].id);
    expect((await run(() => service.listShortLinksPage(target.id, actor))).items).toEqual([]);
  });
  it("validates role sessions without inheriting caller link grants and supports authorized AccessKey requests", async () => {
    const target = await project(peer),
      row = await link(target.id);
    await grant("quyan:developer:UpdateShortLink", arn(target.id, row.id));
    expect(
      (
        await run(() => service.updateShortLink(target.id, row.id, actor, { enabled: false }), {
          subjectType: "access_key",
        })
      ).enabled,
    ).toBe(false);
    const role = await prisma.ramRole.create({ data: { name: "link-role-" + randomUUID(), accountOwnerId: owner } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Link fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id };
    await expect(
      run(() => service.updateShortLink(target.id, row.id, actor, { enabled: true }), auth),
    ).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:developer:UpdateShortLink", arn(target.id, row.id), "Allow", "role", role.id);
    expect((await run(() => service.updateShortLink(target.id, row.id, actor, { enabled: true }), auth)).enabled).toBe(
      true,
    );
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(
      run(() => service.updateShortLink(target.id, row.id, actor, { enabled: false }), auth),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed on policy load failures and rejects invalid pagination even for an empty collection", async () => {
    const target = await project(peer);
    await expect(run(() => service.listShortLinksPage(target.id, actor, { page: 0 }))).rejects.toMatchObject({
      statusCode: 400,
    });
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockRejectedValue(
      new Error("provider-unavailable"),
    );
    await expect(run(() => service.listShortLinksPage(target.id, actor))).rejects.toThrow("provider-unavailable");
    await expect(
      run(() => service.createShortLink(target.id, actor, { targetUrl: "https://1.1.1.1/fixture" })),
    ).rejects.toThrow("provider-unavailable");
    expect(await prisma.developerShortLink.count({ where: { projectId: target.id } })).toBe(0);
  });
  it.each(["legacy", "shadow"] as const)("retains personal ownership in %s", async (mode) => {
    const own = await project(actor),
      other = await project(peer);
    const row = await link(own.id),
      delegated = await link(other.id);
    await grant("quyan:developer:UpdateShortLink", arn(other.id, delegated.id));
    env.security.iamAuthorizationMode = mode;
    expect((await run(() => service.updateShortLink(own.id, row.id, actor, { enabled: false }))).enabled).toBe(false);
    await expect(
      run(() => service.updateShortLink(other.id, delegated.id, actor, { enabled: false })),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await run(() => service.listShortLinksPage(own.id, actor))).items).toHaveLength(1);
  });
});
