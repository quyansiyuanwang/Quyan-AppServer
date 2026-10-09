import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { DeveloperProjectManagementService } from "@/services/developer/developer-project-management.service";
import { DeveloperProjectController } from "@/api/controllers/v1/developer/developer-project.controller";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import axios from "axios";
import { developerPushDeliveryArn } from "@/iam/resources/developer-resources";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { DeveloperPushDeliveryRepository } from "@/store/developer/developer-push-delivery.repository";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const service = DeveloperProjectManagementService.getInstance();
const controller = new DeveloperProjectController();
const ram = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string;
const projectArn = (id: string) => "acs:developer:*:" + owner + ":project/" + id;
const arn = (projectId: string, id: string) => developerPushDeliveryArn(owner, projectId, id);
const run = <T>(operation: (request: TypedRequest) => Promise<T>, auth = {}) =>
  new AsyncResource("push-delivery-iam-fixture").runInAsyncScope(async () => {
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
      slug: "push-delivery-iam-" + randomUUID(),
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
    name: "push-delivery-iam-" + randomUUID(),
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
          username: "push-delivery-iam-user-" + randomUUID(),
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

/** Synthetic payload/error sentinels prove management does not select or expose private delivery contents. */
const channel = (projectId: string) =>
  prisma.developerPushChannel.create({
    data: {
      projectId,
      name: "Delivery channel " + randomUUID(),
      type: "webhook",
      endpoint: "https://1.1.1.1/iam-delivery-fixture",
    },
  });
const delivery = (projectId: string, channelId: string, createTime = new Date()) =>
  prisma.developerPushDelivery.create({
    data: {
      projectId,
      channelId,
      createTime,
      title: "fixture-private-title",
      content: "fixture-private-content",
      idempotencyKey: "fixture-private-request-key",
      errorMessage: "fixture-private-credential https://example.com/?token=fixture-private-token",
      deliveryStatus: "failed",
      attemptCount: 1,
    },
  });
describe("IAM Push Delivery metadata", () => {
  it("delegates a specific peer delivery independently from channel configuration and without dispatching", async () => {
    const target = await project(peer),
      transport = await channel(target.id),
      row = await delivery(target.id, transport.id),
      hidden = await delivery(target.id, transport.id);
    const post = vi.spyOn(axios, "post");
    await grant(["quyan:developer:ListPushDeliveries", "quyan:developer:GetPushDelivery"], arn(target.id, row.id));
    const items = await run((request) => controller.listPushDeliveries(target.id, request));
    expect(items.map((item) => item.id)).toEqual([row.id]);
    const detail = await run((request) => controller.getPushDelivery(target.id, row.id, request));
    expect(detail).toMatchObject({
      id: row.id,
      channelId: transport.id,
      success: false,
      status: "failed",
      attemptCount: 1,
      resourceArn: arn(target.id, row.id),
    });
    expect(JSON.stringify(detail)).not.toContain("fixture-private");
    expect(detail.error).toBeUndefined();
    await expect(run(() => service.getPushDelivery(target.id, hidden.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await run(() => service.listPushChannels(target.id, actor))).toEqual([]);
    await expect(
      run(() => service.updatePushChannel(target.id, transport.id, actor, { enabled: false })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(post).not.toHaveBeenCalled();
    expect((await prisma.developerProject.findUniqueOrThrow({ where: { id: target.id } })).userId).toBe(peer);
  });
  it("does not imply delivery access from channel configuration grants or detail access from listing", async () => {
    const target = await project(peer),
      transport = await channel(target.id),
      row = await delivery(target.id, transport.id);
    await grant(
      "quyan:developer:ListPushChannels",
      "acs:developer:*:" + owner + ":push-channel/" + target.id + "/" + transport.id,
    );
    expect((await run(() => service.listPushDeliveriesPage(target.id, actor))).items).toEqual([]);
    await expect(run(() => service.getPushDelivery(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant("quyan:developer:ListPushDeliveries", arn(target.id, row.id));
    expect((await run(() => service.listPushDeliveriesPage(target.id, actor))).items).toHaveLength(1);
    await expect(run(() => service.getPushDelivery(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("lets matching Deny override Allow and ignores client Action headers", async () => {
    const target = await project(peer),
      transport = await channel(target.id),
      row = await delivery(target.id, transport.id);
    await grant(["quyan:developer:ListPushDeliveries", "quyan:developer:GetPushDelivery"], arn(target.id, row.id));
    await grant(
      ["quyan:developer:ListPushDeliveries", "quyan:developer:GetPushDelivery"],
      arn(target.id, row.id),
      "Deny",
    );
    await run(async (request) => {
      request.headers["x-action"] = "quyan:developer:ListPushChannels";
      await expect(controller.getPushDelivery(target.id, row.id, request)).rejects.toMatchObject({ statusCode: 403 });
      expect(request.iamDecisions?.at(-1)).toMatchObject({
        action: "quyan:developer:GetPushDelivery",
        decision: "ExplicitDeny",
      });
      expect(JSON.stringify(request.iamDecisions)).not.toContain("fixture-private");
    });
    expect((await run(() => service.listPushDeliveriesPage(target.id, actor))).items).toEqual([]);
  });
  it("paginates candidates before filtering and never reads payload or provider error columns", async () => {
    const target = await project(peer),
      transport = await channel(target.id),
      visible = await delivery(target.id, transport.id, new Date("2026-01-01T00:00:00Z"));
    await delivery(target.id, transport.id, new Date("2026-02-01T00:00:00Z"));
    const disabled = await delivery(target.id, transport.id, new Date("2026-03-01T00:00:00Z"));
    await prisma.developerPushDelivery.update({ where: { id: disabled.id }, data: { status: 0 } });
    await grant("quyan:developer:ListPushDeliveries", arn(target.id, visible.id));
    const query = vi.spyOn(prisma.developerPushDelivery, "findMany");
    expect(await run((request) => controller.listPushDeliveriesPage(target.id, request, 1, 1))).toEqual({
      items: [],
      page: 1,
      pageSize: 1,
      hasNext: true,
    });
    const page = await run((request) => controller.listPushDeliveriesPage(target.id, request, 2, 1));
    expect(page.items.map((item) => item.id)).toEqual([visible.id]);
    expect(page.hasNext).toBe(false);
    expect(page).not.toHaveProperty("total");
    expect(JSON.stringify(page)).not.toContain("fixture-private");
    for (const [args] of query.mock.calls) {
      for (const field of ["title", "content", "errorMessage", "idempotencyKey"])
        expect(args?.select).not.toHaveProperty(field);
      expect(args?.take).toBe(2);
      expect(args?.where).toMatchObject({
        projectId: target.id,
        project: { userId: peer },
        channel: { projectId: target.id },
      });
    }
  });
  it("does not widen a project List grant to child deliveries", async () => {
    const target = await project(peer),
      transport = await channel(target.id);
    await delivery(target.id, transport.id);
    await grant("quyan:developer:ListPushDeliveries", projectArn(target.id));
    expect(await run(() => service.listPushDeliveries(target.id, actor))).toEqual([]);
  });
  it("rejects cross-project, foreign-account, case-aliased and inactive targets", async () => {
    const target = await project(peer),
      other = await project(peer),
      outside = await project(foreign);
    const transport = await channel(target.id),
      foreignChannel = await channel(outside.id);
    const row = await delivery(target.id, transport.id),
      external = await delivery(outside.id, foreignChannel.id);
    await grant("quyan:developer:GetPushDelivery", "acs:developer:*:" + owner + ":push-delivery/*/*");
    for (const [p, id] of [
      [other.id, row.id],
      [outside.id, external.id],
      [target.id, row.id.toUpperCase()],
      [target.id.toUpperCase(), row.id],
    ])
      await expect(run(() => service.getPushDelivery(p, id, actor))).rejects.toMatchObject({ statusCode: 404 });
    await prisma.developerPushDelivery.update({ where: { id: row.id }, data: { status: 0 } });
    await expect(run(() => service.getPushDelivery(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 404,
    });
  });
  it("requires the channel and delivery to share the same real project", async () => {
    const target = await project(peer),
      other = await project(peer),
      transport = await channel(other.id),
      corrupt = await delivery(target.id, transport.id);
    await grant(
      ["quyan:developer:ListPushDeliveries", "quyan:developer:GetPushDelivery"],
      "acs:developer:*:" + owner + ":push-delivery/*/*",
    );
    expect((await run(() => service.listPushDeliveriesPage(target.id, actor))).items).toEqual([]);
    await expect(run(() => service.getPushDelivery(target.id, corrupt.id, actor))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(
      await RamResourceGroupRepository.getInstance().resourceExistsInAccount(arn(target.id, corrupt.id), owner),
    ).toBe(false);
  });
  it.each(["project", "channel"] as const)(
    "rejects noncanonical historical %s foreign keys without breaking pagination",
    async (key) => {
      const target = await project(peer),
        transport = await channel(target.id);
      const visible = await delivery(target.id, transport.id, new Date("2026-01-01T00:00:00Z"));
      const corrupt = await delivery(target.id, transport.id, new Date("2026-02-01T00:00:00Z"));
      await prisma.developerPushDelivery.update({
        where: { id: corrupt.id },
        data: key === "project" ? { projectId: target.id.toUpperCase() } : { channelId: transport.id.toUpperCase() },
      });
      await grant(
        ["quyan:developer:ListPushDeliveries", "quyan:developer:GetPushDelivery"],
        "acs:developer:*:" + owner + ":push-delivery/*/*",
      );
      await expect(run(() => service.getPushDelivery(target.id, corrupt.id, actor))).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(await run(() => service.listPushDeliveriesPage(target.id, actor, { page: 1, pageSize: 1 }))).toEqual({
        items: [],
        page: 1,
        pageSize: 1,
        hasNext: true,
      });
      expect(
        (await run(() => service.listPushDeliveriesPage(target.id, actor, { page: 2, pageSize: 1 }))).items.map(
          (row) => row.id,
        ),
      ).toEqual([visible.id]);
      expect(
        await RamResourceGroupRepository.getInstance().resourceExistsInAccount(arn(target.id, corrupt.id), owner),
      ).toBe(false);
    },
  );
  it.each(["channel", "project", "owner"] as const)(
    "requires an active %s while paused channels remain inspectable",
    async (kind) => {
      const target = await project(peer),
        transport = await channel(target.id),
        row = await delivery(target.id, transport.id);
      await grant(["quyan:developer:ListPushDeliveries", "quyan:developer:GetPushDelivery"], arn(target.id, row.id));
      await prisma.developerPushChannel.update({ where: { id: transport.id }, data: { enabled: false } });
      expect((await run(() => service.getPushDelivery(target.id, row.id, actor))).id).toBe(row.id);
      if (kind === "channel")
        await prisma.developerPushChannel.update({ where: { id: transport.id }, data: { status: 0 } });
      if (kind === "project") await prisma.developerProject.update({ where: { id: target.id }, data: { status: 0 } });
      if (kind === "owner") await prisma.user.update({ where: { id: peer }, data: { status: 0 } });
      await expect(run(() => service.getPushDelivery(target.id, row.id, actor))).rejects.toMatchObject({
        statusCode: 404,
      });
      if (kind === "channel")
        expect((await run(() => service.listPushDeliveriesPage(target.id, actor))).items).toEqual([]);
      else
        await expect(run(() => service.listPushDeliveriesPage(target.id, actor))).rejects.toMatchObject({
          statusCode: 404,
        });
      expect(
        await RamResourceGroupRepository.getInstance().resourceExistsInAccount(arn(target.id, row.id), owner),
      ).toBe(false);
    },
  );
  it("rechecks resource-group membership and cleanup after channel deletion", async () => {
    const target = await project(peer),
      transport = await channel(target.id),
      row = await delivery(target.id, transport.id);
    const group = await ram.createResourceGroup(owner, { name: "delivery-group-" + randomUUID() });
    const full = await ram.addResourceGroupMember(owner, group.id, { resourceArn: arn(target.id, row.id) });
    const policy = await ram.createPolicy(owner, {
      name: "delivery-group-policy-" + randomUUID(),
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: ["quyan:developer:ListPushDeliveries", "quyan:developer:GetPushDelivery"],
          Resource: "acs:developer:*:" + owner + ":push-delivery/*/*",
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
    expect((await run(() => service.listPushDeliveriesPage(target.id, actor))).items).toHaveLength(1);
    await ram.removeResourceGroupMember(owner, group.id, full.members[0].id);
    expect((await run(() => service.listPushDeliveriesPage(target.id, actor))).items).toEqual([]);
    await expect(run(() => service.getPushDelivery(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(
      await RamResourceGroupRepository.getInstance().resourceExistsInAccount(
        arn(target.id, row.id.toUpperCase()),
        owner,
      ),
    ).toBe(false);
    await prisma.developerPushChannel.delete({ where: { id: transport.id } });
    expect(await prisma.developerPushDelivery.findUnique({ where: { id: row.id } })).toBeNull();
    expect(await RamResourceGroupRepository.getInstance().resourceExistsInAccount(arn(target.id, row.id), owner)).toBe(
      false,
    );
  });
  it("applies trusted request Conditions independently for page and detail access", async () => {
    const target = await project(peer),
      transport = await channel(target.id),
      row = await delivery(target.id, transport.id);
    const policy = await ram.createPolicy(owner, {
      name: "delivery-condition-" + randomUUID(),
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: ["quyan:developer:ListPushDeliveries", "quyan:developer:GetPushDelivery"],
          Resource: arn(target.id, row.id),
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
    expect((await run(() => service.getPushDelivery(target.id, row.id, actor))).id).toBe(row.id);
    await run(async (request) => {
      Object.defineProperty(request, "secure", { value: false });
      request.headers["x-secure-transport"] = "true";
      expect((await service.listPushDeliveriesPage(target.id, actor)).items).toEqual([]);
      await expect(service.getPushDelivery(target.id, row.id, actor)).rejects.toMatchObject({ statusCode: 403 });
    });
  });
  it("uses role policies without importing caller grants and validates revoked sessions and AccessKey subjects", async () => {
    const target = await project(peer),
      transport = await channel(target.id),
      row = await delivery(target.id, transport.id);
    await grant("quyan:developer:GetPushDelivery", arn(target.id, row.id));
    const role = await prisma.ramRole.create({
      data: { name: "delivery-role-" + randomUUID(), accountOwnerId: owner },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Delivery fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id };
    await expect(run(() => service.getPushDelivery(target.id, row.id, actor), auth)).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant("quyan:developer:GetPushDelivery", arn(target.id, row.id), "Allow", "role", role.id);
    expect((await run(() => service.getPushDelivery(target.id, row.id, actor), auth)).id).toBe(row.id);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(run(() => service.getPushDelivery(target.id, row.id, actor), auth)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await run(() => service.getPushDelivery(target.id, row.id, actor), { subjectType: "access_key" })).id).toBe(
      row.id,
    );
  });
  it.each(["missing", "misaligned"] as const)("fails closed on a %s candidate eligibility mask", async (kind) => {
    const target = await project(peer),
      transport = await channel(target.id),
      row = await delivery(target.id, transport.id);
    await grant("quyan:developer:ListPushDeliveries", arn(target.id, row.id));
    vi.spyOn(DeveloperPushDeliveryRepository.getInstance(), "listCandidates").mockResolvedValue({
      rows: [
        {
          id: row.id,
          channelId: transport.id,
          status: "failed",
          success: false,
          attemptCount: 0,
          createTime: row.createTime.toISOString(),
          updateTime: row.updateTime.toISOString(),
        },
      ],
      ...(kind === "missing" ? {} : { eligibility: [] }),
    } as never);
    await expect(run(() => service.listPushDeliveriesPage(target.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("fails closed on provider errors even for an empty list and blocks impersonation", async () => {
    const target = await project(peer),
      transport = await channel(target.id),
      row = await delivery(target.id, transport.id);
    await expect(run(() => service.listPushDeliveriesPage(target.id, actor, { page: 0 }))).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(run(() => service.getPushDelivery(target.id, row.id, peer))).rejects.toMatchObject({
      statusCode: 403,
    });
    await prisma.developerPushDelivery.delete({ where: { id: row.id } });
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockRejectedValue(
      new Error("provider-unavailable"),
    );
    await expect(run(() => service.listPushDeliveriesPage(target.id, actor))).rejects.toThrow("provider-unavailable");
    await expect(run(() => service.getPushDelivery(target.id, row.id, actor))).rejects.toThrow("provider-unavailable");
  });
  it.each(["legacy", "shadow"] as const)(
    "preserves personal array shape in %s without exposing errors or granting peer access",
    async (mode) => {
      const own = await project(actor),
        target = await project(peer),
        ownChannel = await channel(own.id),
        peerChannel = await channel(target.id);
      const row = await delivery(own.id, ownChannel.id),
        peerRow = await delivery(target.id, peerChannel.id);
      await grant("quyan:developer:ListPushDeliveries", arn(target.id, peerRow.id));
      env.security.iamAuthorizationMode = mode;
      const items = await run(() => service.listPushDeliveries(own.id, actor));
      expect(items[0].error).toBeUndefined();
      expect(items[0].failureReason).toBe("dispatch_failed");
      expect(items[0].id).toBe(row.id);
      await expect(run(() => service.listPushDeliveries(target.id, actor))).rejects.toMatchObject({ statusCode: 404 });
      expect((await run(() => service.listPushDeliveriesPage(own.id, actor))).items[0].error).toBeUndefined();
    },
  );
});
