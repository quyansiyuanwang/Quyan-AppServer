import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, Permission, actionForPermission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { LegacyPolicyBackfillService } from "@/iam/migration/legacy-policy-backfill.service";
import { IamPolicyMigrationRepository } from "@/store/users/iam-policy-migration.repository";
import { planLegacyPolicy } from "@/iam/migration/legacy-policy-backfill";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
const service = LegacyPolicyBackfillService.getInstance();
const repository = IamPolicyMigrationRepository.getInstance();
describe("account-scoped legacy policy migration", () => {
  let ownerId: string;
  beforeEach(async () => {
    ownerId = (
      await prisma.user.create({
        data: {
          username: "iam-migration-" + randomUUID(),
          password: "test-fixture-only",
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  });
  async function create(name = "legacy") {
    return prisma.ramPolicy.create({
      data: {
        accountOwnerId: ownerId,
        name,
        activeName: name,
        permissions: [Permission.USER_READ, Permission.RAM_USER_CREATE],
      },
    });
  }
  it("makes dry-run read-only, preserves legacy fields, verifies hash and is idempotent", async () => {
    const policy = await create();
    const dry = await service.run({ accountOwnerId: ownerId });
    expect(dry).toMatchObject({ scanned: 1, planned: 1, migrated: 0 });
    expect(await prisma.ramPolicyVersion.count({ where: { policyId: policy.id } })).toBe(0);
    expect((await service.run({ apply: true, accountOwnerId: ownerId })).migrated).toBe(1);
    const updated = await prisma.ramPolicy.findUniqueOrThrow({
      where: { id: policy.id },
      include: { defaultVersion: true },
    });
    expect(updated.permissions).toEqual(policy.permissions);
    expect(updated.defaultVersion?.documentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(updated.defaultVersion?.version).toBe(1);
    expect((await service.run({ apply: true, accountOwnerId: ownerId })).scanned).toBe(0);
    expect(await prisma.ramPolicyVersion.count({ where: { policyId: policy.id } })).toBe(1);
  });
  it("preserves live authorization after migrating a maximum-permission policy into multiple statements", async () => {
    const child = await prisma.user.create({
      data: {
        username: "all-permissions-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId: ownerId,
        parentUserId: ownerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    const policy = await prisma.ramPolicy.create({
      data: {
        accountOwnerId: ownerId,
        name: "all-permissions",
        activeName: "all-permissions",
        permissions: ALL_PERMISSIONS,
      },
    });
    await prisma.ramPolicyAttachment.create({
      data: { accountOwnerId: ownerId, policyId: policy.id, targetType: "user", targetId: child.id },
    });
    const request = {
      principal: {
        subjectUserId: child.id,
        principalUserId: child.id,
        accountOwnerId: ownerId,
        subjectType: "sub_user" as const,
      },
      action: actionForPermission(Permission.RAM_USER_READ),
      resource: "acs:quyan:*:" + ownerId + ":account",
    };
    const authorizer = IamAuthorizationService.getInstance();
    expect((await authorizer.authorize(request)).decision).toBe("Allow");
    expect(await service.run({ apply: true, accountOwnerId: ownerId })).toMatchObject({
      migrated: 1,
      invalid: 0,
      changed: 0,
    });
    const migrated = await prisma.ramPolicy.findUniqueOrThrow({
      where: { id: policy.id },
      include: { defaultVersion: true },
    });
    expect((migrated.defaultVersion!.document as { Statement: unknown[] }).Statement.length).toBeGreaterThan(1);
    expect((await authorizer.authorize(request)).decision).toBe("Allow");
    expect(await service.run({ apply: true, accountOwnerId: ownerId })).toMatchObject({ migrated: 0, invalid: 0 });
    expect((await authorizer.authorize(request)).decision).toBe("Allow");
  }, 30000);
  it("does not touch other accounts, managed policies, empty policies or invalid permissions", async () => {
    await create();
    await prisma.ramPolicy.create({
      data: {
        accountOwnerId: ownerId,
        name: "managed",
        activeName: "managed",
        type: "managed",
        permissions: [Permission.USER_READ],
      },
    });
    await prisma.ramPolicy.create({
      data: { accountOwnerId: ownerId, name: "empty", activeName: "empty", permissions: [] },
    });
    await prisma.ramPolicy.create({
      data: { accountOwnerId: ownerId, name: "invalid", activeName: "invalid", permissions: ["unmapped:permission"] },
    });
    const other = await prisma.user.create({
      data: {
        username: "iam-other-migration-" + randomUUID(),
        password: "test-fixture-only",
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    const foreign = await prisma.ramPolicy.create({
      data: { accountOwnerId: other.id, name: "foreign", activeName: "foreign", permissions: [Permission.USER_READ] },
    });
    expect(await service.run({ apply: true, accountOwnerId: ownerId })).toMatchObject({
      scanned: 4,
      migrated: 1,
      skipped: 2,
      invalid: 1,
    });
    expect((await prisma.ramPolicy.findUniqueOrThrow({ where: { id: foreign.id } })).documentFormat).toBe("legacy");
  });
  it("rejects source drift after dry-run rather than overwriting a permission edit", async () => {
    const policy = await create();
    const plan = planLegacyPolicy(policy);
    if (plan.kind !== "migrate") throw Error("Expected migration");
    await prisma.ramPolicy.update({ where: { id: policy.id }, data: { permissions: [Permission.USER_DELETE] } });
    expect(await repository.convert(policy, plan.sourceHash, plan.parsed.documentHash)).toBe("source-changed");
    expect(await prisma.ramPolicyVersion.count({ where: { policyId: policy.id } })).toBe(0);
    expect((await prisma.ramPolicy.findUniqueOrThrow({ where: { id: policy.id } })).permissions).toEqual([
      Permission.USER_DELETE,
    ]);
  });
  it("allows only one conversion when two writers race", async () => {
    const policy = await create();
    const plan = planLegacyPolicy(policy);
    if (plan.kind !== "migrate") throw Error("Expected migration");
    const results = await Promise.all([
      repository.convert(policy, plan.sourceHash, plan.parsed.documentHash),
      repository.convert(policy, plan.sourceHash, plan.parsed.documentHash),
    ]);
    expect(results.sort()).toEqual(["migrated", "source-changed"]);
    expect(await prisma.ramPolicyVersion.count({ where: { policyId: policy.id } })).toBe(1);
  });
});
