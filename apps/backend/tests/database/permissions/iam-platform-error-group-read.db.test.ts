import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { PlatformErrorGroupReadIamService } from "@/services/system/platform-error-group-read-iam.service";
import { ErrorReportController } from "@/api/controllers/v1/system/error-report.controller";
import { ErrorReportService } from "@/services/system/error-report.service";
import { platformErrorGroupArn } from "@/iam/resources/platform-error-group-resources";
import { PermissionService } from "@/services/users/permission.service";
import type { TypedRequest } from "@/types/express";
const service = PlatformErrorGroupReadIamService.getInstance();
const get = "quyan:system:error_report:GetErrorGroup",
  list = "quyan:system:error_report:ListErrorOccurrences";
let owner: string, actor: string, groupId: string;
let errorIds: string[];
async function user(accountOwnerId?: string) {
  return (
    await prisma.user.create({
      data: {
        username: "error-read-fixture-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
}
async function qualifier(global = true) {
  const row = await prisma.group.create({
    data: {
      username: "error-read-fixture-" + randomUUID(),
      name: "fixture platform",
      level: 0,
      permissions: [Permission.SYSTEM_ERROR_REPORT_READ],
      accountOwnerId: global ? null : owner,
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function createError() {
  const row = await prisma.errorGroup.create({
    data: {
      fingerprint: "error-read-fixture-" + randomUUID(),
      source: "frontend",
      errorType: "Error",
      message: "fixture error",
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
  });
  errorIds.push(row.id);
  return row;
}
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    params: { id: groupId },
    headers: { "x-action": "quyan:ram:CreateUser", "x-account-id": "other" },
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
async function bind(effect: "Allow" | "Deny", action: string, resource = "*", accountOwnerId = owner) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: effect, Action: action, Resource: resource } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId,
    name: "error-read-fixture-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: accountOwnerId },
  });
  return prisma.ramAuthorization.create({
    data: {
      accountOwnerId,
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: accountOwnerId,
    },
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  errorIds = [];
  groupId = (await createError()).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  await prisma.errorGroup.deleteMany({ where: { id: { in: errorIds } } });
});
describe("platform error group resource access", () => {
  it("authorizes actual group metadata and occurrence collections separately", async () => {
    await qualifier();
    const occurrence = await prisma.errorOccurrence.create({
      data: { errorGroupId: groupId, source: "frontend", requestId: "fixture-request", context: { safe: true } },
    });
    const controller = new ErrorReportController();
    expect(await controller.getGroup(groupId, request())).toMatchObject({ id: groupId, message: "fixture error" });
    expect(await controller.listOccurrences(groupId, request(), 1, 10)).toMatchObject({
      items: [{ id: occurrence.id }],
      total: 1,
      page: 1,
      pageSize: 10,
    });
  });
  it("does not read denied summaries or stacks and keeps actions independent", async () => {
    await qualifier();
    await bind("Deny", get, platformErrorGroupArn(groupId));
    const hydrate = vi.spyOn(ErrorReportService.getInstance(), "getGroup");
    await expect(new ErrorReportController().getGroup(groupId, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
    expect(await new ErrorReportController().listOccurrences(groupId, request())).toMatchObject({ total: 0 });
    await bind("Deny", list, platformErrorGroupArn(groupId));
    const occurrences = vi.spyOn(ErrorReportService.getInstance(), "getOccurrences");
    await expect(new ErrorReportController().listOccurrences(groupId, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(occurrences).not.toHaveBeenCalled();
  });
  it("honors a concrete group scope and never returns another group's records", async () => {
    await qualifier();
    const other = await createError();
    await prisma.errorOccurrence.create({
      data: { errorGroupId: other.id, source: "backend", stack: "private fixture" },
    });
    await bind("Deny", "quyan:system:error_report:*", platformErrorGroupArn(other.id));
    const c = new ErrorReportController();
    expect((await c.listOccurrences(groupId, request())).items).toEqual([]);
    await expect(c.listOccurrences(other.id, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(c.getGroup(other.id, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("filters inactive occurrences before pagination and total in enforce mode", async () => {
    await qualifier();
    await prisma.errorOccurrence.create({ data: { errorGroupId: groupId, source: "frontend", status: -1 } });
    const active = await prisma.errorOccurrence.create({ data: { errorGroupId: groupId, source: "frontend" } });
    expect(await new ErrorReportController().listOccurrences(groupId, request(), 1, 1)).toMatchObject({
      items: [{ id: active.id }],
      total: 1,
    });
  });
  it.each(["adds", "private-group", "owner"])(
    "does not let %s or wildcard Allow create platform eligibility",
    async (kind) => {
      if (kind === "adds")
        await prisma.user.update({
          where: { id: actor },
          data: { permissionAdds: [Permission.SYSTEM_ERROR_REPORT_READ] },
        });
      if (kind === "private-group") await qualifier(false);
      const r = request();
      if (kind === "owner") {
        r.user!.userId = owner;
        r.authContext = { principalUserId: owner, accountOwnerId: owner } as any;
      }
      await bind("Allow", "*");
      const hydrate = vi.fn();
      await expect(service.read(get, groupId, r, hydrate)).rejects.toMatchObject({ statusCode: 403 });
      expect(hydrate).not.toHaveBeenCalled();
    },
  );
  it.each(["deny", "group", "disabled-target", "deleted-target", "changed-target", "user"])(
    "withholds response after %s changes during hydration",
    async (kind) => {
      const q = await qualifier();
      await expect(
        service.read(get, groupId, request(), async () => {
          if (kind === "deny") await bind("Deny", get, platformErrorGroupArn(groupId));
          if (kind === "group") await prisma.group.update({ where: { id: q.id }, data: { permissions: [] } });
          if (kind === "disabled-target")
            await prisma.errorGroup.update({ where: { id: groupId }, data: { status: 0 } });
          if (kind === "deleted-target") await prisma.errorGroup.delete({ where: { id: groupId } });
          if (kind === "changed-target")
            await prisma.errorGroup.update({
              where: { id: groupId },
              data: { updateTime: new Date(Date.now() + 1000), message: "changed fixture" },
            });
          if (kind === "user") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
          return "withheld";
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("uses role scope without inheriting group grants and checks session revocation", async () => {
    await qualifier();
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "error-read-fixture-" + randomUUID() },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const r = request();
    Object.assign(r.authContext!, { assumedRoleId: role.id, roleSessionId: session.id });
    const c = new ErrorReportController();
    await expect(c.getGroup(groupId, r)).rejects.toMatchObject({ statusCode: 403 });
    const binding = await bind("Allow", get, platformErrorGroupArn(groupId));
    await prisma.ramAuthorization.update({
      where: { id: binding.id },
      data: { principalType: "role", principalId: role.id },
    });
    expect(await c.getGroup(groupId, r)).toHaveProperty("id", groupId);
    await expect(c.listOccurrences(groupId, r)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.read(get, groupId, r, async () => {
        await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        return "withheld";
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed on a forged account, OAuth principal, missing context or missing target", async () => {
    await qualifier();
    const hydrate = vi.fn();
    for (const kind of ["account", "oauth", "missing", "target"]) {
      const r = request();
      if (kind === "account") r.authContext!.accountOwnerId = actor;
      if (kind === "oauth") r.oauthAccessToken = {} as any;
      if (kind === "missing") delete r.authContext;
      await expect(service.read(get, kind === "target" ? "missing-id" : groupId, r, hydrate)).rejects.toMatchObject({
        statusCode: 403,
      });
    }
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("evaluates an AccessKey principal using the same group and resource gates", async () => {
    await qualifier();
    const r = request();
    r.authContext!.subjectType = "access_key";
    expect(await new ErrorReportController().getGroup(groupId, r)).toHaveProperty("id", groupId);
    await bind("Deny", get, platformErrorGroupArn(groupId));
    await expect(new ErrorReportController().getGroup(groupId, r)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects invalid persisted policy documents without report hydration", async () => {
    await qualifier();
    const binding = await bind("Allow", get);
    const policy = await prisma.ramPolicy.findUniqueOrThrow({ where: { id: binding.policyId } });
    await prisma.ramPolicyVersion.update({
      where: { id: policy.defaultVersionId! },
      data: {
        document: { Version: "1", Statement: { Effect: "Allow", Action: get, Resource: "*", Unexpected: true } },
      },
    });
    const hydrate = vi.fn();
    await expect(service.read(get, groupId, request(), hydrate)).rejects.toThrow();
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("ignores policies attached under another account", async () => {
    await qualifier();
    const other = await user();
    await bind("Deny", get, "*", other);
    expect(await new ErrorReportController().getGroup(groupId, request())).toHaveProperty("id", groupId);
  });
  it.each(["legacy", "shadow"] as const)(
    "preserves %s permission enforcement and response compatibility",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({
        hasPermission: true,
      } as any);
      await bind("Deny", get);
      await bind("Deny", list);
      await prisma.errorOccurrence.create({ data: { errorGroupId: groupId, source: "frontend", status: -1 } });
      const c = new ErrorReportController();
      expect(await c.getGroup(groupId, request())).toHaveProperty("id", groupId);
      expect((await c.listOccurrences(groupId, request())).total).toBe(1);
      vi.mocked(PermissionService.getInstance().checkUserPermissions).mockResolvedValue({
        hasPermission: false,
      } as any);
      await expect(c.getGroup(groupId, request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
});
