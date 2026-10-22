import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, Permission, actionForPermission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IamDeploymentMigration } from "../../../migrations/20261023-iam-policy-authorization/migration";
import { LegacyPolicyBackfillService } from "@/iam/migration/legacy-policy-backfill.service";
import { LegacyAuthorizationBackfillService } from "@/iam/migration/legacy-authorization-backfill.service";
import { IamDeploymentMigrationRepository } from "@/store/users/iam-deployment-migration.repository";
import { IamPolicyMigrationRepository } from "@/store/users/iam-policy-migration.repository";
import { IamAuthorizationMigrationRepository } from "@/store/users/iam-authorization-migration.repository";
const store = new IamDeploymentMigrationRepository(prisma);
const runner = new IamDeploymentMigration(
  store,
  new LegacyPolicyBackfillService(new IamPolicyMigrationRepository(prisma)),
  new LegacyAuthorizationBackfillService(new IamAuthorizationMigrationRepository(prisma)),
);
const scope = { apply: true, allAccounts: true };
const user = async (accountOwnerId?: string, permissionAdds: Permission[] = []) =>
  prisma.user.create({
    data: {
      username: "deploy-migrate-" + randomUUID(),
      password: "fixture-only",
      accountOwnerId,
      parentUserId: accountOwnerId,
      permissionAdds,
      permissionRemoves: [],
    },
  });
let owner: string, child: string;
beforeEach(async () => {
  // This suite exercises all-account discovery; reset its isolated worker between scenarios.
  await prisma.user.deleteMany();
  await prisma.group.deleteMany();
  owner = (await user()).id;
  child = (await user(owner)).id;
});
const policy = async (permissions: Permission[] = [Permission.RAM_USER_READ]) =>
  prisma.ramPolicy.create({ data: { accountOwnerId: owner, name: "migration-" + randomUUID(), permissions } });
const attach = async (policyId: string, targetType = "user", targetId = child) =>
  prisma.ramPolicyAttachment.create({ data: { accountOwnerId: owner, policyId, targetType, targetId } });
const principal = (): IamPrincipal => ({
  subjectUserId: child,
  principalUserId: child,
  accountOwnerId: owner,
  subjectType: "sub_user",
});
async function decisions(subject = principal()) {
  return Promise.all(
    [
      Permission.RAM_USER_READ,
      Permission.RAM_USER_CREATE,
      Permission.RAM_USER_UPDATE,
      Permission.RAM_USER_DELETE,
      Permission.RAM_POLICY_READ,
    ].map(async (permission) => {
      const result = await IamAuthorizationService.getInstance().authorize({
        principal: subject,
        action: actionForPermission(permission),
        resource: "acs:quyan:*:" + owner + ":account",
      });
      return result.decision;
    }),
  );
}
describe("versioned single-command IAM data migration", { timeout: 60000 }, () => {
  it("preserves direct/group/role grants, explicit removals and role-session decisions through apply and rerun", async () => {
    const group = await prisma.group.create({
      data: {
        name: "migration",
        username: "migration-" + randomUUID(),
        accountOwnerId: owner,
        permissions: [Permission.RAM_USER_READ],
      },
    });
    await prisma.user.update({
      where: { id: child },
      data: {
        groupId: group.id,
        permissionAdds: [Permission.RAM_USER_UPDATE],
        permissionRemoves: [Permission.RAM_USER_DELETE],
      },
    });
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "migration" } });
    await prisma.ramUserRoleBinding.create({ data: { accountOwnerId: owner, userId: child, roleId: role.id } });
    await attach((await policy([Permission.RAM_USER_DELETE])).id);
    await attach((await policy([Permission.RAM_USER_CREATE])).id, "group", group.id);
    await attach((await policy([Permission.RAM_POLICY_READ])).id, "role", role.id);
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: child,
        sessionName: "migration",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const assumed: IamPrincipal = {
      ...principal(),
      subjectType: "assumed_role",
      assumedRoleId: role.id,
      roleSessionId: session.id,
    };
    const before = await decisions(),
      roleBefore = await decisions(assumed);
    expect(before).toEqual(["Allow", "Allow", "Allow", "ExplicitDeny", "Allow"]);
    expect(roleBefore).toEqual(["ImplicitDeny", "ImplicitDeny", "ImplicitDeny", "ImplicitDeny", "Allow"]);
    expect(await runner.run({ ...scope, apply: false })).toMatchObject({
      mode: "dry-run",
      accounts: 1,
      verified: false,
    });
    expect(await prisma.ramPolicyVersion.count()).toBe(0);
    expect(await prisma.ramAuthorization.count()).toBe(0);
    expect(await runner.run(scope)).toMatchObject({ accounts: 1, verified: true });
    expect(await decisions()).toEqual(before);
    expect(await decisions(assumed)).toEqual(roleBefore);
    expect(await prisma.ramPolicyVersion.count()).toBe(3);
    expect(await prisma.ramAuthorization.count()).toBe(3);
    expect(await runner.run(scope)).toMatchObject({ verified: true });
    expect(await prisma.ramPolicyVersion.count()).toBe(3);
    expect(await prisma.ramAuthorization.count()).toBe(3);
    // Prove the new authorization rows work independently of the retained rollback attachments.
    await prisma.ramPolicyAttachment.deleteMany({ where: { accountOwnerId: owner } });
    expect(await decisions()).toEqual(before);
    expect(await decisions(assumed)).toEqual(roleBefore);
  });
  it("migrates split maximum-permission policies without a post-migration authorization lockout", async () => {
    await attach((await policy(ALL_PERMISSIONS)).id);
    const before = await decisions();
    expect(before.every((decision) => decision === "Allow")).toBe(true);
    expect(await runner.run(scope)).toMatchObject({ verified: true });
    expect(await decisions()).toEqual(before);
    await prisma.ramPolicyAttachment.deleteMany({ where: { accountOwnerId: owner } });
    expect(await decisions()).toEqual(before);
  });
  it("preflights every account and refuses malformed user permissions before any writes", async () => {
    await attach((await policy()).id);
    const other = await user();
    await prisma.user.update({ where: { id: other.id }, data: { permissionRemoves: ["unknown:permission"] } });
    await expect(runner.run(scope)).rejects.toMatchObject({ code: "invalid-sources" });
    expect(await prisma.ramPolicyVersion.count()).toBe(0);
    expect(await prisma.ramAuthorization.count()).toBe(0);
    expect((await prisma.ramPolicy.findFirstOrThrow()).documentFormat).toBe("legacy");
  });
  it("rejects global-group corruption and cross-account bindings before any writes", async () => {
    const p = await policy();
    await attach(p.id, "user", (await user()).id);
    await expect(runner.run(scope)).rejects.toMatchObject({ code: "invalid-data" });
    expect(await prisma.ramPolicyVersion.count()).toBe(0);
    await prisma.group.create({
      data: { name: "invalid-global", username: "invalid-" + randomUUID(), permissions: ["unknown:permission"] },
    });
    await expect(runner.run(scope)).rejects.toMatchObject({ code: "invalid-sources" });
    expect(await prisma.ramAuthorization.count()).toBe(0);
  });
  it("verifies migrated hashes even for unattached policies and leaves unrelated accounts unchanged", async () => {
    const p = await policy();
    const other = await user();
    const foreign = await prisma.ramPolicy.create({
      data: { accountOwnerId: other.id, name: "foreign", permissions: [Permission.RAM_USER_READ] },
    });
    const selected = { apply: true, allAccounts: false, accountOwnerId: owner };
    expect(await runner.run(selected)).toMatchObject({ accounts: 1, verified: true });
    expect((await prisma.ramPolicy.findUniqueOrThrow({ where: { id: foreign.id } })).documentFormat).toBe("legacy");
    await prisma.ramPolicyVersion.updateMany({ where: { policyId: p.id }, data: { documentHash: "invalid" } });
    await expect(runner.run(selected)).rejects.toMatchObject({ code: "invalid-sources" });
  });
  it("rejects a changed legacy source under a migration-created version even when its hash is intact", async () => {
    const p = await policy();
    expect(await runner.run(scope)).toMatchObject({ verified: true });
    await prisma.ramPolicy.update({ where: { id: p.id }, data: { permissions: [Permission.RAM_USER_DELETE] } });
    await expect(runner.run(scope)).rejects.toMatchObject({ code: "invalid-sources" });
  });
  it("does not invent trust grants and blocks enforce-mode migration until legacy roles have explicit trust", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "legacy-without-trust" } });
    await attach((await policy()).id);
    const strictStore = new IamDeploymentMigrationRepository(prisma, { requireTrustPolicies: true });
    const strictRunner = new IamDeploymentMigration(
      strictStore,
      new LegacyPolicyBackfillService(new IamPolicyMigrationRepository(prisma)),
      new LegacyAuthorizationBackfillService(new IamAuthorizationMigrationRepository(prisma)),
    );
    await expect(strictRunner.run(scope)).rejects.toMatchObject({ code: "invalid-sources" });
    expect(strictStore.rolesWithoutTrust.has(role.id)).toBe(true);
    expect(await prisma.ramPolicyVersion.count()).toBe(0);
    expect((await prisma.ramRole.findUniqueOrThrow({ where: { id: role.id } })).trustPolicy).toBeNull();
  });
  it("discovers policy ownership anomalies instead of silently omitting non-root owners", async () => {
    await prisma.ramPolicy.create({
      data: { accountOwnerId: child, name: "invalid-owner", permissions: [Permission.RAM_USER_READ] },
    });
    expect(await store.listAccounts()).toContain(child);
    await expect(runner.run(scope)).rejects.toMatchObject({ code: "invalid-sources" });
    expect(await prisma.ramPolicyVersion.count()).toBe(0);
  });
});
