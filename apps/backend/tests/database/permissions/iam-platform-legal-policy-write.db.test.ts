import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission, LegalPolicyType } from "@quyan/shared";
import { env } from "@/config/env";
import { PlatformLegalPolicyWriteIamService } from "@/services/legal-policy/platform-legal-policy-write-iam.service";
import { PlatformLegalPolicyWriteRepository } from "@/store/content/platform-legal-policy-write.repository";
import {
  platformLegalPolicyArn,
  platformLegalPolicyCreationArn,
} from "@/iam/resources/platform-legal-policy-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const originalMode = env.security.iamAuthorizationMode,
  service = PlatformLegalPolicyWriteIamService.getInstance(),
  repo = PlatformLegalPolicyWriteRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "legal-read-" + randomUUID(),
        name: "fixture-name",
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
    headers: {},
  }) as unknown as TypedRequest;
const create = (version: number, policyType = "terms_of_service") =>
  prisma.legalPolicyVersion.create({
    data: {
      version,
      policyType,
      createdBy: owner,
      title: "fixture-title",
      content: "private draft fixture",
      publishStatus: "draft",
    },
  });
async function group() {
  const row = await prisma.group.create({
    data: {
      username: "legal-read-" + randomUUID(),
      name: "fixture global",
      level: 0,
      accountOwnerId: null,
      permissions: [Permission.LEGAL_POLICY_CREATE, Permission.LEGAL_POLICY_UPDATE, Permission.LEGAL_POLICY_DELETE],
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function bind(document: unknown, principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy(document);
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "legal-read-" + randomUUID(),
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
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  await prisma.userPolicyAcceptance.deleteMany();
  await prisma.legalPolicyVersion.deleteMany();
  owner = await user();
  actor = await user(owner);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});
const input = { policyType: LegalPolicyType.TERMS_OF_SERVICE, title: "fixture draft", content: "fixture content" };
describe("platform legal draft atomic authorization database", () => {
  it("creates, updates and soft-deletes a draft with the trusted audit actor", async () => {
    await group();
    const row = await service.create(input, actor, request());
    expect(row).toMatchObject({ version: 1, publishStatus: "draft", isCurrent: false, createdBy: actor });
    expect(await service.change("UpdateVersion", row!.id, { title: "changed" }, actor, request())).toMatchObject({
      title: "changed",
      updatedBy: actor,
    });
    await service.change("DeleteVersion", row!.id, {}, actor, request());
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: row!.id } })).toMatchObject({ status: -1 });
  });
  it("does not reuse deleted version numbers and prevents duplicate active drafts", async () => {
    await group();
    const first = await service.create(input, actor, request());
    await expect(service.create(input, actor, request())).rejects.toMatchObject({ statusCode: 400 });
    await service.change("DeleteVersion", first!.id, {}, actor, request());
    expect(await service.create(input, actor, request())).toMatchObject({ version: 2 });
  });
  it("rejects creation-boundary Deny and rolls back real-resource Deny", async () => {
    await group();
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:legal_policy:CreateVersion",
        Resource: platformLegalPolicyCreationArn(input.policyType),
      },
    });
    await expect(service.create(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.legalPolicyVersion.count()).toBe(0);
    // A different type has a distinct creation boundary, but its generated resource is still checked.
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:legal_policy:CreateVersion",
        Resource: "acs:platform:*:platform:legal-policy/*",
      },
    });
    await expect(
      service.create({ ...input, policyType: LegalPolicyType.PRIVACY_POLICY }, actor, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.legalPolicyVersion.count()).toBe(0);
  });
  it("enforces record-specific update/delete Deny without changing sibling drafts", async () => {
    await group();
    const row = await create(1),
      other = await create(1, "privacy_policy");
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: ["quyan:legal_policy:UpdateVersion", "quyan:legal_policy:DeleteVersion"],
        Resource: platformLegalPolicyArn(row.id),
      },
    });
    await expect(
      service.change("UpdateVersion", row.id, { content: "blocked" }, actor, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.change("DeleteVersion", row.id, {}, actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await service.change("UpdateVersion", other.id, { title: "allowed" }, actor, request())).toMatchObject({
      title: "allowed",
    });
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: row.id } })).toMatchObject({
      content: "private draft fixture",
      status: 1,
    });
  });
  it("retains published-version immutability inside the transaction", async () => {
    await group();
    const row = await create(1);
    await prisma.legalPolicyVersion.update({
      where: { id: row.id },
      data: { publishStatus: "published", isCurrent: true },
    });
    await expect(service.change("UpdateVersion", row.id, { title: "blocked" }, actor, request())).rejects.toMatchObject(
      { statusCode: 400 },
    );
    await expect(service.change("DeleteVersion", row.id, {}, actor, request())).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: row.id } })).toMatchObject({
      title: "fixture-title",
      status: 1,
    });
  });
  it("rejects stale draft snapshots and revocation between preparation and commit", async () => {
    await group();
    const row = await create(1),
      original = repo.update.bind(repo);
    vi.spyOn(repo, "update").mockImplementation(async (target, input, guard) => {
      await prisma.legalPolicyVersion.update({
        where: { id: row.id },
        data: { publishStatus: "published", isCurrent: true, updateTime: new Date(Date.now() + 1000) },
      });
      return original(target, input, guard);
    });
    await expect(service.change("UpdateVersion", row.id, { title: "blocked" }, actor, request())).rejects.toMatchObject(
      { statusCode: 403 },
    );
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: row.id } })).toMatchObject({
      title: "fixture-title",
      publishStatus: "published",
    });
  });
  it("rolls back an update if the final resource recheck fails after the write", async () => {
    await group();
    const row = await create(1),
      original = repo.update.bind(repo);
    let count = 0;
    vi.spyOn(repo, "update").mockImplementation((target, input, guard) =>
      original(target, input, {
        ...guard,
        recheckVersion: async (id) => {
          await guard.recheckVersion(id);
          if (++count === 2) throw new Error("fixture final revocation");
        },
      }),
    );
    await expect(service.change("UpdateVersion", row.id, { title: "blocked" }, actor, request())).rejects.toThrow(
      "fixture final revocation",
    );
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: row.id } })).toMatchObject({
      title: "fixture-title",
    });
  });
  it("cannot obtain platform write eligibility from account ownership or private groups", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.create(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    const global = await group();
    await prisma.group.update({ where: { id: global.id }, data: { accountOwnerId: owner } });
    await expect(service.create(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.legalPolicyVersion.count()).toBe(0);
  });
  it("rejects global-group revocation before acquiring transaction locks", async () => {
    const global = await group(),
      original = repo.create.bind(repo);
    vi.spyOn(repo, "create").mockImplementation(async (input, guard) => {
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return original(input, guard);
    });
    await expect(service.create(input, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.legalPolicyVersion.count()).toBe(0);
  });
  it("uses role-session grants for draft writes and refuses revoked sessions", async () => {
    await group();
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "legal-write-" + randomUUID() } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    Object.assign(req.authContext!, { assumedRoleId: role.id, roleSessionId: session.id });
    await expect(service.create(input, actor, req)).rejects.toMatchObject({ statusCode: 403 });
    await bind(
      {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: ["quyan:legal_policy:CreateVersion", "quyan:legal_policy:DeleteVersion"],
          Resource: [platformLegalPolicyCreationArn(input.policyType), "acs:platform:*:platform:legal-policy/*"],
        },
      },
      "role",
      role.id,
    );
    const row = await service.create(input, actor, req);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.change("DeleteVersion", row!.id, {}, actor, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: row!.id } })).toMatchObject({ status: 1 });
  });
});
