import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IamAuthorizationMigrationRepository } from "@/store/users/iam-authorization-migration.repository";
import { LegacyAuthorizationBackfillService } from "@/iam/migration/legacy-authorization-backfill.service";
import { planLegacyAuthorization } from "@/iam/migration/legacy-authorization-backfill";
const repository = IamAuthorizationMigrationRepository.getInstance();
const service = new LegacyAuthorizationBackfillService(repository);
let owner: string, child: string;
beforeEach(async () => {
  owner = (
    await prisma.user.create({
      data: {
        username: "backfill-owner-" + randomUUID(),
        password: "fixture-only",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
  child = (
    await prisma.user.create({
      data: {
        username: "backfill-child-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId: owner,
        parentUserId: owner,
        userType: "ram",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
});
async function binding(targetType = "user", targetId = child) {
  const policy = await prisma.ramPolicy.create({
    data: {
      accountOwnerId: owner,
      name: "fixture-" + randomUUID(),
      activeName: "fixture-" + randomUUID(),
      permissions: [Permission.RAM_USER_READ],
    },
  });
  return prisma.ramPolicyAttachment.create({
    data: { accountOwnerId: owner, policyId: policy.id, targetType, targetId },
  });
}
const evaluate = () =>
  IamAuthorizationService.getInstance().authorize({
    principal: { subjectUserId: child, principalUserId: child, accountOwnerId: owner, subjectType: "sub_user" },
    action: "quyan:ram:ReadUser",
    resource: "acs:quyan:*:" + owner + ":account",
  });
describe("legacy attachment authorization backfill", () => {
  it("preserves decisions, legacy records and idempotence while dry-run stays read-only", async () => {
    const attachment = await binding();
    const before = await evaluate();
    expect(await service.run({ accountOwnerId: owner })).toMatchObject({ planned: 1, migrated: 0 });
    expect(await prisma.ramAuthorization.count({ where: { accountOwnerId: owner } })).toBe(0);
    expect(await service.run({ apply: true, accountOwnerId: owner })).toMatchObject({ migrated: 1 });
    expect((await evaluate()).decision).toBe(before.decision);
    expect(before.decision).toBe("Allow");
    expect(await prisma.ramPolicyAttachment.findUnique({ where: { id: attachment.id } })).not.toBeNull();
    expect(await service.run({ apply: true, accountOwnerId: owner })).toMatchObject({ migrated: 0, skipped: 1 });
    expect(await prisma.ramAuthorization.count({ where: { accountOwnerId: owner } })).toBe(1);
  });
  it("migrates user/group/role attachments and leaves foreign relationships untouched", async () => {
    const group = await prisma.group.create({
      data: { name: "fixture-group", username: "fixture-" + randomUUID(), permissions: [], accountOwnerId: owner },
    });
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "fixture-role" } });
    await binding();
    await binding("group", group.id);
    await binding("role", role.id);
    const foreign = (
      await prisma.user.create({
        data: {
          username: "foreign-" + randomUUID(),
          password: "fixture-only",
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
    await binding("user", foreign);
    expect(await service.run({ apply: true, accountOwnerId: owner })).toMatchObject({
      scanned: 4,
      migrated: 3,
      invalid: 1,
    });
    expect(await prisma.ramAuthorization.count({ where: { principalId: foreign } })).toBe(0);
  });
  it("detects policy edits and detach after planning without reviving revoked access", async () => {
    const attachment = await binding();
    const [candidate] = await repository.listCandidates(owner);
    const plan = planLegacyAuthorization(candidate);
    if (plan.kind !== "migrate") throw Error("Expected migration");
    await prisma.ramPolicy.update({
      where: { id: attachment.policyId },
      data: { permissions: [Permission.RAM_USER_DELETE] },
    });
    expect(await repository.convert(candidate, plan.sourceHash)).toBe("source-changed");
    await prisma.ramPolicyAttachment.delete({ where: { id: attachment.id } });
    expect(await repository.convert(candidate, plan.sourceHash)).toBe("source-changed");
    expect(await prisma.ramAuthorization.count({ where: { accountOwnerId: owner } })).toBe(0);
  });
  it("refuses corrupted JSON version hashes without writing any authorization", async () => {
    const attachment = await binding();
    const version = await prisma.ramPolicyVersion.create({
      data: {
        policyId: attachment.policyId,
        version: 1,
        document: { Version: "1", Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: "*" } },
        documentHash: "invalid",
        createdBy: owner,
      },
    });
    await prisma.ramPolicy.update({
      where: { id: attachment.policyId },
      data: { documentFormat: "iam-v1", defaultVersionId: version.id },
    });
    expect(await service.run({ apply: true, accountOwnerId: owner })).toMatchObject({ invalid: 1, migrated: 0 });
    expect(await prisma.ramAuthorization.count({ where: { accountOwnerId: owner } })).toBe(0);
  });
});
