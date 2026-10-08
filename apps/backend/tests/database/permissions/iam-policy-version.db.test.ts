import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { ConflictError } from "@/util/errors";
import { Permission } from "@quyan/shared";

const pagination = { page: 1, pageSize: 20 };
const repository = RamPolicyRepository.getInstance();
const document = (effect: "Allow" | "Deny" = "Allow") =>
  parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: "alidns:AddDomainRecord", Resource: "acs:alidns:*:*:domain/qrmr.cn" },
  });

// The runtime project provides an isolated database and resets it between files.
describe("immutable IAM policy versions", () => {
  let ownerId: string;
  beforeEach(async () => {
    const owner = await prisma.user.create({
      data: {
        username: "iam-owner-" + randomUUID(),
        password: "test-fixture-only",
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    ownerId = owner.id;
  });
  const version = (owner: string, effect: "Allow" | "Deny" = "Allow") => ({ ...document(effect), createdBy: owner });
  async function create(name: string) {
    return repository.createPolicy({
      accountOwnerId: ownerId,
      name,
      permissions: [Permission.USER_READ],
      iamVersion: version(ownerId),
    });
  }
  it("atomically creates a validated default version and preserves rollback permissions", async () => {
    const policy = await create("initial");
    expect(policy.documentFormat).toBe("iam-v1");
    expect(policy.defaultVersion?.version).toBe(1);
    expect(policy.defaultVersion?.documentHash).toBe(document().documentHash);
    expect(policy.defaultVersionId).toBe(policy.defaultVersion?.id);
    expect(policy.permissions).toEqual([Permission.USER_READ]);
  });
  it("appends versions, retains immutable history and can restore a prior default", async () => {
    const initial = await create("history");
    const updated = await repository.updatePolicy(initial.id, {
      iamVersion: version(ownerId, "Deny"),
      expectedDocumentHash: initial.defaultVersion!.documentHash,
    });
    expect(updated.defaultVersion?.version).toBe(2);
    expect((await repository.listVersions(initial.id, pagination)).items.map((row) => row.version)).toEqual([2, 1]);
    expect((await repository.listVersions(initial.id, pagination)).items[1].documentHash).toBe(
      initial.defaultVersion!.documentHash,
    );
    await repository.setDefaultVersion(initial.id, initial.defaultVersionId!, updated.defaultVersion!.documentHash);
    expect((await repository.findPolicyById(initial.id))?.defaultVersionId).toBe(initial.defaultVersionId);
  });
  it("rejects a stale hash without appending a version or changing metadata", async () => {
    const initial = await create("stale");
    await expect(
      repository.updatePolicy(initial.id, {
        description: "must roll back",
        iamVersion: version(ownerId, "Deny"),
        expectedDocumentHash: "stale",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await repository.listVersions(initial.id, pagination)).items).toHaveLength(1);
    expect((await repository.findPolicyById(initial.id))?.description).toBeNull();
  });
  it("rolls back policy creation and version updates when the document hash is invalid", async () => {
    await expect(
      repository.createPolicy({
        accountOwnerId: ownerId,
        name: "invalid",
        permissions: [],
        iamVersion: { ...version(ownerId), documentHash: "invalid" },
      }),
    ).rejects.toThrow();
    expect(await repository.findPolicyByName(ownerId, "invalid")).toBeNull();
    const initial = await create("rollback");
    await expect(
      repository.updatePolicy(initial.id, {
        description: "must roll back",
        expectedDocumentHash: initial.defaultVersion!.documentHash,
        iamVersion: { ...version(ownerId), documentHash: "invalid" },
      }),
    ).rejects.toThrow();
    expect((await repository.listVersions(initial.id, pagination)).items).toHaveLength(1);
    expect((await repository.findPolicyById(initial.id))?.description).toBeNull();
  });
  it("serializes competing version updates so only one writer with the old hash succeeds", async () => {
    const initial = await create("concurrent");
    const updates = await Promise.allSettled(
      ["first", "second"].map((description) =>
        repository.updatePolicy(initial.id, {
          description,
          iamVersion: version(ownerId, "Deny"),
          expectedDocumentHash: initial.defaultVersion!.documentHash,
        }),
      ),
    );
    expect(updates.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(updates.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await repository.listVersions(initial.id, pagination)).items.map((row) => row.version)).toEqual([2, 1]);
  });
  it("rejects switching to another policy version or an inactive version", async () => {
    const first = await create("first");
    const second = await create("second");
    await expect(
      repository.setDefaultVersion(first.id, second.defaultVersionId!, first.defaultVersion!.documentHash),
    ).rejects.toThrow();
    await prisma.ramPolicyVersion.update({ where: { id: first.defaultVersionId! }, data: { status: 0 } });
    await expect(
      repository.setDefaultVersion(first.id, first.defaultVersionId!, first.defaultVersion!.documentHash),
    ).rejects.toThrow();
  });
  it("filters disabled policies and disabled attachments for single and batch targets", async () => {
    const policy = await create("revoke");
    await repository.attachPolicy(ownerId, policy.id, "user", ownerId);
    expect(await repository.listPoliciesForTarget("user", ownerId)).toHaveLength(1);
    await prisma.ramPolicyAttachment.updateMany({ where: { policyId: policy.id }, data: { status: 0 } });
    expect(await repository.listPoliciesForTarget("user", ownerId)).toEqual([]);
    await prisma.ramPolicyAttachment.updateMany({ where: { policyId: policy.id }, data: { status: 1 } });
    await repository.softDeletePolicy(policy.id);
    expect(await repository.listPoliciesForTarget("user", ownerId)).toEqual([]);
    expect(await repository.listPoliciesForTargets("user", [ownerId])).toEqual([]);
  });
  it("never exposes a default document from a different policy or a mismatched attachment owner", async () => {
    const first = await create("pointer-first");
    const second = await create("pointer-second");
    await repository.attachPolicy(ownerId, first.id, "user", ownerId);
    await prisma.ramPolicy.update({ where: { id: first.id }, data: { defaultVersionId: second.defaultVersionId } });
    expect((await repository.listPoliciesForTarget("user", ownerId))[0].document).toBeUndefined();
    const other = await prisma.user.create({
      data: {
        username: "iam-other-" + randomUUID(),
        password: "test-fixture-only",
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    await prisma.ramPolicyAttachment.updateMany({ where: { policyId: first.id }, data: { accountOwnerId: other.id } });
    expect((await repository.listPoliciesForTarget("user", ownerId))[0].legacyPermissions).toBeNull();
  });
});
