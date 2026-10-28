import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { PlatformRedemptionCodeWriteIamService } from "@/services/billing/platform-redemption-code-write-iam.service";
import { PlatformRedemptionCodeWriteRepository } from "@/store/billing/platform-redemption-code-write.repository";
import { RedemptionCodeService } from "@/services/billing/redemption-code.service";
import { PermissionService } from "@/services/users/permission.service";
import BusinessLogService from "@/services/system/businesslog.service";
import {
  platformRedemptionCodeArn,
  platformRedemptionCodeCollectionArn,
} from "@/iam/resources/platform-redemption-code-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import * as conditions from "@/iam/request/condition-context";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, id: string, groupId: string;
const mode = env.security.iamAuthorizationMode,
  service = PlatformRedemptionCodeWriteIamService.getInstance(),
  repository = PlatformRedemptionCodeWriteRepository.getInstance(),
  engine = IamAuthorizationService.getInstance();
const createAction = "quyan:redemption_code:CreateCodes",
  deleteAction = "quyan:redemption_code:DeleteCode";
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "redemption-write-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
async function bind(
  effect: "Allow" | "Deny",
  action: string,
  resources: string[],
  principalType = "user",
  principalId = actor,
  condition?: Record<string, Record<string, string>>,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: action, Resource: resources, ...(condition ? { Condition: condition } : {}) },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "redemption-write-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType,
      principalId,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
  return policy;
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  await prisma.redemptionCode.deleteMany();
  owner = await user();
  actor = await user(owner);
  const group = await prisma.group.create({
    data: {
      username: "redemption-write-" + randomUUID(),
      name: "fixture-global",
      level: 0,
      permissions: [Permission.REDEMPTION_CODE_CREATE, Permission.REDEMPTION_CODE_DELETE],
      accountOwnerId: null,
    },
  });
  groupId = group.id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  id = (
    await prisma.redemptionCode.create({ data: { code: "fixture-only-" + randomUUID(), amount: 10, createdBy: owner } })
  ).id;
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
});
describe("persisted redemption write resources", () => {
  it("creates an authorized batch atomically with trusted creator", async () => {
    const rows = await service.create({ amount: 12, count: 3 }, actor, request());
    expect(rows).toHaveLength(3);
    expect(new Set(rows!.map((row) => row.code)).size).toBe(3);
    expect(rows!.every((row) => row.createdBy === actor && row.status === 1)).toBe(true);
    expect(await prisma.redemptionCode.count()).toBe(4);
  });
  it("denies collection access before insertion", async () => {
    await bind("Deny", createAction, [platformRedemptionCodeCollectionArn()]);
    await expect(service.create({ amount: 10, count: 3 }, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.redemptionCode.count()).toBe(1);
  });
  it("rolls back every new code on a record-level Deny", async () => {
    await bind("Deny", createAction, ["acs:platform:*:platform:redemption-code/*"]);
    await expect(service.create({ amount: 10, count: 3 }, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.redemptionCode.count()).toBe(1);
  });
  it("deletes only the authorized record", async () => {
    const extra = (
      await prisma.redemptionCode.create({
        data: { code: "fixture-only-" + randomUUID(), amount: 10, createdBy: owner },
      })
    ).id;
    await service.remove(id, actor, request());
    expect(await prisma.redemptionCode.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.redemptionCode.findUnique({ where: { id: extra } })).not.toBeNull();
  });
  it("rejects an exact resource Deny without deleting", async () => {
    await bind("Deny", deleteAction, [platformRedemptionCodeArn(id)]);
    await expect(service.remove(id, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.redemptionCode.count()).toBe(1);
  });
  it("does not reveal unavailable target details", async () => {
    await expect(service.remove("missing-fixture", actor, request())).rejects.toMatchObject({
      statusCode: 403,
      messageKey: "permission.insufficientPermission",
    });
  });
  it("rejects disabled records", async () => {
    await prisma.redemptionCode.update({ where: { id }, data: { status: 0 } });
    await expect(service.remove(id, actor, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["private", "disabled", "personal", "wrong"])("requires actual global eligibility for %s", async (kind) => {
    if (kind === "private") await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    if (kind === "disabled") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
    if (kind === "personal")
      await prisma.user.update({
        where: { id: actor },
        data: { groupId: null, permissionAdds: [Permission.REDEMPTION_CODE_CREATE, Permission.REDEMPTION_CODE_DELETE] },
      });
    if (kind === "wrong")
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [Permission.REDEMPTION_CODE_READ] } });
    await bind("Allow", createAction, ["*"]);
    await expect(service.create({ amount: 10 }, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.redemptionCode.count()).toBe(1);
  });
  it("rejects changed record content with preserved updateTime", async () => {
    const original = repository.remove.bind(repository);
    vi.spyOn(repository, "remove").mockImplementation(async (target, guard) => {
      await prisma.redemptionCode.update({ where: { id }, data: { amount: 11, updateTime: target.updateTime } });
      return original(target, guard);
    });
    await expect(service.remove(id, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.redemptionCode.count()).toBe(1);
  });
  it("rejects an authorization change between preparation and write", async () => {
    const original = repository.create.bind(repository);
    vi.spyOn(repository, "create").mockImplementation(async (input, guard) => {
      await bind("Deny", createAction, ["*"]);
      return original(input, guard);
    });
    await expect(service.create({ amount: 10 }, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.redemptionCode.count()).toBe(1);
  });
  it("rejects changed global permissions even when updateTime is preserved", async () => {
    const original = repository.create.bind(repository);
    vi.spyOn(repository, "create").mockImplementation(async (input, guard) => {
      await prisma.group.update({
        where: { id: groupId },
        data: { permissions: [], updateTime: guard.group.updateTime },
      });
      return original(input, guard);
    });
    await expect(service.create({ amount: 10 }, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.redemptionCode.count()).toBe(1);
  });
  it("rolls back creation if final per-record authorization changes", async () => {
    const original = engine.authorizeMany.bind(engine);
    let recordPasses = 0;
    vi.spyOn(engine, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      if (
        input.action === createAction &&
        input.resources.some((resource) => resource.includes(":redemption-code/")) &&
        ++recordPasses === 2
      )
        return result.map((entry) => ({ ...entry, decision: "ExplicitDeny" }));
      return result;
    });
    await expect(service.create({ amount: 10, count: 2 }, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.redemptionCode.count()).toBe(1);
  });
  it("rolls back deletion if final grant is revoked", async () => {
    const original = engine.authorizeMany.bind(engine);
    let passes = 0;
    vi.spyOn(engine, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      if (input.action === deleteAction && ++passes === 4)
        return result.map((entry) => ({ ...entry, decision: "ExplicitDeny" }));
      return result;
    });
    await expect(service.remove(id, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.redemptionCode.findUnique({ where: { id } })).not.toBeNull();
  });
  it("rechecks real Date conditions after insertion", async () => {
    let now = new Date("2026-10-14T00:00:00Z");
    await bind("Deny", createAction, ["acs:platform:*:platform:redemption-code/*"], "user", actor, {
      DateGreaterThanEquals: { "acs:CurrentTime": "2026-10-14T00:00:01Z" },
    });
    vi.spyOn(conditions, "requestConditionContext").mockImplementation((_request, principal) => ({
      ...conditions.principalConditionContext(principal, now),
      "acs:SecureTransport": true,
    }));
    const original = engine.authorizeMany.bind(engine);
    vi.spyOn(engine, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      if (input.resources.some((resource) => resource.includes(":redemption-code/")))
        now = new Date("2026-10-14T00:00:02Z");
      return result;
    });
    await expect(service.create({ amount: 10, count: 2 }, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.redemptionCode.count()).toBe(1);
  });
  it("uses bounded authorization batches for more than 500 records", async () => {
    const observed = vi.spyOn(engine, "authorizeMany");
    const rows = await service.create({ amount: 10, count: 501 }, actor, request());
    expect(rows).toHaveLength(501);
    expect(await prisma.redemptionCode.count()).toBe(502);
    expect(observed.mock.calls.every(([input]) => input.resources.length <= 500)).toBe(true);
  });
  it("applies resource Deny to authenticated access keys", async () => {
    await bind("Deny", deleteAction, [platformRedemptionCodeArn(id)]);
    const req = request();
    req.authContext!.subjectType = "access_key";
    await expect(service.remove(id, actor, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not inherit global-group policy through AssumeRole", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "fixture-role-" + randomUUID() } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture-session",
        tokenJtiHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    await expect(service.remove(id, actor, req)).rejects.toMatchObject({ statusCode: 403 });
    await bind("Allow", deleteAction, [platformRedemptionCodeArn(id)], "role", role.id);
    await service.remove(id, actor, req);
    expect(await prisma.redemptionCode.count()).toBe(0);
  });
  it.each(["legacy", "shadow"] as const)("preserves the legacy permission gate in %s mode", async (current) => {
    env.security.iamAuthorizationMode = current;
    vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({
      hasPermission: false,
      missingPermissions: [Permission.REDEMPTION_CODE_CREATE],
      checkedPermissions: [Permission.REDEMPTION_CODE_CREATE],
    });
    await expect(
      RedemptionCodeService.getInstance().createCodes({ amount: 10 }, actor, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(RedemptionCodeService.getInstance().deleteCode(id, actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.redemptionCode.count()).toBe(1);
  });
  it("shadow creates exactly once even when native authorization denies", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await bind("Deny", createAction, ["acs:platform:*:platform:redemption-code/*"]);
    const observed = vi.spyOn(engine, "authorizeMany");
    const rows = await RedemptionCodeService.getInstance().createCodes({ amount: 10, count: 2 }, actor, request());
    expect(rows).toHaveLength(2);
    expect(await prisma.redemptionCode.count()).toBe(3);
    expect(
      observed.mock.calls.some(([input]) =>
        rows.every((row) => input.resources.includes(platformRedemptionCodeArn(row.id))),
      ),
    ).toBe(true);
  });
  it("does not put full code values into business audit changes", async () => {
    const logs = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
    const rows = await RedemptionCodeService.getInstance().createCodes({ amount: 10, count: 2 }, actor, request());
    const serialized = JSON.stringify(logs.mock.calls);
    expect(rows.every((row) => !serialized.includes(row.code))).toBe(true);
    await RedemptionCodeService.getInstance().deleteCode(rows[0]!.id, actor, request());
    expect(JSON.stringify(logs.mock.calls)).not.toContain(rows[0]!.code);
  });
  it("does not permit creation with an inactive account owner", async () => {
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(service.create({ amount: 10 }, actor, request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
