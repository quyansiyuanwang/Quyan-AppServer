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
import * as outbound from "@/util/developer-outbound-url";
import { developerStatusMonitorArn } from "@/iam/resources/developer-resources";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const service = DeveloperProjectManagementService.getInstance();
const controller = new DeveloperProjectController();
const ram = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string;
const projectArn = (id: string) => "acs:developer:*:" + owner + ":project/" + id;
const arn = (projectId: string, id: string) => developerStatusMonitorArn(owner, projectId, id);
const run = <T>(operation: (request: TypedRequest) => Promise<T>, auth = {}) =>
  new AsyncResource("monitor-iam-fixture").runInAsyncScope(async () => {
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
      slug: "monitor-iam-" + randomUUID(),
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
    name: "monitor-iam-" + randomUUID(),
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
          username: "monitor-iam-user-" + randomUUID(),
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

/** Test targets are synthetic; outbound requests are intercepted in the manual-check tests. */
const monitor = (projectId: string, createTime = new Date()) =>
  prisma.developerStatusMonitor.create({
    data: { projectId, createTime, name: "Monitor fixture", targetUrl: "https://1.1.1.1/iam-fixture" },
  });
const stubRequest = () => vi.spyOn(axios, "request").mockResolvedValue({ status: 200, data: "healthy", headers: {} });
describe("IAM status monitor management", () => {
  it("delegates one peer monitor, preserves stored project ownership and keeps manual checking separate", async () => {
    const target = await project(peer),
      row = await monitor(target.id),
      hidden = await monitor(target.id);
    await grant(["quyan:developer:UpdateStatusMonitor", "quyan:developer:DeleteStatusMonitor"], arn(target.id, row.id));
    const changed = await run((request) =>
      controller.updateMonitor(target.id, row.id, { enabled: false, name: "Delegated fixture" }, request),
    );
    expect(changed).toMatchObject({
      id: row.id,
      name: "Delegated fixture",
      enabled: false,
      resourceArn: arn(target.id, row.id),
    });
    const http = stubRequest();
    await expect(run((request) => controller.checkMonitor(target.id, row.id, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(http).not.toHaveBeenCalled();
    expect(await prisma.developerStatusCheck.count({ where: { monitorId: row.id } })).toBe(0);
    await expect(
      run(() => service.updateStatusMonitor(target.id, hidden.id, actor, { enabled: false })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await run((request) => controller.deleteMonitor(target.id, row.id, request));
    expect(await prisma.developerStatusMonitor.findUnique({ where: { id: row.id } })).toBeNull();
    expect((await prisma.developerProject.findUniqueOrThrow({ where: { id: target.id } })).userId).toBe(peer);
    expect((await prisma.developerStatusMonitor.findUniqueOrThrow({ where: { id: hidden.id } })).enabled).toBe(true);
  });
  it("creates on the granted project without implicit authority on the new monitor", async () => {
    const target = await project(peer),
      other = await project(peer);
    const body = {
      name: "Created fixture",
      targetUrl: "https://1.1.1.1/iam-fixture",
      method: "POST" as const,
      requestBody: '{"fixture":true}',
      responseBodyMatchMode: "contains" as const,
      responseBodyMatch: "healthy",
    };
    await expect(run(() => service.createStatusMonitor(target.id, actor, body))).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant("quyan:developer:CreateStatusMonitor", projectArn(target.id));
    const created = await run((request) => controller.createMonitor(target.id, body, request));
    expect(created).toMatchObject({
      method: "POST",
      requestBody: body.requestBody,
      resourceArn: arn(target.id, created.id),
    });
    expect((await prisma.developerStatusMonitor.findUniqueOrThrow({ where: { id: created.id } })).projectId).toBe(
      target.id,
    );
    await expect(run(() => service.createStatusMonitor(other.id, actor, body))).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      run(() => service.updateStatusMonitor(target.id, created.id, actor, { enabled: false })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await run(() => service.listStatusMonitors(target.id, actor))).toEqual([]);
  });
  it("blocks item Deny for updates and outbound checks regardless of client action headers", async () => {
    const target = await project(peer),
      row = await monitor(target.id);
    await grant(["quyan:developer:UpdateStatusMonitor", "quyan:developer:CheckStatusMonitor"], arn(target.id, row.id));
    await grant(
      ["quyan:developer:UpdateStatusMonitor", "quyan:developer:CheckStatusMonitor"],
      arn(target.id, row.id),
      "Deny",
    );
    const http = stubRequest();
    await run(async (request) => {
      request.headers["x-action"] = "quyan:developer:ListStatusMonitors";
      await expect(
        controller.updateMonitor(target.id, row.id, { name: "must-not-write" }, request),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(request.iamDecisions?.at(-1)).toMatchObject({
        action: "quyan:developer:UpdateStatusMonitor",
        decision: "ExplicitDeny",
      });
      expect(JSON.stringify(request.iamDecisions)).not.toContain("must-not-write");
    });
    await expect(run(() => service.checkStatusMonitor(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(http).not.toHaveBeenCalled();
    expect((await prisma.developerStatusMonitor.findUniqueOrThrow({ where: { id: row.id } })).name).toBe(
      "Monitor fixture",
    );
  });
  it("retains SSRF protection and request/response configuration validation after IAM allows a write", async () => {
    const target = await project(peer),
      row = await monitor(target.id);
    await grant("quyan:developer:CreateStatusMonitor", projectArn(target.id));
    await grant("quyan:developer:UpdateStatusMonitor", arn(target.id, row.id));
    await expect(
      run(() =>
        service.createStatusMonitor(target.id, actor, {
          name: "Blocked fixture",
          targetUrl: "http://127.0.0.1/private",
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      run(() => service.updateStatusMonitor(target.id, row.id, actor, { targetUrl: "http://127.0.0.1/private" })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      run(() =>
        service.updateStatusMonitor(target.id, row.id, actor, { method: "GET", requestBody: '{"fixture":true}' }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.developerStatusMonitor.count({ where: { projectId: target.id } })).toBe(1);
    expect((await prisma.developerStatusMonitor.findUniqueOrThrow({ where: { id: row.id } })).targetUrl).toBe(
      "https://1.1.1.1/iam-fixture",
    );
  });
  it("filters each monitor after bounded candidate pagination, excludes disabled rows and exposes no total", async () => {
    const target = await project(peer),
      visible = await monitor(target.id, new Date("2026-01-01T00:00:00Z"));
    await monitor(target.id, new Date("2026-02-01T00:00:00Z"));
    const disabled = await monitor(target.id, new Date("2026-03-01T00:00:00Z"));
    await prisma.developerStatusMonitor.update({ where: { id: disabled.id }, data: { status: 0 } });
    await grant("quyan:developer:ListStatusMonitors", arn(target.id, visible.id));
    expect(await run((request) => controller.listMonitorsPage(target.id, request, 1, 1))).toEqual({
      items: [],
      page: 1,
      pageSize: 1,
      hasNext: true,
    });
    const page = await run((request) => controller.listMonitorsPage(target.id, request, 2, 1));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: visible.id, resourceArn: arn(target.id, visible.id) });
    expect(page.hasNext).toBe(false);
    expect(page).not.toHaveProperty("total");
    await grant("quyan:developer:ListStatusMonitors", arn(target.id, visible.id), "Deny");
    expect(await run((request) => controller.listMonitors(target.id, request))).toEqual([]);
  });
  it("does not expand a project List grant to monitor rows or checks", async () => {
    const target = await project(peer),
      row = await monitor(target.id);
    await grant("quyan:developer:ListStatusMonitors", projectArn(target.id));
    expect((await run(() => service.listStatusMonitorsPage(target.id, actor))).items).toEqual([]);
    await expect(run(() => service.checkStatusMonitor(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rejects cross-project, cross-account, case-aliased and inactive monitors without dispatching", async () => {
    const target = await project(peer),
      other = await project(peer),
      outside = await project(foreign);
    const row = await monitor(target.id),
      remote = await monitor(outside.id);
    const http = stubRequest();
    await grant(
      [
        "quyan:developer:UpdateStatusMonitor",
        "quyan:developer:DeleteStatusMonitor",
        "quyan:developer:CheckStatusMonitor",
      ],
      "acs:developer:*:" + owner + ":status-monitor/*/*",
    );
    for (const [projectId, id] of [
      [other.id, row.id],
      [outside.id, remote.id],
      [target.id, row.id.toUpperCase()],
    ]) {
      await expect(
        run(() => service.updateStatusMonitor(projectId, id, actor, { enabled: false })),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(run(() => service.checkStatusMonitor(projectId, id, actor))).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(run(() => service.deleteStatusMonitor(projectId, id, actor))).rejects.toMatchObject({
        statusCode: 404,
      });
    }
    await prisma.developerStatusMonitor.update({ where: { id: row.id }, data: { status: 0 } });
    await expect(run(() => service.checkStatusMonitor(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      run(() => service.updateStatusMonitor(target.id, row.id, actor, { enabled: false })),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(run(() => service.deleteStatusMonitor(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(http).not.toHaveBeenCalled();
    expect(await prisma.developerStatusCheck.count({ where: { monitorId: row.id } })).toBe(0);
  });
  it("runs only the authorized monitor and stores its check using the original owner's project", async () => {
    const target = await project(peer),
      row = await monitor(target.id),
      other = await monitor(target.id);
    await prisma.developerStatusMonitor.update({
      where: { id: row.id },
      data: {
        method: "POST",
        requestBody: '{"fixture":true}',
        responseBodyMatchMode: "equals",
        responseBodyMatch: "healthy",
      },
    });
    const http = stubRequest();
    await grant("quyan:developer:CheckStatusMonitor", arn(target.id, row.id));
    const checked = await run((request) => controller.checkMonitor(target.id, row.id, request));
    expect(checked).toMatchObject({ id: row.id, lastStatus: "up", resourceArn: arn(target.id, row.id) });
    expect(http).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://1.1.1.1/iam-fixture",
        method: "POST",
        data: '{"fixture":true}',
        maxRedirects: 0,
      }),
    );
    expect(await prisma.developerStatusCheck.count({ where: { monitorId: row.id, checkStatus: "up" } })).toBe(1);
    expect(await prisma.developerStatusCheck.count({ where: { monitorId: other.id } })).toBe(0);
    await expect(run(() => service.checkStatusMonitor(target.id, other.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("validates redirect destinations and records a failed check instead of contacting private addresses", async () => {
    const target = await project(peer),
      row = await monitor(target.id);
    await grant("quyan:developer:CheckStatusMonitor", arn(target.id, row.id));
    const http = vi
      .spyOn(axios, "request")
      .mockResolvedValue({ status: 302, data: "", headers: { location: "http://127.0.0.1/private" } });
    const checked = await run(() => service.checkStatusMonitor(target.id, row.id, actor));
    expect(checked.lastStatus).toBe("down");
    expect(http).toHaveBeenCalledTimes(1);
    expect(await prisma.developerStatusCheck.count({ where: { monitorId: row.id, checkStatus: "down" } })).toBe(1);
  });
  it("stops a redirect chain after the project becomes inactive and persists no check", async () => {
    const target = await project(peer),
      row = await monitor(target.id);
    await grant("quyan:developer:CheckStatusMonitor", arn(target.id, row.id));
    const http = vi.spyOn(axios, "request").mockImplementation(async () => {
      await prisma.developerProject.update({ where: { id: target.id }, data: { status: 0 } });
      return { status: 302, data: "", headers: { location: "https://1.1.1.1/iam-next" } };
    });
    await expect(run(() => service.checkStatusMonitor(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(http).toHaveBeenCalledTimes(1);
    expect(await prisma.developerStatusCheck.count({ where: { monitorId: row.id } })).toBe(0);
  });
  it("uses trusted request conditions when filtering rows and authorizing manual checks", async () => {
    const target = await project(peer),
      row = await monitor(target.id);
    const policy = await ram.createPolicy(owner, {
      name: "monitor-condition-" + randomUUID(),
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: ["quyan:developer:ListStatusMonitors", "quyan:developer:CheckStatusMonitor"],
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
    const http = stubRequest();
    expect((await run(() => service.listStatusMonitorsPage(target.id, actor))).items).toHaveLength(1);
    await run(async (request) => {
      Object.defineProperty(request, "secure", { value: false });
      request.headers["x-secure-transport"] = "true";
      expect((await service.listStatusMonitorsPage(target.id, actor)).items).toEqual([]);
      await expect(service.checkStatusMonitor(target.id, row.id, actor)).rejects.toMatchObject({ statusCode: 403 });
    });
    expect(http).not.toHaveBeenCalled();
  });
  it("rejects mismatched authenticated subjects and disabled actors before dispatch", async () => {
    const target = await project(peer),
      row = await monitor(target.id);
    await grant("quyan:developer:CheckStatusMonitor", arn(target.id, row.id));
    const http = stubRequest();
    await expect(run(() => service.checkStatusMonitor(target.id, row.id, peer))).rejects.toMatchObject({
      statusCode: 403,
    });
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    await expect(run(() => service.checkStatusMonitor(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(http).not.toHaveBeenCalled();
  });
  it.each(["update", "create", "check"] as const)(
    "revalidates the active owner after URL validation for %s",
    async (action) => {
      const target = await project(peer),
        row = await monitor(target.id);
      const http = stubRequest();
      await grant("quyan:developer:CreateStatusMonitor", projectArn(target.id));
      await grant(
        ["quyan:developer:UpdateStatusMonitor", "quyan:developer:CheckStatusMonitor"],
        arn(target.id, row.id),
      );
      const original = outbound.assertSafeOutboundUrl;
      vi.spyOn(outbound, "assertSafeOutboundUrl").mockImplementation(async (url) => {
        const safe = await original(url);
        await prisma.user.update({ where: { id: peer }, data: { status: 0 } });
        return safe;
      });
      const operation =
        action === "create"
          ? () =>
              service.createStatusMonitor(target.id, actor, {
                name: "Blocked fixture",
                targetUrl: "https://1.1.1.1/new",
              })
          : action === "update"
            ? () => service.updateStatusMonitor(target.id, row.id, actor, { targetUrl: "https://1.1.1.1/new" })
            : () => service.checkStatusMonitor(target.id, row.id, actor);
      await expect(run(operation)).rejects.toMatchObject({ statusCode: 404 });
      expect((await prisma.developerStatusMonitor.findUniqueOrThrow({ where: { id: row.id } })).targetUrl).toBe(
        "https://1.1.1.1/iam-fixture",
      );
      expect(await prisma.developerStatusMonitor.count({ where: { projectId: target.id } })).toBe(1);
      expect(http).not.toHaveBeenCalled();
      expect(await prisma.developerStatusCheck.count({ where: { monitorId: row.id } })).toBe(0);
    },
  );
  it("does not commit or emit monitor check data after its row becomes inactive during the outbound call", async () => {
    const target = await project(peer),
      row = await monitor(target.id);
    await grant("quyan:developer:CheckStatusMonitor", arn(target.id, row.id));
    vi.spyOn(axios, "request").mockImplementation(async () => {
      await prisma.developerStatusMonitor.update({ where: { id: row.id }, data: { status: 0 } });
      return { status: 200, data: "healthy", headers: {} };
    });
    await expect(run(() => service.checkStatusMonitor(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(await prisma.developerStatusCheck.count({ where: { monitorId: row.id } })).toBe(0);
    expect((await prisma.developerStatusMonitor.findUniqueOrThrow({ where: { id: row.id } })).lastCheckedAt).toBeNull();
  });
  it("makes group-scoped removal effective on the next request and checks exact parent/member identity", async () => {
    const target = await project(peer),
      row = await monitor(target.id),
      other = await project(peer);
    const group = await ram.createResourceGroup(owner, { name: "monitor-group-" + randomUUID() });
    const full = await ram.addResourceGroupMember(owner, group.id, { resourceArn: arn(target.id, row.id) });
    const policy = await ram.createPolicy(owner, {
      name: "monitor-group-policy-" + randomUUID(),
      document: {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: ["quyan:developer:ListStatusMonitors", "quyan:developer:CheckStatusMonitor"],
          Resource: "acs:developer:*:" + owner + ":status-monitor/*/*",
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
    expect((await run(() => service.listStatusMonitorsPage(target.id, actor))).items).toHaveLength(1);
    await ram.removeResourceGroupMember(owner, group.id, full.members[0].id);
    expect((await run(() => service.listStatusMonitorsPage(target.id, actor))).items).toEqual([]);
    await expect(run(() => service.checkStatusMonitor(target.id, row.id, actor))).rejects.toMatchObject({
      statusCode: 403,
    });
    const groups = RamResourceGroupRepository.getInstance();
    expect(await groups.resourceExistsInAccount(arn(target.id, row.id), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(arn(other.id, row.id), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(arn(target.id, row.id.toUpperCase()), owner)).toBe(false);
    await prisma.developerStatusMonitor.update({ where: { id: row.id }, data: { status: 0 } });
    expect(await groups.resourceExistsInAccount(arn(target.id, row.id), owner)).toBe(false);
  });
  it("uses role grants without importing caller grants and honors AccessKey identity", async () => {
    const target = await project(peer),
      row = await monitor(target.id);
    await grant("quyan:developer:CheckStatusMonitor", arn(target.id, row.id));
    const role = await prisma.ramRole.create({ data: { name: "monitor-role-" + randomUUID(), accountOwnerId: owner } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Monitor fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id };
    const http = stubRequest();
    await expect(run(() => service.checkStatusMonitor(target.id, row.id, actor), auth)).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant("quyan:developer:CheckStatusMonitor", arn(target.id, row.id), "Allow", "role", role.id);
    expect((await run(() => service.checkStatusMonitor(target.id, row.id, actor), auth)).lastStatus).toBe("up");
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(run(() => service.checkStatusMonitor(target.id, row.id, actor), auth)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(
      (await run(() => service.checkStatusMonitor(target.id, row.id, actor), { subjectType: "access_key" })).lastStatus,
    ).toBe("up");
    expect(http).toHaveBeenCalledTimes(2);
  });
  it("fails closed on policy-provider failure for empty lists and performs no outbound request", async () => {
    const target = await project(peer),
      row = await monitor(target.id);
    const http = stubRequest();
    await expect(run(() => service.listStatusMonitorsPage(target.id, actor, { page: 0 }))).rejects.toMatchObject({
      statusCode: 400,
    });
    await prisma.developerStatusMonitor.delete({ where: { id: row.id } });
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockRejectedValue(
      new Error("provider-unavailable"),
    );
    await expect(run(() => service.listStatusMonitorsPage(target.id, actor))).rejects.toThrow("provider-unavailable");
    await expect(run(() => service.checkStatusMonitor(target.id, row.id, actor))).rejects.toThrow(
      "provider-unavailable",
    );
    expect(http).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("retains individual monitor ownership in %s", async (mode) => {
    const own = await project(actor),
      other = await project(peer);
    const row = await monitor(own.id),
      delegated = await monitor(other.id);
    await grant("quyan:developer:UpdateStatusMonitor", arn(other.id, delegated.id));
    env.security.iamAuthorizationMode = mode;
    expect((await run(() => service.updateStatusMonitor(own.id, row.id, actor, { enabled: false }))).enabled).toBe(
      false,
    );
    await expect(
      run(() => service.updateStatusMonitor(other.id, delegated.id, actor, { enabled: false })),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await run(() => service.listStatusMonitorsPage(own.id, actor))).items).toHaveLength(1);
  });
});
