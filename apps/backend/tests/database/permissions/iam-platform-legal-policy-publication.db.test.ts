import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission, LegalPolicyType } from "@quyan/shared";
import { env } from "@/config/env";
import { LegalPolicyService } from "@/services/legal-policy/legal-policy.service";
import { PlatformLegalPolicyPublicationRepository } from "@/store/content/platform-legal-policy-publication.repository";
import { platformLegalPolicyArn } from "@/iam/resources/platform-legal-policy-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const originalMode = env.security.iamAuthorizationMode,
  service = LegalPolicyService.getInstance(),
  repo = PlatformLegalPolicyPublicationRepository.getInstance();
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
    ip: "192.0.2.1",
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
      permissions: [Permission.LEGAL_POLICY_PUBLISH],
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
const change = (op: "PublishVersion" | "UnpublishVersion", id: string, req = request()) =>
  service.changeManagedPublication(op, id, actor, req);
const publish = async (version: number) => {
  const row = await create(version);
  return prisma.legalPolicyVersion.update({
    where: { id: row.id },
    data: { publishStatus: "published", isCurrent: true, publishedAt: new Date() },
  });
};
describe("legal policy publication atomic authorization database", () => {
  it("publishes a real version and atomically demotes the old current version", async () => {
    await group();
    const old = await publish(1),
      next = await create(2);
    expect(await change("PublishVersion", next.id)).toMatchObject({
      id: next.id,
      publishStatus: "published",
      isCurrent: true,
      updatedBy: actor,
    });
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: old.id } })).toMatchObject({
      publishStatus: "published",
      isCurrent: false,
      updatedBy: actor,
    });
    expect((await service.getCurrentPolicies(LegalPolicyType.TERMS_OF_SERVICE)).policies).toBeDefined();
  });
  it("rolls back publishing if the old current version is denied", async () => {
    await group();
    const old = await publish(1),
      next = await create(2);
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:legal_policy:PublishVersion",
        Resource: platformLegalPolicyArn(old.id),
      },
    });
    await expect(change("PublishVersion", next.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: old.id } })).toMatchObject({ isCurrent: true });
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: next.id } })).toMatchObject({
      publishStatus: "draft",
    });
  });
  it("unpublishes the current version and selects the latest authorized published fallback", async () => {
    await group();
    const old = await publish(1);
    await prisma.legalPolicyVersion.update({ where: { id: old.id }, data: { isCurrent: false } });
    const current = await publish(2);
    expect(await change("UnpublishVersion", current.id)).toMatchObject({ publishStatus: "draft", isCurrent: false });
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: old.id } })).toMatchObject({
      publishStatus: "published",
      isCurrent: true,
      updatedBy: actor,
    });
  });
  it("refuses fallback Deny without unpublishing or choosing a different fallback", async () => {
    await group();
    const first = await publish(1);
    await prisma.legalPolicyVersion.update({ where: { id: first.id }, data: { isCurrent: false } });
    const latest = await publish(2);
    await prisma.legalPolicyVersion.update({ where: { id: latest.id }, data: { isCurrent: false } });
    const current = await publish(3);
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:legal_policy:UnpublishVersion",
        Resource: platformLegalPolicyArn(latest.id),
      },
    });
    await expect(change("UnpublishVersion", current.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: current.id } })).toMatchObject({
      isCurrent: true,
      publishStatus: "published",
    });
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: latest.id } })).toMatchObject({
      isCurrent: false,
    });
  });
  it("preserves a current version when no published fallback exists", async () => {
    await group();
    const current = await publish(1);
    await expect(change("UnpublishVersion", current.id)).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: current.id } })).toMatchObject({
      isCurrent: true,
    });
  });
  it("rejects a concurrently changed affected set before altering publication state", async () => {
    await group();
    const old = await publish(1),
      next = await create(2),
      original = repo.commit.bind(repo);
    vi.spyOn(repo, "commit").mockImplementation(async (guard) => {
      const extra = await create(3);
      await prisma.legalPolicyVersion.update({
        where: { id: extra.id },
        data: { publishStatus: "published", isCurrent: true },
      });
      return original(guard);
    });
    await expect(change("PublishVersion", next.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: old.id } })).toMatchObject({ isCurrent: true });
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: next.id } })).toMatchObject({
      publishStatus: "draft",
    });
  });
  it("rolls back every publication update on a final permission failure", async () => {
    await group();
    const old = await publish(1),
      next = await create(2),
      original = repo.commit.bind(repo);
    let calls = 0;
    vi.spyOn(repo, "commit").mockImplementation((guard) =>
      original({
        ...guard,
        users: {
          ...guard.users,
          recheck: async () => {
            await guard.users.recheck();
            if (++calls === 3) throw new Error("fixture final revocation");
          },
        },
      }),
    );
    await expect(change("PublishVersion", next.id)).rejects.toThrow("fixture final revocation");
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: old.id } })).toMatchObject({ isCurrent: true });
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: next.id } })).toMatchObject({
      publishStatus: "draft",
    });
  });
  it("requires real global group eligibility and rejects revocation before the transaction", async () => {
    const row = await create(1);
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(change("PublishVersion", row.id)).rejects.toMatchObject({ statusCode: 403 });
    const global = await group(),
      original = repo.commit.bind(repo);
    vi.spyOn(repo, "commit").mockImplementation(async (guard) => {
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return original(guard);
    });
    await expect(change("PublishVersion", row.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.legalPolicyVersion.findUnique({ where: { id: row.id } })).toMatchObject({
      publishStatus: "draft",
    });
  });
  it("requires role grants on both new and demoted versions during AssumeRole", async () => {
    await group();
    const old = await publish(1),
      next = await create(2);
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "legal-publication-" + randomUUID() },
    });
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
    await bind(
      {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:legal_policy:PublishVersion",
          Resource: platformLegalPolicyArn(next.id),
        },
      },
      "role",
      role.id,
    );
    await expect(change("PublishVersion", next.id, req)).rejects.toMatchObject({ statusCode: 403 });
    await bind(
      {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:legal_policy:PublishVersion",
          Resource: platformLegalPolicyArn(old.id),
        },
      },
      "role",
      role.id,
    );
    expect(await change("PublishVersion", next.id, req)).toMatchObject({ isCurrent: true });
  });
  it.each(["legacy", "shadow"] as const)("preserves the original publication operation once in %s", async (mode) => {
    await group();
    const row = await create(1);
    env.security.iamAuthorizationMode = mode;
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:legal_policy:PublishVersion",
        Resource: platformLegalPolicyArn(row.id),
      },
    });
    const legacy = vi.spyOn(service, "publishPolicy");
    expect(await change("PublishVersion", row.id)).toMatchObject({ isCurrent: true });
    expect(legacy).toHaveBeenCalledOnce();
  });
});
