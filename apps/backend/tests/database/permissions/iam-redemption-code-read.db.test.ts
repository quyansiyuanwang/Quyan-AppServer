import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { PlatformRedemptionCodeReadIamService } from "@/services/billing/platform-redemption-code-read-iam.service";
import { PlatformRedemptionCodeReadRepository } from "@/store/billing/platform-redemption-code-read.repository";
import {
  platformRedemptionCodeArn,
  platformRedemptionCodeCollectionArn,
} from "@/iam/resources/platform-redemption-code-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import * as conditions from "@/iam/request/condition-context";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, first: string, second: string, groupId: string;
const mode = env.security.iamAuthorizationMode,
  repository = PlatformRedemptionCodeReadRepository.getInstance(),
  service = PlatformRedemptionCodeReadIamService.getInstance(),
  action = "quyan:redemption_code:ListCodes";
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "redemption-iam-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
async function bind(
  effect: "Allow" | "Deny",
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
    name: "redemption-iam-" + randomUUID(),
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
      username: "redemption-iam-" + randomUUID(),
      name: "fixture-global",
      level: 0,
      permissions: [Permission.REDEMPTION_CODE_READ],
      accountOwnerId: null,
    },
  });
  groupId = group.id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  first = (
    await prisma.redemptionCode.create({
      data: { code: "fixture-only-" + randomUUID(), amount: 10, createdBy: owner, createTime: new Date("2026-01-01") },
    })
  ).id;
  second = (
    await prisma.redemptionCode.create({
      data: { code: "fixture-only-" + randomUUID(), amount: 20, createdBy: actor, createTime: new Date("2026-01-02") },
    })
  ).id;
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
});
describe("persisted redemption resource reads", () => {
  it("preserves eligible global membership and returns safe projection", async () => {
    const result = await service.list(request());
    expect(result).toMatchObject({ total: 2, page: 1, pageSize: 50 });
    expect(result.records.map((row) => row.id)).toEqual([second, first]);
    expect(result.records[0]).not.toHaveProperty("revision");
    expect(result.records[0]).not.toHaveProperty("updateTime");
  });
  it("filters exact Deny before credential hydration and authorized totals", async () => {
    await bind("Deny", [platformRedemptionCodeArn(first)]);
    const hydrate = vi.spyOn(repository, "hydrate");
    expect(await service.list(request())).toMatchObject({ total: 1, records: [{ id: second }] });
    expect(hydrate.mock.calls[0]![1].map((row) => row.id)).toEqual([second]);
  });
  it("denies collection access before metadata reads", async () => {
    await bind("Deny", [platformRedemptionCodeCollectionArn()]);
    const scan = vi.spyOn(repository, "scan");
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(scan).not.toHaveBeenCalled();
  });
  it.each(["personal", "private", "disabled", "wrong"])("does not derive global eligibility from %s", async (kind) => {
    if (kind === "personal") {
      await prisma.user.update({
        where: { id: actor },
        data: { groupId: null, permissionAdds: [Permission.REDEMPTION_CODE_READ] },
      });
    }
    if (kind === "private") await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    if (kind === "disabled") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
    if (kind === "wrong")
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [Permission.REDEMPTION_CODE_CREATE] } });
    await bind("Allow", ["*"]);
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("excludes disabled records and never hydrates their secrets", async () => {
    await prisma.redemptionCode.update({ where: { id: first }, data: { status: 0 } });
    expect(await service.list(request())).toMatchObject({ total: 1, records: [{ id: second }] });
  });
  it("paginates only admitted records", async () => {
    await bind("Deny", [platformRedemptionCodeArn(first)]);
    expect(await service.list(request(), { page: 2, pageSize: 1 })).toMatchObject({ total: 1, page: 2, records: [] });
  });
  it("keeps metadata free of credential values", async () => {
    const rows = await repository.scan({
      subjectUserId: actor,
      principalUserId: actor,
      accountOwnerId: owner,
      subjectType: "sub_user",
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveProperty("revision");
    expect(rows[0]).not.toHaveProperty("code");
    expect(rows[0]).not.toHaveProperty("amount");
  });
  it.each(["code", "amount", "usedBy", "expiresAt"] as const)(
    "rejects changed %s even with preserved updateTime",
    async (field) => {
      const original = repository.hydrate.bind(repository);
      vi.spyOn(repository, "hydrate").mockImplementation(async (p, targets) => {
        const row = await prisma.redemptionCode.findUniqueOrThrow({ where: { id: second } });
        await prisma.redemptionCode.update({
          where: { id: second },
          data: {
            [field]:
              field === "code"
                ? "fixture-only-changed-" + randomUUID()
                : field === "amount"
                  ? 21
                  : field === "usedBy"
                    ? actor
                    : new Date("2027-01-01"),
            updateTime: row.updateTime,
          },
        });
        return original(p, targets);
      });
      await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("rejects a final resource deletion", async () => {
    const original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (p, targets) => {
      const rows = await original(p, targets);
      await prisma.redemptionCode.delete({ where: { id: second } });
      return rows;
    });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a global eligibility change before returning", async () => {
    const original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (p, targets) => {
      const rows = await original(p, targets);
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      return rows;
    });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a policy change after hydration", async () => {
    const original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (p, targets) => {
      const rows = await original(p, targets);
      await bind("Deny", [platformRedemptionCodeArn(second)]);
      return rows;
    });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not inherit the actor's global-group Allow in an assumed role", async () => {
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "fixture-role-" + randomUUID() },
    });
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
    await expect(service.list(req)).rejects.toMatchObject({ statusCode: 403 });
    await bind("Allow", [platformRedemptionCodeCollectionArn(), platformRedemptionCodeArn(second)], "role", role.id);
    expect(await service.list(req)).toMatchObject({ total: 1, records: [{ id: second }] });
  });
  it("applies the same resource scope to authenticated access keys", async () => {
    await bind("Deny", [platformRedemptionCodeArn(first)]);
    const req = request();
    req.authContext!.subjectType = "access_key";
    expect(await service.list(req)).toMatchObject({ total: 1, records: [{ id: second }] });
  });
  it("denies an expired or revoked assumed role", async () => {
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "fixture-role-" + randomUUID() },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture-session",
        tokenJtiHash: randomUUID(),
        expiresAt: new Date(0),
      },
    });
    await bind("Allow", ["*"], "role", role.id);
    const req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    await expect(service.list(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  // Real 500+ resource reads/writes and authorization rechecks need a bounded CI database budget.
  it("does not truncate metadata at the 500-resource boundary", { timeout: 30_000 }, async () => {
    await prisma.redemptionCode.createMany({
      data: Array.from({ length: 501 }, (_, i) => ({
        code: "fixture-only-" + randomUUID(),
        amount: i + 1,
        createdBy: owner,
      })),
    });
    expect(await service.list(request(), { page: 6, pageSize: 100 })).toMatchObject({
      total: 503,
      records: expect.any(Array),
    });
    expect((await service.list(request(), { page: 6, pageSize: 100 })).records).toHaveLength(3);
  });
  it("rechecks real Date conditions after initially admitting credential reads", async () => {
    let now = new Date("2026-10-14T00:00:00Z");
    await bind("Deny", [platformRedemptionCodeArn(second)], "user", actor, {
      DateGreaterThanEquals: { "acs:CurrentTime": "2026-10-14T00:00:01Z" },
    });
    vi.spyOn(conditions, "requestConditionContext").mockImplementation((_request, principal) => ({
      ...conditions.principalConditionContext(principal, now),
      "acs:SecureTransport": true,
    }));
    const original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (principal, targets) => {
      const rows = await original(principal, targets);
      now = new Date("2026-10-14T00:00:02Z");
      return rows;
    });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
