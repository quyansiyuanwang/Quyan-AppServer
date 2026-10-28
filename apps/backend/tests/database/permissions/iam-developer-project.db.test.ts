import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { DeveloperProjectManagementService } from "@/services/developer/developer-project-management.service";
import { DeveloperProjectController } from "@/api/controllers/v1/developer/developer-project.controller";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const service = DeveloperProjectManagementService.getInstance();
const controller = new DeveloperProjectController();
const ram = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string;
const arn = (id: string, accountId = owner) => "acs:developer:*:" + accountId + ":project/" + id;
const run = <T>(operation: (request: TypedRequest) => Promise<T>, auth = {}) =>
  new AsyncResource("project-management-iam-fixture").runInAsyncScope(async () => {
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
      slug: "project-iam-" + randomUUID(),
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
    name: "project-iam-" + randomUUID(),
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
          username: "project-iam-user-" + randomUUID(),
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

describe("developer project resource management", () => {
  it("authorizes a delegated peer project while preserving its stored ownership", async () => {
    const first = await project(peer),
      second = await project(peer);
    await grant(["quyan:developer:GetProject", "quyan:developer:UpdateStatusPage"], arn(first.id));
    expect((await run((request) => controller.getProject(first.id, request))).id).toBe(first.id);
    await run((request) => controller.updateStatusPage(first.id, { published: true }, request));
    expect(await prisma.developerProject.findUnique({ where: { id: first.id } })).toMatchObject({
      userId: peer,
      statusPagePublished: true,
    });
    await expect(run(() => service.getProject(second.id, actor))).rejects.toMatchObject({ statusCode: 403 });
    await expect(run(() => service.updateStatusPage(second.id, actor, { published: true }))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.developerProject.findUniqueOrThrow({ where: { id: second.id } })).statusPagePublished).toBe(
      false,
    );
  });
  it("rejects foreign, disabled and foreign-owner targets even if their IDs appear in an owner ARN", async () => {
    const foreignProject = await project(foreign),
      disabledProject = await project(peer);
    await prisma.developerProject.update({ where: { id: disabledProject.id }, data: { status: 0 } });
    await grant("quyan:developer:GetProject", "acs:developer:*:" + owner + ":project/*");
    for (const id of [foreignProject.id, disabledProject.id])
      await expect(run(() => service.getProject(id, actor))).rejects.toMatchObject({ statusCode: 404 });
    const peerProject = await project(peer);
    await prisma.user.update({ where: { id: peer }, data: { status: 0 } });
    await expect(run(() => service.getProject(peerProject.id, actor))).rejects.toMatchObject({ statusCode: 404 });
  });
  it("does not turn a client account override into access to a foreign project", async () => {
    const target = await project(foreign);
    await grant("quyan:developer:GetProject", arn(target.id));
    await expect(run(() => service.getProject(target.id, actor))).rejects.toMatchObject({ statusCode: 404 });
  });
  it("requires creation authority on the authenticated user, not on a future project or another user", async () => {
    const body = { name: "Created fixture", slug: "created-iam-" + randomUUID() };
    await expect(run(() => service.createProject(actor, body))).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:developer:CreateProject", "acs:quyan:*:" + owner + ":user/" + peer);
    await expect(run(() => service.createProject(actor, body))).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:developer:CreateProject", "acs:quyan:*:" + owner + ":user/" + actor);
    const created = await run((request) => controller.create(body, request));
    expect((await prisma.developerProject.findUniqueOrThrow({ where: { id: created.id } })).userId).toBe(actor);
  });
  it("lets any matching Deny override project Allow and prevents a write", async () => {
    const target = await project(peer);
    await grant("quyan:developer:UpdateStatusPage", arn(target.id));
    await grant("quyan:developer:UpdateStatusPage", arn(target.id), "Deny");
    await expect(run(() => service.updateStatusPage(target.id, actor, { published: true }))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.developerProject.findUniqueOrThrow({ where: { id: target.id } })).statusPagePublished).toBe(
      false,
    );
  });
  it("paginates account candidates before filtering with empty pages and no hidden total", async () => {
    const visible = await project(peer, new Date("2026-01-01T00:00:00Z"));
    await project(owner, new Date("2026-02-01T00:00:00Z"));
    await project(foreign, new Date("2026-03-01T00:00:00Z"));
    await grant("quyan:developer:ListProjects", arn(visible.id));
    const first = await run((request) => controller.listPage(request, 1, 1));
    expect(first).toEqual({ items: [], page: 1, pageSize: 1, hasNext: true });
    const next = await run((request) => controller.listPage(request, 2, 1));
    expect(next.items.map((item) => item.id)).toEqual([visible.id]);
    expect(next.hasNext).toBe(false);
    expect(next).not.toHaveProperty("total");
  });
  it("defaults to empty results without any project grant even when self-service grants exist", async () => {
    await project(actor);
    expect((await run(() => service.listProjectsPage(actor))).items).toEqual([]);
    expect(await run((request) => controller.list(request))).toEqual([]);
  });
  it("makes revocation and a newly attached Deny visible in the next page request", async () => {
    const visible = await project(peer);
    await grant("quyan:developer:ListProjects", arn(visible.id));
    expect((await run(() => service.listProjectsPage(actor))).items).toHaveLength(1);
    await grant("quyan:developer:ListProjects", arn(visible.id), "Deny");
    expect((await run(() => service.listProjectsPage(actor))).items).toEqual([]);
  });
  it("rejects invalid pagination and policy-provider failure, including an empty collection", async () => {
    await expect(run(() => service.listProjectsPage(actor, { page: 0 }))).rejects.toMatchObject({ statusCode: 400 });
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockRejectedValue(
      new Error("provider-unavailable"),
    );
    await expect(run(() => service.listProjectsPage(actor))).rejects.toThrow("provider-unavailable");
  });
  it("uses role-session grants without importing the caller's project grant", async () => {
    const target = await project(peer);
    await grant("quyan:developer:GetProject", arn(target.id));
    const role = await prisma.ramRole.create({ data: { name: "project-role-" + randomUUID(), accountOwnerId: owner } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Project fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id };
    await expect(run(() => service.getProject(target.id, actor), auth)).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:developer:GetProject", arn(target.id), "Allow", "role", role.id);
    expect((await run(() => service.getProject(target.id, actor), auth)).id).toBe(target.id);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(run(() => service.getProject(target.id, actor), auth)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("permits AccessKey project management only when its effective policy matches", async () => {
    const target = await project(peer);
    await expect(run(() => service.getProject(target.id, actor), { subjectType: "access_key" })).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant("quyan:developer:GetProject", arn(target.id));
    expect((await run(() => service.getProject(target.id, actor), { subjectType: "access_key" })).id).toBe(target.id);
  });
  it.each(["legacy", "shadow"] as const)("retains individual ownership in %s mode", async (mode) => {
    const own = await project(actor),
      other = await project(peer);
    await grant("quyan:developer:GetProject", arn(own.id), "Deny");
    env.security.iamAuthorizationMode = mode;
    expect((await run(() => service.getProject(own.id, actor))).id).toBe(own.id);
    await expect(run(() => service.getProject(other.id, actor))).rejects.toMatchObject({ statusCode: 404 });
    expect((await run(() => service.listProjectsPage(actor))).items.map((item) => item.id)).toEqual([own.id]);
  });
});
