import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformErrorGroupArn } from "@/iam/resources/platform-error-group-resources";
import { PlatformErrorGroupListIamService } from "@/services/system/platform-error-group-list-iam.service";
import { PlatformErrorGroupReadRepository } from "@/store/system/platform-error-group-read.repository";
import { ErrorReportService } from "@/services/system/error-report.service";
import { ErrorReportController } from "@/api/controllers/v1/system/error-report.controller";
import { PermissionService } from "@/services/users/permission.service";
import type { TypedRequest } from "@/types/express";
import type { ErrorGroupQuery } from "@/store/system/observability.repository";
const service = PlatformErrorGroupListIamService.getInstance(),
  repo = PlatformErrorGroupReadRepository.getInstance();
const action = "quyan:system:error_report:ListErrorGroups";
let owner: string, actor: string, prefix: string, ids: string[];
async function user(accountOwnerId?: string) {
  return (
    await prisma.user.create({
      data: {
        username: "error-list-fixture-" + randomUUID(),
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
      username: "error-list-fixture-" + randomUUID(),
      name: "fixture platform",
      level: 0,
      permissions: [Permission.SYSTEM_ERROR_REPORT_READ],
      accountOwnerId: global ? null : owner,
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function create(index: number, extra: any = {}) {
  const row = await prisma.errorGroup.create({
    data: {
      fingerprint: prefix + "-" + index,
      source: "frontend",
      errorType: "fixture-error",
      message: prefix + " " + index,
      firstSeenAt: new Date("2020-01-01"),
      lastSeenAt: new Date(Date.parse("2020-01-01") - index * 1000),
      ...extra,
    },
  });
  ids.push(row.id);
  return row;
}
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    params: {},
    headers: { "x-action": "*" },
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const query = (extra: Partial<ErrorGroupQuery> = {}): ErrorGroupQuery => ({
  page: 1,
  pageSize: 2,
  search: prefix,
  ...extra,
});
async function bind(effect: "Allow" | "Deny", resource = "*", requestedAction = action) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: requestedAction, Resource: resource },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "error-list-fixture-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  return prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  prefix = "error-list-fixture-" + randomUUID();
  ids = [];
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  await prisma.errorGroup.deleteMany({ where: { fingerprint: { startsWith: prefix } } });
});
describe("error group resource-filtered collections", () => {
  it("filters before pagination and total without hydrating denied messages", async () => {
    await qualifier();
    for (let i = 0; i < 5; i++) await create(i);
    await bind("Deny", platformErrorGroupArn(ids[1]));
    const hydrate = vi.spyOn(repo, "hydrate"),
      legacy = vi.spyOn(ErrorReportService.getInstance(), "getGroups");
    const result = await service.list(query({ page: 2 }), request());
    expect(result.items.map((r) => r.id)).toEqual([ids[3], ids[4]]);
    expect(result.total).toBe(4);
    expect(hydrate.mock.calls[0][0].map((r) => r.id)).toEqual([ids[3], ids[4]]);
    expect(legacy).not.toHaveBeenCalled();
  });
  it("returns an empty page without hydration when every candidate is denied", async () => {
    await qualifier();
    await create(0);
    await bind("Deny");
    const hydrate = vi.spyOn(repo, "hydrate");
    expect(await service.list(query(), request())).toEqual({ items: [], total: 0 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("preserves the existing source, status, search and last-seen date filters", async () => {
    await qualifier();
    const selected = await create(0, {
      source: "backend",
      resolutionStatus: "resolved",
      message: prefix + " 中文错误",
    });
    await create(1);
    await create(2, { status: -1, source: "backend", resolutionStatus: "resolved" });
    const result = await service.list(
      query({
        source: "backend",
        resolutionStatus: "resolved",
        search: prefix + " 中文",
        startDate: new Date("2019-12-31"),
        endDate: new Date("2020-01-02"),
      }),
      request(),
    );
    expect(result.items.map((r) => r.id)).toEqual([selected.id]);
    expect(result.total).toBe(1);
    expect(await service.list(query({ startDate: new Date("2020-01-02") }), request())).toEqual({
      items: [],
      total: 0,
    });
  });
  it("orders timestamp ties by id and keeps messages outside the scan projection", async () => {
    await qualifier();
    await create(0);
    await create(1, { lastSeenAt: new Date("2020-01-01") });
    const scan = vi.spyOn(prisma.errorGroup, "findMany");
    const r = await service.list(query(), request());
    expect(r.items.map((t) => t.id)).toEqual([...ids].sort().reverse());
    const first = scan.mock.calls[0][0]!;
    expect(first.select).toEqual({ id: true, status: true, updateTime: true, lastSeenAt: true });
    expect(first).not.toHaveProperty("skip");
  });
  it("scans bounded batches and computes an allowed page beyond the first batch", async () => {
    await qualifier();
    const count = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 3;
    const data = Array.from({ length: count }, (_, i) => ({
      id: "error-list-" + prefix + "-" + i,
      fingerprint: prefix + "-" + i,
      source: "frontend",
      errorType: "Error",
      message: prefix,
      firstSeenAt: new Date("2020-01-01"),
      lastSeenAt: new Date(Date.parse("2020-01-01") - i * 1000),
    }));
    await prisma.errorGroup.createMany({ data });
    const scan = vi.spyOn(repo, "scan"),
      r = request();
    const result = await service.list(query({ page: 251 }), r);
    expect(result.total).toBe(count);
    expect(result.items.map((t) => t.id)).toEqual([data[500].id, data[501].id]);
    expect(scan).toHaveBeenCalledTimes(4);
    expect(r.iamDecisions!.length).toBeLessThanOrEqual(IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
  });
  it.each(["adds", "private-group", "owner"])("cannot manufacture global eligibility with %s", async (kind) => {
    await create(0);
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
    await bind("Allow", "*", "*");
    const hydrate = vi.spyOn(repo, "hydrate");
    await expect(service.list(query(), r)).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it.each(["policy", "off-page-version", "off-page-deletion", "group", "user"])(
    "withholds stale results after %s changes",
    async (kind) => {
      const group = await qualifier();
      await create(0);
      const off = await create(1);
      const original = repo.hydrate.bind(repo);
      vi.spyOn(repo, "hydrate").mockImplementation(async (targets) => {
        const rows = await original(targets);
        if (kind === "policy") await bind("Deny", platformErrorGroupArn(off.id));
        if (kind === "off-page-version")
          await prisma.errorGroup.update({
            where: { id: off.id },
            data: { updateTime: new Date(Date.now() + 1000), message: "changed" },
          });
        if (kind === "off-page-deletion") await prisma.errorGroup.delete({ where: { id: off.id } });
        if (kind === "group") await prisma.group.update({ where: { id: group.id }, data: { permissions: [] } });
        if (kind === "user") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
        return rows;
      });
      await expect(service.list(query({ pageSize: 1 }), request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("keeps newer groups for the next query and rejects backdated additions to its snapshot", async () => {
    await qualifier();
    await create(0);
    const original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (targets) => {
      const rows = await original(targets);
      await create(1, { lastSeenAt: new Date("2025-01-01") });
      return rows;
    });
    expect((await service.list(query(), request())).total).toBe(1);
    vi.restoreAllMocks();
    expect((await service.list(query(), request())).total).toBe(2);
    vi.spyOn(repo, "hydrate").mockImplementation(async (targets) => {
      const rows = await original(targets);
      await create(2, { lastSeenAt: new Date("2019-01-01") });
      return rows;
    });
    await expect(service.list(query(), request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses role ListErrorGroups independently and checks revoked sessions", async () => {
    await qualifier();
    const group = await create(0);
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: prefix } });
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
    expect(await service.list(query(), r)).toEqual({ items: [], total: 0 });
    const binding = await bind("Allow", platformErrorGroupArn(group.id));
    await prisma.ramAuthorization.update({
      where: { id: binding.id },
      data: { principalType: "role", principalId: role.id },
    });
    expect((await service.list(query(), r)).total).toBe(1);
    await expect(new ErrorReportController().getGroup(group.id, r)).rejects.toMatchObject({ statusCode: 403 });
    const original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (targets) => {
      const rows = await original(targets);
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return rows;
    });
    await expect(service.list(query(), r)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("an AccessKey principal uses the same filters and ignores forged Action headers", async () => {
    await qualifier();
    await create(0);
    const r = request();
    r.authContext!.subjectType = "access_key";
    await bind("Deny", "*", "quyan:ram:CreateUser");
    expect((await service.list(query(), r)).total).toBe(1);
    await bind("Deny");
    expect((await service.list(query(), r)).total).toBe(0);
  });
  it.each(["legacy", "shadow"] as const)(
    "keeps %s enforcement and queries legacy display exactly once",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      await qualifier();
      await create(0);
      await bind("Deny");
      vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({
        hasPermission: true,
      } as any);
      const hydrate = vi.spyOn(repo, "hydrate"),
        legacy = vi.spyOn(ErrorReportService.getInstance(), "getGroups");
      expect((await service.list(query(), request())).total).toBe(1);
      expect(legacy).toHaveBeenCalledOnce();
      expect(hydrate).not.toHaveBeenCalled();
    },
  );
});
