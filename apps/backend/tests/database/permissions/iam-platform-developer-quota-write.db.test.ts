import BusinessLogService from "@/services/system/businesslog.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { PlatformDeveloperQuotaWriteIamService } from "@/services/developer/platform-developer-quota-write-iam.service";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { DeveloperQuotaAdminService } from "@/services/developer/developer-quota-admin.service";
import { PlatformDeveloperQuotaWriteRepository } from "@/store/developer/platform-developer-quota-write.repository";
import { DeveloperProjectRepository } from "@/store/developer/developer-project.repository";
import {
  platformDeveloperQuotaArn,
  platformDeveloperQuotaSubjectArn,
} from "@/iam/resources/platform-developer-quota-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const originalMode = env.security.iamAuthorizationMode,
  service = DeveloperQuotaAdminService.getInstance(),
  repo = PlatformDeveloperQuotaWriteRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "developer-quota-read-" + randomUUID(),
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
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
  }) as unknown as TypedRequest;
const create = async () =>
  prisma.developerQuotaOverride.create({
    data: {
      subjectType: "user",
      subjectId: await user(owner),
      service: "ip",
      dailyFreeQuota: 100,
      createdByUserId: owner,
    },
  });
async function group() {
  const row = await prisma.group.create({
    data: {
      username: "developer-quota-read-" + randomUUID(),
      name: "fixture global",
      level: 0,
      accountOwnerId: null,
      permissions: [Permission.DEVELOPER_QUOTA_MANAGE],
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function bind(document: unknown, principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy(document);
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "developer-quota-read-" + randomUUID(),
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
  await prisma.developerQuotaOverride.deleteMany();
  owner = await user();
  actor = await user(owner);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
});
const body = (subjectId: string) => ({
  subjectType: "user" as const,
  subjectId,
  service: "ip" as const,
  dailyFreeQuota: 100,
});
describe("platform developer quota write transactions", () => {
  it("creates, updates and deletes real records with a trusted audit actor", async () => {
    await group();
    const target = await user(owner);
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
    const row = await service.upsertManaged(body(target), actor, request());
    expect(row).toMatchObject({ subjectId: target, service: "ip", dailyFreeQuota: 100 });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: "DEVELOPER_QUOTA_OVERRIDE_UPSERT",
        actorUserId: actor,
        targetResourceId: row.id,
        success: true,
      }),
    );
    expect(await service.upsertManaged({ ...body(target), dailyFreeQuota: 200 }, actor, request())).toMatchObject({
      id: row.id,
      dailyFreeQuota: 200,
    });
    expect(await prisma.developerQuotaOverride.findUnique({ where: { id: row.id } })).toMatchObject({
      createdByUserId: actor,
    });
    await service.removeManaged(row.id, actor, request());
    expect(await prisma.developerQuotaOverride.findUnique({ where: { id: row.id } })).toMatchObject({ status: -1 });
  });
  it("validates a real project and its owner before assigning quotas", async () => {
    await group();
    const target = await user(owner),
      project = await prisma.developerProject.create({
        data: { userId: target, name: "quota fixture", slug: "quota-" + randomUUID() },
      });
    const row = await service.upsertManaged(
      { ...body(project.id), subjectType: "project", service: undefined },
      actor,
      request(),
    );
    expect(row).toMatchObject({ subjectType: "project", subjectId: project.id, service: undefined });
    await prisma.developerProject.update({ where: { id: project.id }, data: { status: 0 } });
    await expect(
      service.upsertManaged({ ...body(project.id), subjectType: "project" }, actor, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a subject scope Deny before creating an override", async () => {
    await group();
    const target = await user(owner);
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:developer:UpsertQuotaOverride",
        Resource: platformDeveloperQuotaSubjectArn("user", target, "ip"),
      },
    });
    await expect(service.upsertManaged(body(target), actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerQuotaOverride.count()).toBe(0);
  });
  it("rolls back generated overrides when their actual ARNs are denied", async () => {
    await group();
    const target = await user(owner);
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:developer:UpsertQuotaOverride",
        Resource: "acs:platform:*:platform:developer-quota-override/*",
      },
    });
    await expect(service.upsertManaged(body(target), actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerQuotaOverride.count()).toBe(0);
  });
  it("restores deleted records with the same ID and retains record Deny", async () => {
    await group();
    const row = await create();
    await prisma.developerQuotaOverride.update({ where: { id: row.id }, data: { status: -1 } });
    expect(await service.upsertManaged(body(row.subjectId), actor, request())).toMatchObject({ id: row.id });
    await prisma.developerQuotaOverride.update({ where: { id: row.id }, data: { status: -1 } });
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:developer:UpsertQuotaOverride",
        Resource: platformDeveloperQuotaArn(row.id),
      },
    });
    await expect(service.upsertManaged(body(row.subjectId), actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.developerQuotaOverride.count()).toBe(1);
    expect(await prisma.developerQuotaOverride.findUnique({ where: { id: row.id } })).toMatchObject({ status: -1 });
  });
  it("rejects missing or inactive subjects and expired requested overrides", async () => {
    await group();
    const target = await user(owner);
    await prisma.user.update({ where: { id: target }, data: { status: 0 } });
    await expect(service.upsertManaged(body(target), actor, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.upsertManaged(body("missing-user"), actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      service.upsertManaged({ ...body(actor), expiresAt: new Date(0).toISOString() }, actor, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.developerQuotaOverride.count()).toBe(0);
  });
  it("rejects a target account reassignment before commit", async () => {
    await group();
    const target = await user(owner),
      other = await user(),
      original = repo.upsert.bind(repo);
    vi.spyOn(repo, "upsert").mockImplementation(async (body, preparation, guard) => {
      await prisma.user.update({
        where: { id: target },
        data: { accountOwnerId: other, updateTime: new Date(Date.now() + 1000) },
      });
      return original(body, preparation, guard);
    });
    await expect(service.upsertManaged(body(target), actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerQuotaOverride.count()).toBe(0);
  });
  it("rejects stale quota records before updating values", async () => {
    await group();
    const row = await create(),
      original = repo.upsert.bind(repo);
    vi.spyOn(repo, "upsert").mockImplementation(async (body, preparation, guard) => {
      await prisma.developerQuotaOverride.update({
        where: { id: row.id },
        data: { dailyFreeQuota: 300, updateTime: new Date(Date.now() + 1000) },
      });
      return original(body, preparation, guard);
    });
    await expect(
      service.upsertManaged({ ...body(row.subjectId), dailyFreeQuota: 200 }, actor, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerQuotaOverride.findUnique({ where: { id: row.id } })).toMatchObject({
      dailyFreeQuota: 300,
    });
  });
  it("rejects an override introduced after preparation instead of overwriting it", async () => {
    await group();
    const target = await user(owner),
      original = repo.upsert.bind(repo);
    vi.spyOn(repo, "upsert").mockImplementation(async (body, preparation, guard) => {
      await prisma.developerQuotaOverride.create({
        data: { ...body, subjectType: "user", service: "ip", createdByUserId: owner, dailyFreeQuota: 300 },
      });
      return original(body, preparation, guard);
    });
    await expect(service.upsertManaged(body(target), actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerQuotaOverride.findFirst()).toMatchObject({ dailyFreeQuota: 300 });
  });
  it("rejects a project transferred before its override is saved", async () => {
    await group();
    const target = await user(owner),
      other = await user(owner),
      project = await prisma.developerProject.create({
        data: { userId: target, name: "project fixture", slug: "quota-" + randomUUID() },
      }),
      original = repo.upsert.bind(repo);
    vi.spyOn(repo, "upsert").mockImplementation(async (body, preparation, guard) => {
      await prisma.developerProject.update({
        where: { id: project.id },
        data: { userId: other, updateTime: new Date(Date.now() + 1000) },
      });
      return original(body, preparation, guard);
    });
    await expect(
      service.upsertManaged({ ...body(project.id), subjectType: "project" }, actor, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerQuotaOverride.count()).toBe(0);
  });
  it("rejects group revocation before the mutation", async () => {
    const global = await group(),
      target = await user(owner),
      original = repo.upsert.bind(repo);
    vi.spyOn(repo, "upsert").mockImplementation(async (body, preparation, guard) => {
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return original(body, preparation, guard);
    });
    await expect(service.upsertManaged(body(target), actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerQuotaOverride.count()).toBe(0);
  });
  it.each(["upsert", "delete"] as const)("rolls back %s when the final decision changes to Deny", async (operation) => {
    await group();
    const row = await create(),
      iam = IamAuthorizationService.getInstance(),
      original = iam.authorize.bind(iam);
    let calls = 0;
    vi.spyOn(iam, "authorize").mockImplementation(async (input) => {
      if (
        input.action ===
          (operation === "upsert" ? "quyan:developer:UpsertQuotaOverride" : "quyan:developer:DeleteQuotaOverride") &&
        ++calls >= (operation === "upsert" ? 6 : 4)
      )
        return { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
      return original(input);
    });
    const result =
      operation === "upsert"
        ? service.upsertManaged({ ...body(row.subjectId), dailyFreeQuota: 200 }, actor, request())
        : service.removeManaged(row.id, actor, request());
    await expect(result).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerQuotaOverride.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 1,
      dailyFreeQuota: 100,
    });
  });
  it("requires persisted platform eligibility despite wildcard Allow", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.upsertManaged(body(actor), actor, request())).rejects.toMatchObject({ statusCode: 403 });
    const global = await group();
    await prisma.group.update({ where: { id: global.id }, data: { accountOwnerId: owner } });
    await expect(service.upsertManaged(body(actor), actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerQuotaOverride.count()).toBe(0);
  });
  it("requires role grants for both the subject scope and generated actual record", async () => {
    await group();
    const target = await user(owner),
      role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "quota-write-" + randomUUID() } });
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
          Action: "quyan:developer:UpsertQuotaOverride",
          Resource: platformDeveloperQuotaSubjectArn("user", target, "ip"),
        },
      },
      "role",
      role.id,
    );
    await expect(service.upsertManaged(body(target), actor, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.developerQuotaOverride.count()).toBe(0);
    await bind(
      {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:developer:UpsertQuotaOverride",
          Resource: "acs:platform:*:platform:developer-quota-override/*",
        },
      },
      "role",
      role.id,
    );
    expect(await service.upsertManaged(body(target), actor, req)).toMatchObject({ subjectId: target });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.upsertManaged(body(target), actor, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shadow is read-only and invokes the legacy write once", async () => {
    await group();
    env.security.iamAuthorizationMode = "shadow";
    const target = await user(owner);
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: "quyan:developer:UpsertQuotaOverride", Resource: "*" },
    });
    const native = vi.spyOn(repo, "upsert"),
      legacy = vi.spyOn(DeveloperProjectRepository.getInstance(), "upsertQuotaOverride");
    await service.upsertManaged(body(target), actor, request());
    expect(native).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledOnce();
    expect(await prisma.developerQuotaOverride.count()).toBe(1);
  });
  it("pure shadow preparation cannot change or delete an existing quota", async () => {
    await group();
    const row = await create(),
      native = PlatformDeveloperQuotaWriteIamService.getInstance();
    await native.upsert({ ...body(row.subjectId), dailyFreeQuota: 200 }, actor, request(), false);
    await native.remove(row.id, actor, request(), false);
    expect(await prisma.developerQuotaOverride.findUnique({ where: { id: row.id } })).toMatchObject({
      dailyFreeQuota: 100,
      status: 1,
    });
  });
});
