import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { Permission } from "@quyan/shared";
import type { IamPrincipal, IamPolicyDocument } from "@quyan/shared";
import { env } from "@/config/env";
import { prisma } from "@/config/database";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { LegacyPolicyBackfillService } from "@/iam/migration/legacy-policy-backfill.service";
import { IAM_BACKFILL_CREATOR } from "@/iam/migration/legacy-policy-provenance";
import { RamService } from "@/services/users/ram.service";
import { PermissionService } from "@/services/users/permission.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { articleArn } from "@/iam/resources/article-resources";
let owner: string, actor: string, peer: string;
const iam = IamAuthorizationService.getInstance(),
  ram = RamService.getInstance();
const originalMode = env.security.iamAuthorizationMode;
const permissions = [Permission.ARTICLE_UPDATE, Permission.ARTICLE_DELETE, Permission.ARTICLE_PUBLISH];
const principal = (auth: Partial<IamPrincipal> = {}): IamPrincipal => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId: owner,
  subjectType: "sub_user",
  ...auth,
});
const article = (authorId = actor) =>
  prisma.article.create({
    data: {
      authorId,
      title: "Legacy ownership fixture",
      content: "Synthetic content",
      slug: "legacy-ownership-" + randomUUID(),
    },
  });
const authorize = (id: string, action = "quyan:article:Update", auth = {}) =>
  iam.authorize({
    principal: principal(auth),
    action,
    resource: articleArn(owner, id),
    context: { "quyan:ResourceOwnerId": actor },
  });
const legacyPolicy = () => {
  const name = "legacy-ownership-" + randomUUID();
  return prisma.ramPolicy.create({ data: { name, activeName: name, accountOwnerId: owner, permissions } });
};
const attach = (policyId: string, targetType = "user", targetId = actor) =>
  prisma.ramPolicyAttachment.create({ data: { accountOwnerId: owner, policyId, targetType, targetId } });
const group = async () => {
  const record = await prisma.group.create({
    data: { username: "legacy-ownership-" + randomUUID(), accountOwnerId: owner, permissions: [] },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: record.id } });
  return record;
};
const role = () => prisma.ramRole.create({ data: { accountOwnerId: owner, name: "legacy-ownership-" + randomUUID() } });
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
});
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "legacy-ownership-" + randomUUID(),
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
});
describe("legacy article compatibility across policy sources", () => {
  it.each([
    "user-adds",
    "group-permissions",
    "user-attachment",
    "group-attachment",
    "role-binding",
    "assumed-role",
    "backfilled-attachment",
    "backfilled-authorization",
  ])("preserves author-only edits/deletion and broad publication/reorder: %s", async (source) => {
    let auth: Partial<IamPrincipal> = {};
    if (source === "user-adds")
      await prisma.user.update({ where: { id: actor }, data: { permissionAdds: permissions } });
    else if (source === "group-permissions") {
      const record = await group();
      await prisma.group.update({ where: { id: record.id }, data: { permissions } });
    } else {
      const policy = await legacyPolicy();
      if (source === "group-attachment") await attach(policy.id, "group", (await group()).id);
      else if (source === "role-binding" || source === "assumed-role") {
        const record = await role();
        await attach(policy.id, "role", record.id);
        if (source === "role-binding")
          await prisma.ramUserRoleBinding.create({ data: { accountOwnerId: owner, userId: actor, roleId: record.id } });
        else {
          const session = await prisma.ramRoleSession.create({
            data: {
              accountOwnerId: owner,
              roleId: record.id,
              subjectUserId: actor,
              sessionName: "Synthetic legacy fixture",
              expiresAt: new Date(Date.now() + 60000),
            },
          });
          auth = { subjectType: "assumed_role", assumedRoleId: record.id, roleSessionId: session.id };
        }
      } else {
        if (source.startsWith("backfilled"))
          await LegacyPolicyBackfillService.getInstance().run({ accountOwnerId: owner, apply: true });
        if (source === "backfilled-authorization")
          await ram.createAuthorization(owner, {
            principalType: "user",
            principalId: actor,
            policyId: policy.id,
            scopeType: "account",
          });
        else await attach(policy.id);
      }
    }
    const own = await article(),
      other = await article(peer);
    for (const operation of ["Update", "Delete"]) {
      expect((await authorize(own.id, "quyan:article:" + operation, auth)).decision).toBe("Allow");
      expect((await authorize(other.id, "quyan:article:" + operation, auth)).decision).toBe("ImplicitDeny");
    }
    expect((await authorize(other.id, "quyan:article:Publish", auth)).decision).toBe("Allow");
    expect((await authorize(other.id, "quyan:article:ReorderArticles", auth)).decision).toBe("Allow");
  });
  it("retains explicit JSON peer delegation but lets legacy removals deny it globally", async () => {
    const other = await article(peer);
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: permissions } });
    const policy = await ram.createPolicy(owner, {
      name: "legacy-peer-" + randomUUID(),
      document: {
        Version: "1",
        Statement: { Effect: "Allow", Action: "quyan:article:Update", Resource: articleArn(owner, other.id) },
      },
    });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "account",
    });
    expect((await authorize(other.id)).decision).toBe("Allow");
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.ARTICLE_UPDATE] } });
    expect((await authorize(other.id)).decision).toBe("ExplicitDeny");
    expect((await authorize(other.id, "quyan:article:ReorderArticles")).decision).toBe("ExplicitDeny");
  });
  it("restores source semantics for older backfills without mutating immutable JSON or its hash", async () => {
    const policy = await legacyPolicy();
    await LegacyPolicyBackfillService.getInstance().run({ accountOwnerId: owner, apply: true });
    const updated = await prisma.ramPolicy.findUniqueOrThrow({
      where: { id: policy.id },
      include: { defaultVersion: true },
    });
    const oldDocument: IamPolicyDocument = {
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: ["quyan:article:Update", "quyan:article:Delete", "quyan:article:Publish"],
        Resource: "acs:quyan:*:" + owner + ":account",
      },
    };
    const old = parseIamPolicy(oldDocument);
    await prisma.ramPolicyVersion.update({
      where: { id: updated.defaultVersionId! },
      data: { document: JSON.parse(old.canonicalJson), documentHash: old.documentHash },
    });
    await attach(policy.id);
    const own = await article(),
      other = await article(peer);
    expect((await authorize(own.id)).decision).toBe("Allow");
    expect((await authorize(other.id)).decision).toBe("ImplicitDeny");
    expect((await authorize(other.id, "quyan:article:ReorderArticles")).decision).toBe("Allow");
    const retained = await prisma.ramPolicyVersion.findUniqueOrThrow({ where: { id: updated.defaultVersionId! } });
    expect(retained.documentHash).toBe(old.documentHash);
    expect(retained.document).toEqual(old.document);
    expect(
      (await RamPolicyRepository.getInstance().listPoliciesForTarget("user", actor, owner))[0].versionCreatedBy,
    ).toBe(IAM_BACKFILL_CREATOR);
  });
  it.each(["hash", "extra-action", "shadow-drift"])(
    "fails closed on backfill integrity/provenance drift: %s",
    async (change) => {
      const policy = await legacyPolicy();
      await LegacyPolicyBackfillService.getInstance().run({ accountOwnerId: owner, apply: true });
      await attach(policy.id);
      const updated = await prisma.ramPolicy.findUniqueOrThrow({
        where: { id: policy.id },
        include: { defaultVersion: true },
      });
      if (change === "hash")
        await prisma.ramPolicyVersion.update({
          where: { id: updated.defaultVersionId! },
          data: { documentHash: "0".repeat(64) },
        });
      if (change === "extra-action") {
        const document = parseIamPolicy(updated.defaultVersion!.document).document;
        document.Statement[0].Action.push("quyan:ram:DeleteUser");
        const parsed = parseIamPolicy(document);
        await prisma.ramPolicyVersion.update({
          where: { id: updated.defaultVersionId! },
          data: { document: JSON.parse(parsed.canonicalJson), documentHash: parsed.documentHash },
        });
      }
      if (change === "shadow-drift")
        await prisma.ramPolicy.update({ where: { id: policy.id }, data: { permissions: [Permission.ARTICLE_DELETE] } });
      await expect(iam.loadPolicies(principal())).rejects.toThrow();
    },
  );
  it("does not rewrite an explicit replacement default just because legacy shadow fields remain", async () => {
    const policy = await legacyPolicy();
    await LegacyPolicyBackfillService.getInstance().run({ accountOwnerId: owner, apply: true });
    await attach(policy.id);
    const other = await article(peer),
      original = await prisma.ramPolicy.findUniqueOrThrow({
        where: { id: policy.id },
        include: { defaultVersion: true },
      });
    await ram.updatePolicy(owner, policy.id, {
      document: {
        Version: "1",
        Statement: { Effect: "Allow", Action: "quyan:article:Update", Resource: articleArn(owner, other.id) },
      },
      expectedDocumentHash: original.defaultVersion!.documentHash,
    });
    expect((await authorize(other.id)).decision).toBe("Allow");
    expect((await PermissionService.getInstance().getUserFullPermissions(actor))?.effectivePermissions).not.toContain(
      Permission.ARTICLE_UPDATE,
    );
    await ram.setDefaultPolicyVersion(
      owner,
      policy.id,
      original.defaultVersionId!,
      (await prisma.ramPolicy.findUniqueOrThrow({ where: { id: policy.id }, include: { defaultVersion: true } }))
        .defaultVersion!.documentHash,
    );
    expect((await authorize(other.id)).decision).toBe("ImplicitDeny");
    expect((await PermissionService.getInstance().getUserFullPermissions(actor))?.effectivePermissions).toContain(
      Permission.ARTICLE_UPDATE,
    );
  });
  it("never treats subject-bound edit grants as unconditioned delegated peer authority", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: permissions } });
    const other = await article(peer);
    const policy = await legacyPolicy(),
      candidateRole = await role();
    await attach(policy.id, "role", candidateRole.id);
    const candidateGrants = await iam.loadRolePolicies(owner, candidateRole.id);
    expect(candidateGrants).toHaveLength(1);
    expect((await ram.checkPolicyDelegation(actor, candidateGrants[0].document)).allowed).toBe(false);
    expect(
      (
        await ram.checkPolicyDelegation(actor, {
          Version: "1",
          Statement: { Effect: "Allow", Action: "quyan:article:Update", Resource: articleArn(owner, other.id) },
        })
      ).allowed,
    ).toBe(false);
    await expect(
      PermissionService.getInstance().assertCanGrantPermissions(actor, [Permission.ARTICLE_UPDATE]),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      (
        await ram.checkPolicyDelegation(actor, {
          Version: "1",
          Statement: {
            Effect: "Allow",
            Action: "quyan:article:ReorderArticles",
            Resource: articleArn(owner, other.id),
          },
        })
      ).allowed,
    ).toBe(true);
  });
});
