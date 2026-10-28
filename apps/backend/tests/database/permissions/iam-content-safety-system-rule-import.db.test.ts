import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { ContentSafetyService } from "@/services/system/content-safety.service";
import { ContentSafetySystemRuleMutationRepository } from "@/store/system/content-safety-system-rule-mutation.repository";
import { ContentSafetySystemReadRepository } from "@/store/system/content-safety-system-read.repository";
import { ContentSafetyRepository } from "@/store/system/content-safety.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  contentSafetySystemRuleArn,
  contentSafetySystemRuleControlArn,
} from "@/iam/resources/content-safety-system-resources";
import { DEFAULT_CONTENT_SAFETY_RULES } from "@/util/content-safety-defaults";
import { CONTENT_SAFETY_RULE_LIMITS } from "@/constant/content-safety-rule";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, groupId: string, a: string, privateId: string;
const mode = env.security.iamAuthorizationMode,
  service = ContentSafetyService.getInstance(),
  repository = ContentSafetySystemRuleMutationRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "rule-import-" + randomUUID(),
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
const data = (name = "A") => ({
  name,
  type: "literal",
  pattern: "pattern-" + name,
  direction: "both",
  action: "allow",
  enabled: true,
  priority: 0,
});
const csv = (...rows: string[]) => "id,name,type,pattern,direction,action,enabled,priority\n" + rows.join("\n");
const newRow = (name = "New") => `,${name},literal,pattern-${name},both,allow,true,0`;
async function deny(operation: "ImportSystemRules" | "ImportDefaultSystemRules", Resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:content_safety:" + operation, Resource },
  });
  const created = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "Import deny " + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
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
        username: "rule-import-group-" + randomUUID(),
        name: "Rule import fixture",
        level: 5,
        accountOwnerId: null,
        permissions: [Permission.SYSTEM_CONFIG],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  await prisma.contentSafetyRule.deleteMany();
  a = (await prisma.contentSafetyRule.create({ data: { ...data(), source: "custom" } })).id;
  privateId = (
    await prisma.contentSafetyRule.create({ data: { ...data("Private"), ownerUserId: actor, source: "user" } })
  ).id;
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("atomic system rule imports", () => {
  it("previews safely without writing then creates and updates atomically", async () => {
    const input = csv(`${a},Changed,literal,changed-pattern,both,blackhole,true,0`, newRow());
    const preview = await service.importCsv(input, "preview", true, request());
    expect(preview).toMatchObject({ imported: 1, updated: 1, errors: [] });
    expect(await prisma.contentSafetyRule.count()).toBe(2);
    expect(preview.operations[0]).toMatchObject({ id: a, oldValue: { name: "A" } });
    const result = await service.importCsv(input, "apply", true, request());
    expect(result).toMatchObject({ imported: 1, updated: 1 });
    expect(await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id: a } })).toMatchObject({
      name: "Changed",
      source: "csv",
      ownerUserId: null,
      priority: 0,
    });
    expect((await prisma.contentSafetyRule.findFirstOrThrow({ where: { name: "New" } })).priority).toBe(0);
    expect((await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id: privateId } })).name).toBe("Private");
  });
  it("retains overwrite=false and preserves default provenance on overwrite", async () => {
    await prisma.contentSafetyRule.update({ where: { id: a }, data: { source: "default" } });
    const input = csv(`${a},Changed,literal,changed-pattern,both,allow,true,0`, newRow());
    expect(await service.importCsv(input, "apply", false, request())).toMatchObject({
      imported: 1,
      updated: 0,
      skipped: 1,
    });
    expect((await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id: a } })).name).toBe("A");
    await service.importCsv(csv(`${a},Changed,literal,changed-pattern,both,allow,true,0`), "apply", true, request());
    expect((await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id: a } })).source).toBe("default");
  });
  it("imports the real default set idempotently and ignores private duplicates", async () => {
    await prisma.contentSafetyRule.create({
      data: { ...DEFAULT_CONTENT_SAFETY_RULES[0]!, source: "default", ownerUserId: actor },
    });
    expect(await service.importDefaults(request())).toEqual({ created: DEFAULT_CONTENT_SAFETY_RULES.length });
    expect(await service.importDefaults(request())).toEqual({ created: 0 });
    expect(await prisma.contentSafetyRule.count({ where: { source: "default", ownerUserId: null } })).toBe(
      DEFAULT_CONTENT_SAFETY_RULES.length,
    );
  });
  it.each(["control", "generated"])("denies %s default import without partial writes", async (boundary) => {
    await deny(
      "ImportDefaultSystemRules",
      boundary === "control" ? contentSafetySystemRuleControlArn() : "acs:platform:*:platform:content-safety-rule/*",
    );
    await expect(service.importDefaults(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.contentSafetyRule.count()).toBe(2);
  });
  it("does not read a denied existing default body", async () => {
    const row = await prisma.contentSafetyRule.create({
      data: { ...DEFAULT_CONTENT_SAFETY_RULES[0]!, source: "default" },
    });
    await deny("ImportDefaultSystemRules", contentSafetySystemRuleArn(row.id));
    const hydrate = vi.spyOn(ContentSafetySystemReadRepository.getInstance(), "hydrate");
    await expect(service.importDefaults(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it.each(["control", "generated", "existing", "private", "missing"])(
    "rejects %s CSV resources atomically",
    async (boundary) => {
      if (boundary === "control") await deny("ImportSystemRules", contentSafetySystemRuleControlArn());
      if (boundary === "generated") await deny("ImportSystemRules", "acs:platform:*:platform:content-safety-rule/*");
      if (boundary === "existing") await deny("ImportSystemRules", contentSafetySystemRuleArn(a));
      const id = boundary === "private" ? privateId : boundary === "missing" ? "missing-id" : a;
      const input =
        boundary === "generated"
          ? csv(newRow())
          : csv(`${id},Changed,literal,changed-pattern,both,blackhole,true,0`, newRow());
      await expect(service.importCsv(input, "apply", true, request())).rejects.toMatchObject({ statusCode: 403 });
      expect(await prisma.contentSafetyRule.count()).toBe(2);
      expect((await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id: a } })).name).toBe("A");
    },
  );
  it("rejects a later generated rule and rolls back earlier creations and edits", async () => {
    const apply = repository.applyImport.bind(repository);
    vi.spyOn(repository, "applyImport").mockImplementation(async (guard, operations) => {
      let created = 0;
      const check = guard.authorizeCreated;
      return apply(
        {
          ...guard,
          authorizeCreated: async (id) => {
            if (++created > 1) throw iamAccountDenied();
            await check(id);
          },
        },
        operations,
      );
    });
    await expect(
      service.importCsv(
        csv(`${a},Changed,literal,changed-pattern,both,blackhole,true,0`, newRow("First"), newRow("Second")),
        "apply",
        true,
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.contentSafetyRule.count()).toBe(2);
    expect((await prisma.contentSafetyRule.findUniqueOrThrow({ where: { id: a } })).name).toBe("A");
  });
  it.each(["insert", "raw-edit", "authorization", "group"])("detects %s after planning", async (kind) => {
    const apply = repository.applyImport.bind(repository);
    vi.spyOn(repository, "applyImport").mockImplementation(async (guard, operations) => {
      if (kind === "insert") await prisma.contentSafetyRule.create({ data: data("Concurrent") });
      if (kind === "raw-edit")
        await prisma.$executeRaw`UPDATE content_safety_rules SET pattern='changed-outside' WHERE id=${a}`;
      if (kind === "authorization") await deny("ImportSystemRules", contentSafetySystemRuleControlArn());
      if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      return apply(guard, operations);
    });
    await expect(service.importCsv(csv(newRow()), "apply", true, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.contentSafetyRule.count({ where: { name: "New" } })).toBe(0);
  });
  it("rolls back everything when the final guard fails", async () => {
    const apply = repository.applyImport.bind(repository);
    vi.spyOn(repository, "applyImport").mockImplementation(async (guard, operations) => {
      let calls = 0;
      const check = guard.users.recheck;
      return apply(
        {
          ...guard,
          users: {
            ...guard.users,
            recheck: async () => {
              if (++calls > 1) throw iamAccountDenied();
              await check();
            },
          },
        },
        operations,
      );
    });
    await expect(service.importCsv(csv(newRow()), "apply", true, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.contentSafetyRule.count()).toBe(2);
  });
  it.each(["missing-allow", "allow", "deny"])("evaluates independent role import authority for %s", async (kind) => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "Import role " + randomUUID() } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "Import",
        tokenJtiHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    if (kind !== "missing-allow") {
      const parsed = parseIamPolicy({
        Version: "1",
        Statement: [
          {
            Effect: "Allow",
            Action: "quyan:content_safety:ImportSystemRules",
            Resource: [contentSafetySystemRuleControlArn(), "acs:platform:*:platform:content-safety-rule/*"],
          },
          ...(kind === "deny"
            ? [
                {
                  Effect: "Deny",
                  Action: "quyan:content_safety:ImportSystemRules",
                  Resource: "acs:platform:*:platform:content-safety-rule/*",
                },
              ]
            : []),
        ],
      });
      const policy = await RamPolicyRepository.getInstance().createPolicy({
        accountOwnerId: owner,
        name: "Role import " + randomUUID(),
        permissions: [],
        iamVersion: { ...parsed, createdBy: owner },
      });
      await prisma.ramAuthorization.create({
        data: {
          accountOwnerId: owner,
          principalType: "role",
          principalId: role.id,
          policyId: policy.id,
          scopeType: "account",
          scopeKey: "account",
          createdBy: owner,
        },
      });
    }
    if (kind === "allow")
      expect(await service.importCsv(csv(newRow()), "apply", true, req)).toMatchObject({ imported: 1 });
    else {
      await expect(service.importCsv(csv(newRow()), "apply", true, req)).rejects.toMatchObject({ statusCode: 403 });
      expect(await prisma.contentSafetyRule.count()).toBe(2);
    }
  });
  it("checks the combined capacity atomically", async () => {
    await prisma.contentSafetyRule.createMany({
      data: Array.from({ length: CONTENT_SAFETY_RULE_LIMITS.maxRules - 3 }, (_, index) => data("Budget-" + index)),
    });
    await expect(
      service.importCsv(csv(newRow("First"), newRow("Second")), "apply", false, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.contentSafetyRule.count()).toBe(CONTENT_SAFETY_RULE_LIMITS.maxRules - 1);
  });
  it.each(["invalid", "duplicate", "unterminated"])("does not write %s CSV", async (kind) => {
    const input =
      kind === "invalid"
        ? csv(",Bad,literal,ok,both,typo,true,0")
        : kind === "duplicate"
          ? csv(newRow(), newRow())
          : csv(',"unterminated');
    if (kind === "unterminated")
      await expect(service.importCsv(input, "apply", true, request())).rejects.toMatchObject({ statusCode: 400 });
    else expect((await service.importCsv(input, "apply", true, request())).errors.length).toBeGreaterThan(0);
    expect(await prisma.contentSafetyRule.count()).toBe(2);
  });
  it.each(["no-context", "readonly", "oauth", "disabled-owner"])("fails closed for %s", async (kind) => {
    const req = request();
    if (kind === "readonly") req.user = { ...req.user!, impersonatorId: owner, impersonationMode: "view" };
    if (kind === "oauth") req.oauthAccessToken = {} as any;
    if (kind === "disabled-owner") await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(
      service.importCsv(csv(newRow()), "apply", true, kind === "no-context" ? undefined : req),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.contentSafetyRule.count()).toBe(2);
  });
  it.each(["legacy", "shadow"] as const)("executes one real legacy CSV import in %s", async (next) => {
    env.security.iamAuthorizationMode = next;
    const old = vi.spyOn(ContentSafetyRepository.getInstance(), "applySystemRuleImport"),
      native = vi.spyOn(repository, "applyImport");
    expect(await service.importCsv(csv(newRow()), "apply", true, request())).toMatchObject({ imported: 1 });
    expect(old).toHaveBeenCalledOnce();
    expect(native).not.toHaveBeenCalled();
    expect(await prisma.contentSafetyRule.count()).toBe(3);
    expect((await old.mock.results[0]!.value).createdIds).toHaveLength(1);
  });
});
