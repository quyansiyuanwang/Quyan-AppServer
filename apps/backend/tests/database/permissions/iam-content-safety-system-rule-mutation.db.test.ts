import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { ContentSafetyService } from "@/services/system/content-safety.service";
import { ContentSafetySystemRuleMutationRepository } from "@/store/system/content-safety-system-rule-mutation.repository";
import { ContentSafetyRepository } from "@/store/system/content-safety.repository";
import { CONTENT_SAFETY_RULE_LIMITS } from "@/constant/content-safety-rule";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { PermissionService } from "@/services/users/permission.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  contentSafetySystemRuleArn,
  contentSafetySystemRuleControlArn,
} from "@/iam/resources/content-safety-system-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, groupId: string, a: string, b: string, privateId: string;
const mode = env.security.iamAuthorizationMode,
  service = ContentSafetyService.getInstance(),
  repository = ContentSafetySystemRuleMutationRepository.getInstance();
const data = () => ({
  name: "Rule",
  type: "literal",
  pattern: "pattern",
  direction: "both",
  action: "allow",
  enabled: true,
  priority: 0,
});
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "safety-write-" + randomUUID(),
        password: "fixture-only-credential",
        userType: accountOwnerId ? "ram_user" : "root",
        accountOwnerId,
        parentUserId: accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*", "x-account-id": "forged" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
async function policy(Action: string, Resource: string, Effect = "Deny", principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect, Action, Resource } });
  const created = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "safety-write-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType,
      principalId,
      policyId: created.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  groupId = (
    await prisma.group.create({
      data: {
        username: "safety-write-group-" + randomUUID(),
        name: "Write fixture",
        level: 5,
        accountOwnerId: null,
        permissions: [Permission.SYSTEM_CONFIG],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  await prisma.contentSafetyRule.deleteMany();
  const rule = async (name: string, ownerUserId?: string) =>
    (await prisma.contentSafetyRule.create({ data: { ...data(), name, ownerUserId } })).id;
  a = await rule("A");
  b = await rule("B");
  privateId = await rule("Private", actor);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("atomic system content safety rules", () => {
  it("creates a server-owned real rule and ignores forged identity fields", async () => {
    const result = await service.createRule(
      { ...data(), id: a, ownerUserId: actor, status: 0, source: "user" },
      request(),
    );
    expect(result.id).not.toBe(a);
    expect(result).toMatchObject({ ownerUserId: null, status: 1, source: "custom", priority: 0 });
    expect(await prisma.contentSafetyRule.count()).toBe(4);
  });
  it.each(["control", "generated"])("denies %s creation authority and leaves no row", async (boundary) => {
    await policy(
      "quyan:content_safety:CreateSystemRule",
      boundary === "control" ? contentSafetySystemRuleControlArn() : "acs:platform:*:platform:content-safety-rule/*",
    );
    await expect(service.createRule({ ...data(), name: "Denied" }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.contentSafetyRule.count({ where: { name: "Denied" } })).toBe(0);
  });
  it("updates only the authorized target and preserves zero priority", async () => {
    const result = await service.updateRule(a, { ...data(), pattern: "updated-pattern" }, request());
    expect(result).toMatchObject({ id: a, pattern: "updated-pattern", priority: 0, ownerUserId: null });
    expect((await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id: b } })).pattern).toBe("pattern");
  });
  it.each(["update", "delete"] as const)("respects independent %s Deny", async (operation) => {
    await policy(
      operation === "update" ? "quyan:content_safety:UpdateSystemRule" : "quyan:content_safety:DeleteSystemRule",
      contentSafetySystemRuleArn(a),
    );
    const promise =
      operation === "update"
        ? service.updateRule(a, { ...data(), name: "Denied" }, request())
        : service.deleteRule(a, request());
    await expect(promise).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id: a } })).toMatchObject({
      name: "A",
      status: 1,
    });
  });
  it("soft-deletes the authorized rule without exposing its body", async () => {
    expect(await service.deleteRule(a, request())).toBeUndefined();
    expect(await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id: a } })).toMatchObject({
      status: 0,
      enabled: false,
    });
    await expect(service.deleteRule(a, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("updates every authorized batch rule atomically", async () => {
    expect(await service.batchUpdateRules([a, b], { enabled: false, priority: 10 }, request())).toEqual({ updated: 2 });
    for (const id of [a, b])
      expect(await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id } })).toMatchObject({
        enabled: false,
        priority: 10,
      });
  });
  it("does not update the first item when a later item is denied", async () => {
    await policy("quyan:content_safety:BatchUpdateSystemRules", contentSafetySystemRuleArn(b));
    await expect(service.batchUpdateRules([a, b], { enabled: false }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    for (const id of [a, b])
      expect((await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id } })).enabled).toBe(true);
  });
  it.each(["private", "missing", "duplicate", "case"])("rejects unsafe batch scope: %s", async (kind) => {
    const ids = [
      a,
      kind === "private" ? privateId : kind === "missing" ? "missing" : kind === "duplicate" ? a : b.toUpperCase(),
    ];
    await expect(service.batchUpdateRules(ids, { enabled: false }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id: a } })).enabled).toBe(true);
  });
  it("does not update or delete private rules through system operations", async () => {
    await expect(service.updateRule(privateId, data(), request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.deleteRule(privateId, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id: privateId } })).status).toBe(1);
  });
  it("keeps regex semantic validation and rolls back invalid patterns", async () => {
    await expect(
      service.createRule({ ...data(), type: "regex", pattern: "[invalid" }, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.createRule({ ...data(), type: "regex", pattern: "(a+)+" }, request())).rejects.toThrow(
      "unsafe construct",
    );
    expect(await prisma.contentSafetyRule.count()).toBe(3);
  });
  it("checks rule capacity in the same transaction as creation", async () => {
    await prisma.contentSafetyRule.createMany({
      data: Array.from({ length: CONTENT_SAFETY_RULE_LIMITS.maxRules - 3 }, (_, i) => ({
        ...data(),
        name: "capacity-" + i,
      })),
    });
    await expect(service.createRule({ ...data(), name: "Over budget" }, request())).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(await prisma.contentSafetyRule.count({ where: { status: 1 } })).toBe(CONTENT_SAFETY_RULE_LIMITS.maxRules);
    await service.deleteRule(a, request());
    expect((await service.createRule({ ...data(), name: "Recovered capacity" }, request())).name).toBe(
      "Recovered capacity",
    );
  });
  it("allows reducing an already exceeded budget but cannot worsen it", async () => {
    await prisma.contentSafetyRule.update({
      where: { id: a },
      data: { pattern: "x".repeat(CONTENT_SAFETY_RULE_LIMITS.maxPatternBytes / 64) },
    });
    await prisma.contentSafetyRule.createMany({
      data: Array.from({ length: 65 }, (_, i) => ({
        ...data(),
        name: "large-" + i,
        pattern: "x".repeat(CONTENT_SAFETY_RULE_LIMITS.maxPatternBytes / 64),
      })),
    });
    await service.updateRule(a, { ...data(), pattern: "shorter" }, request());
    await expect(service.updateRule(b, { ...data(), pattern: "x".repeat(2000) }, request())).rejects.toMatchObject({
      statusCode: 400,
    });
    expect((await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id: b } })).pattern).toBe("pattern");
  });
  it("detects a raw rule mutation with an unchanged timestamp before write", async () => {
    const update = repository.update.bind(repository);
    vi.spyOn(repository, "update").mockImplementation(async (guard, input) => {
      const target = guard.targets[0]!;
      await prisma.contentSafetyRule.update({
        where: { id: target.id },
        data: { pattern: "raw-change", updateTime: target.updateTime },
      });
      return update(guard, input);
    });
    await expect(service.updateRule(a, { ...data(), name: "Should not commit" }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id: a } })).name).toBe("A");
  });
  it("rejects authorization changes before the database mutation", async () => {
    const update = repository.update.bind(repository);
    vi.spyOn(repository, "update").mockImplementation(async (guard, input) => {
      await policy("quyan:content_safety:UpdateSystemRule", "*");
      return update(guard, input);
    });
    await expect(service.updateRule(a, { ...data(), name: "No commit" }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id: a } })).name).toBe("A");
  });
  it("rolls back creation, update, delete and batch if the final guard fails", async () => {
    for (const method of ["create", "update", "remove", "batch"] as const) {
      const operation = repository[method].bind(repository);
      const spy = vi.spyOn(repository, method).mockImplementation(async (guard: any, input?: any) => {
        const recheck = guard.users.recheck;
        let calls = 0;
        return (operation as any)(
          {
            ...guard,
            users: {
              ...guard.users,
              recheck: async () => {
                // authorizeCreated closes over the original guard; this wrapper counts transaction identity checks only.
                if (++calls > 1) throw iamAccountDenied();
                await recheck();
              },
            },
          },
          input,
        );
      });
      const promise =
        method === "create"
          ? service.createRule({ ...data(), name: "No creation" }, request())
          : method === "update"
            ? service.updateRule(a, { ...data(), name: "No update" }, request())
            : method === "remove"
              ? service.deleteRule(a, request())
              : service.batchUpdateRules([a, b], { enabled: false }, request());
      await expect(promise).rejects.toMatchObject({ statusCode: 403 });
      spy.mockRestore();
    }
    expect(await prisma.contentSafetyRule.count()).toBe(3);
    expect(await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id: a } })).toMatchObject({
      name: "A",
      status: 1,
      enabled: true,
    });
    expect((await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id: b } })).enabled).toBe(true);
  });
  it.each(["disabled-actor", "disabled-owner", "private-group", "readonly", "oauth"])(
    "fails closed for %s",
    async (kind) => {
      const req = request();
      if (kind === "disabled-actor") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
      if (kind === "disabled-owner") await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
      if (kind === "private-group")
        await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      if (kind === "readonly") req.user = { ...req.user!, impersonatorId: owner, impersonationMode: "view" };
      if (kind === "oauth") req.oauthAccessToken = {} as never;
      await expect(service.updateRule(a, data(), req)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("does not manufacture platform management eligibility from policies", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await policy("quyan:content_safety:UpdateSystemRule", "*", "Allow");
    await expect(service.updateRule(a, data(), request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses role grants only and stops when a role session is revoked", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "Write role" } }),
      session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: owner,
          roleId: role.id,
          subjectUserId: actor,
          sessionName: "Write",
          tokenJtiHash: randomUUID(),
          expiresAt: new Date(Date.now() + 60000),
        },
      }),
      req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    await expect(service.updateRule(a, data(), req)).rejects.toMatchObject({ statusCode: 403 });
    await policy("quyan:content_safety:UpdateSystemRule", contentSafetySystemRuleArn(a), "Allow", "role", role.id);
    await service.updateRule(a, { ...data(), name: "Role update" }, req);
    await expect(service.updateRule(b, data(), req)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.updateRule(a, data(), req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses the same native checks for AccessKey callers", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    expect((await service.updateRule(a, { ...data(), name: "AccessKey update" }, req)).name).toBe("AccessKey update");
  });
  it("cannot omit the enforced request in direct service calls", async () => {
    for (const promise of [
      service.createRule(data()),
      service.updateRule(a, data()),
      service.deleteRule(a),
      service.batchUpdateRules([a], { enabled: false }),
    ])
      await expect(promise).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("preserves one legacy mutation and enforcement in %s", async (next) => {
    env.security.iamAuthorizationMode = next;
    await policy("quyan:content_safety:CreateSystemRule", "*");
    const create = vi.spyOn(ContentSafetyRepository.getInstance(), "create"),
      nativeCreate = vi.spyOn(repository, "create");
    const result = await service.createRule(data(), request());
    expect(result.id).toBeTruthy();
    expect(create).toHaveBeenCalledOnce();
    expect(nativeCreate).not.toHaveBeenCalled();
    vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({
      hasPermission: false,
      checkedPermissions: [Permission.SYSTEM_CONFIG],
      missingPermissions: [Permission.SYSTEM_CONFIG],
    });
    await expect(service.createRule(data(), request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
