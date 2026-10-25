import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { readIamAuthorizationRevision } from "@/store/users/iam-authorization-revision";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
let owner: string, actor: string, group: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "revision-user-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const revision = () => readIamAuthorizationRevision(prisma, owner);
beforeEach(async () => {
  owner = await user();
  actor = await user(owner);
  group = (
    await prisma.group.create({
      data: {
        username: "revision-group-" + randomUUID(),
        accountOwnerId: null,
        permissions: [Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId: group } });
});
describe("persisted IAM transaction revision", () => {
  it("detects global group permission changes without relying on timestamps", async () => {
    const before = await revision(),
      original = await prisma.group.findUniqueOrThrow({ where: { id: group } });
    await prisma.group.update({ where: { id: group }, data: { permissions: [], updateTime: original.updateTime } });
    expect(await revision()).not.toBe(before);
  });
  it("detects user group changes and removals even when the timestamp is preserved", async () => {
    const before = await revision(),
      original = await prisma.user.findUniqueOrThrow({ where: { id: actor } });
    await prisma.user.update({
      where: { id: actor },
      data: { permissionRemoves: [Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE], updateTime: original.updateTime },
    });
    const removed = await revision();
    expect(removed).not.toBe(before);
    await prisma.user.update({ where: { id: actor }, data: { groupId: null, updateTime: original.updateTime } });
    expect(await revision()).not.toBe(removed);
  });
  it("detects policy and authorization scope changes", async () => {
    const before = await revision(),
      arn = "acs:quyan:*:" + owner + ":user/" + actor;
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:ram:UpdateUser", Resource: arn },
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "revision-policy-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
    const withPolicy = await revision();
    expect(withPolicy).not.toBe(before);
    const relation = await prisma.ramAuthorization.create({
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
    const withRelation = await revision();
    expect(withRelation).not.toBe(withPolicy);
    await prisma.ramAuthorization.update({
      where: { id: relation.id },
      data: { scopeType: "resource", scopeKey: "resource:" + arn, scopeArn: arn, updateTime: relation.updateTime },
    });
    expect(await revision()).not.toBe(withRelation);
  });
  it("ignores a foreign account's unrelated identity group", async () => {
    const before = await revision(),
      foreign = await user();
    const unrelated = await prisma.group.create({
      data: { username: "revision-unrelated-" + randomUUID(), accountOwnerId: foreign, permissions: [] },
    });
    await prisma.user.update({ where: { id: foreign }, data: { groupId: unrelated.id } });
    expect(await revision()).toBe(before);
  });
});

const imageSelect = { id: true, status: true, groupId: true, updateTime: true } as const;
describe("expected user post-image authorization revisions", () => {
  it("normalizes only the intended status, group and timestamp changes", async () => {
    const group = await prisma.group.create({
      data: {
        username: "revision-group-" + randomUUID(),
        name: "fixture",
        permissions: [],
        level: 10,
      },
    });
    await prisma.$transaction(async (tx) => {
      const revision = await readIamAuthorizationRevision(tx, owner);
      const before = await tx.user.findUniqueOrThrow({ where: { id: actor }, select: imageSelect });
      const after = await tx.user.update({
        where: { id: actor },
        data: { status: 0, groupId: group.id },
        select: imageSelect,
      });
      expect(await readIamAuthorizationRevision(tx, owner)).not.toBe(revision);
      expect(await readIamAuthorizationRevision(tx, owner, { before, after })).toBe(revision);
      // Unexpected permission changes on the same user must not be hidden by normalization.
      await tx.user.update({
        where: { id: actor },
        data: {
          permissionAdds: [Permission.RAM_USER_READ],
          updateTime: after.updateTime,
        },
      });
      expect(await readIamAuthorizationRevision(tx, owner, { before, after })).not.toBe(revision);
    });
  });
  it("still detects changes to another identity and its group permissions", async () => {
    const group = await prisma.group.create({
      data: {
        username: "revision-owner-group-" + randomUUID(),
        name: "fixture",
        permissions: [],
        level: 10,
      },
    });
    await prisma.user.update({ where: { id: owner }, data: { groupId: group.id } });
    await prisma.$transaction(async (tx) => {
      const revision = await readIamAuthorizationRevision(tx, owner);
      const before = await tx.user.findUniqueOrThrow({ where: { id: actor }, select: imageSelect });
      const after = await tx.user.update({ where: { id: actor }, data: { name: "Expected" }, select: imageSelect });
      expect(await readIamAuthorizationRevision(tx, owner, { before, after })).toBe(revision);
      await tx.group.update({ where: { id: group.id }, data: { permissions: [Permission.RAM_USER_READ] } });
      expect(await readIamAuthorizationRevision(tx, owner, { before, after })).not.toBe(revision);
      await tx.user.update({ where: { id: owner }, data: { permissionRemoves: [Permission.RAM_USER_READ] } });
      expect(await readIamAuthorizationRevision(tx, owner, { before, after })).not.toBe(revision);
    });
  });
  it("rejects a mismatched post-image or identity instead of normalizing it", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: actor }, select: imageSelect });
    await expect(
      readIamAuthorizationRevision(prisma, owner, {
        before,
        after: { ...before, status: 0 },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      readIamAuthorizationRevision(prisma, owner, {
        before,
        after: { ...before, id: owner },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
