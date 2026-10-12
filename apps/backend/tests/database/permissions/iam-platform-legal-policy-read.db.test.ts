import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { LegalPolicyService } from "@/services/legal-policy/legal-policy.service";
import { PlatformLegalPolicyReadRepository } from "@/store/content/platform-legal-policy-read.repository";
import { platformLegalPolicyArn } from "@/iam/resources/platform-legal-policy-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const originalMode = env.security.iamAuthorizationMode,
  service = LegalPolicyService.getInstance(),
  repo = PlatformLegalPolicyReadRepository.getInstance();
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
      permissions: [Permission.LEGAL_POLICY_READ],
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
describe("platform legal policy version read authorization database", () => {
  it("filters version summaries before loading display fields and retains ordering", async () => {
    await group();
    const hidden = await create(1),
      visible = await create(2);
    const privacy = await create(1, "privacy_policy");
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:legal_policy:ListVersions",
        Resource: platformLegalPolicyArn(hidden.id),
      },
    });
    const hydrate = vi.spyOn(repo, "summaries");
    const result = await service.listManagedPolicies(request());
    expect(result.map((r) => r.id)).toEqual([privacy.id, visible.id]);
    expect(hydrate.mock.calls.flatMap((c) => c[1].map((t) => t.id))).not.toContain(hidden.id);
    expect(JSON.stringify(result)).not.toContain("private draft fixture");
    expect(result[1].createdByName).toBe("fixture-name");
  });
  it("does not treat creator IDs, account ownership or private groups as platform eligibility", async () => {
    const row = await create(1);
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.getManagedPolicy(row.id, request())).rejects.toMatchObject({ statusCode: 403 });
    const rootReq = request();
    rootReq.user!.userId = owner;
    rootReq.authContext!.principalUserId = owner;
    await expect(service.listManagedPolicies(rootReq)).rejects.toMatchObject({ statusCode: 403 });
    const global = await group();
    await prisma.group.update({ where: { id: global.id }, data: { accountOwnerId: owner } });
    await expect(service.listManagedPolicies(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("checks the real version ARN before returning draft content and fails on missing versions", async () => {
    await group();
    const row = await create(1);
    expect(await service.getManagedPolicy(row.id, request())).toMatchObject({
      id: row.id,
      content: "private draft fixture",
      createdByName: "fixture-name",
    });
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: "quyan:legal_policy:GetVersion", Resource: platformLegalPolicyArn(row.id) },
    });
    const detail = vi.spyOn(repo, "detail");
    await expect(service.getManagedPolicy(row.id, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.getManagedPolicy("missing-version", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(detail).not.toHaveBeenCalled();
  });
  it("discards stale rows when a version changes between metadata and hydration", async () => {
    await group();
    const row = await create(1),
      original = repo.detail.bind(repo);
    vi.spyOn(repo, "detail").mockImplementation(async (principal, target) => {
      await prisma.legalPolicyVersion.update({
        where: { id: row.id },
        data: { content: "changed fixture", updateTime: new Date(Date.now() + 1000) },
      });
      return original(principal, target);
    });
    await expect(service.getManagedPolicy(row.id, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("reevaluates global qualification and a new Deny before returning display data", async () => {
    const global = await group(),
      row = await create(1),
      original = repo.summaries.bind(repo);
    vi.spyOn(repo, "summaries").mockImplementation(async (principal, targets) => {
      const rows = await original(principal, targets);
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return rows;
    });
    await expect(service.listManagedPolicies(request())).rejects.toMatchObject({ statusCode: 403 });
    vi.restoreAllMocks();
    await prisma.group.update({ where: { id: global.id }, data: { permissions: [Permission.LEGAL_POLICY_READ] } });
    vi.spyOn(repo, "summaries").mockImplementation(async (principal, targets) => {
      const rows = await original(principal, targets);
      await bind({
        Version: "1",
        Statement: {
          Effect: "Deny",
          Action: "quyan:legal_policy:ListVersions",
          Resource: platformLegalPolicyArn(row.id),
        },
      });
      return rows;
    });
    await expect(service.listManagedPolicies(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("restricts role sessions to their own version grants and rejects revocation", async () => {
    await group();
    const row = await create(1),
      other = await create(2);
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "legal-read-" + randomUUID() } });
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
    expect(await service.listManagedPolicies(req)).toEqual([]);
    await bind(
      {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: ["quyan:legal_policy:ListVersions", "quyan:legal_policy:GetVersion"],
          Resource: platformLegalPolicyArn(row.id),
        },
      },
      "role",
      role.id,
    );
    expect((await service.listManagedPolicies(req)).map((r) => r.id)).toEqual([row.id]);
    await expect(service.getManagedPolicy(other.id, req)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.getManagedPolicy(row.id, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("retains original management responses in %s", async (mode) => {
    await group();
    const row = await create(1);
    env.security.iamAuthorizationMode = mode;
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: ["quyan:legal_policy:GetVersion", "quyan:legal_policy:ListVersions"],
        Resource: platformLegalPolicyArn(row.id),
      },
    });
    expect((await service.listManagedPolicies(request())).map((r) => r.id)).toEqual([row.id]);
    expect((await service.getManagedPolicy(row.id, request())).content).toBe("private draft fixture");
  });
});
