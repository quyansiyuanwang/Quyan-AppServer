import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { RECORD_STATUS } from "@/constant/status";
import { Permission } from "@quyan/shared";
import { PlatformIpWhitelistWriteIamService } from "@/services/system/platform-ip-whitelist-write-iam.service";
import { PlatformIpWhitelistWriteRepository } from "@/store/security/platform-ip-whitelist-write.repository";
import { IPWhiteListRepository } from "@/store/security/ipwhitelist";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import {
  platformIpWhitelistArn,
  platformIpWhitelistCollectionArn,
} from "@/iam/resources/platform-ip-whitelist-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const service = PlatformIpWhitelistWriteIamService.getInstance(),
  repo = PlatformIpWhitelistWriteRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "whitelist-write-" + randomUUID(),
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
async function group(permissions = [Permission.IP_WHITELIST_CREATE, Permission.IP_WHITELIST_DELETE]) {
  const row = await prisma.group.create({
    data: {
      username: "whitelist-write-" + randomUUID(),
      name: "fixture global",
      level: 0,
      accountOwnerId: null,
      permissions,
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function bind(document: unknown, principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy(document);
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "whitelist-write-" + randomUUID(),
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
async function deny(action: string, resource: string) {
  return bind({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: resource } });
}
const create = (ipAddress = "192.0.2.1") =>
  prisma.iPWhiteList.create({ data: { ipAddress, reason: "fixture", addedBy: actor } });
beforeEach(async () => {
  vi.restoreAllMocks();
  await prisma.iPWhiteList.deleteMany();
  owner = await user();
  actor = await user(owner);
});
afterEach(() => vi.restoreAllMocks());
describe("platform IP whitelist write authorization database", () => {
  it("creates and deletes a real IPv6 record with an immutable audit actor", async () => {
    await group();
    const row = await service.create("2001:db8::1", "fixture", actor, undefined, request());
    expect(row).toMatchObject({ ipAddress: "2001:db8::1", status: 1, addedBy: actor });
    expect(await service.remove("2001:db8::1", actor, request())).toBe(true);
    expect(await prisma.iPWhiteList.findUnique({ where: { id: row!.id } })).toMatchObject({
      status: RECORD_STATUS.DELETED,
    });
  });
  it("rejects a creation-boundary Deny without inserting a row", async () => {
    await group();
    await deny("quyan:ip_whitelist:CreateEntry", platformIpWhitelistCollectionArn());
    await expect(service.create("192.0.2.1", "", actor, undefined, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.iPWhiteList.count()).toBe(0);
  });
  it("rolls back an insert when the actual resource receives Deny", async () => {
    await group();
    await deny("quyan:ip_whitelist:CreateEntry", "acs:platform:*:platform:ip-whitelist/*");
    await expect(service.create("192.0.2.1", "", actor, undefined, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.iPWhiteList.count()).toBe(0);
  });
  it("restores a deleted entry using the same ID and keeps its resource Deny", async () => {
    await group();
    const original = await create();
    await service.remove(original.ipAddress, actor, request());
    const restored = await service.create(original.ipAddress, "restored", actor, undefined, request());
    expect(restored).toMatchObject({ id: original.id, status: 1, reason: "restored" });
    await service.remove(original.ipAddress, actor, request());
    await deny("quyan:ip_whitelist:CreateEntry", platformIpWhitelistArn(original.id));
    await expect(service.create(original.ipAddress, "blocked", actor, undefined, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.iPWhiteList.findUnique({ where: { id: original.id } })).toMatchObject({
      status: RECORD_STATUS.DELETED,
      reason: "restored",
    });
  });
  it("rejects active duplicates with a conflict and retains the existing record", async () => {
    await group();
    const original = await create();
    await expect(service.create(original.ipAddress, "replacement", actor, undefined, request())).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(await prisma.iPWhiteList.findUnique({ where: { id: original.id } })).toMatchObject({ reason: "fixture" });
  });
  it("does not allow account ownership or private groups to create global records", async () => {
    await expect(service.create("192.0.2.1", "", actor, undefined, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    const global = await group();
    await prisma.group.update({ where: { id: global.id }, data: { accountOwnerId: owner } });
    await expect(service.create("192.0.2.1", "", actor, undefined, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    const rootRequest = request();
    rootRequest.user!.userId = owner;
    rootRequest.authContext!.principalUserId = owner;
    await expect(service.create("192.0.2.1", "", owner, undefined, rootRequest)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.iPWhiteList.count()).toBe(0);
  });
  it("rejects record Deny and cannot remove a missing record", async () => {
    await group();
    const row = await create();
    await deny("quyan:ip_whitelist:DeleteEntry", platformIpWhitelistArn(row.id));
    await expect(service.remove(row.ipAddress, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.remove("198.51.100.1", actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.iPWhiteList.findUnique({ where: { id: row.id } })).toMatchObject({ status: 1 });
  });
  it("rejects global group revocation between preparation and the transaction", async () => {
    const global = await group(),
      original = repo.create.bind(repo);
    vi.spyOn(repo, "create").mockImplementation(async (input, guard) => {
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return original(input, guard);
    });
    await expect(service.create("192.0.2.1", "", actor, undefined, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await prisma.iPWhiteList.count()).toBe(0);
  });
  it("rolls back deletion when final authorization fails after the write", async () => {
    await group();
    const row = await create(),
      iam = IamAuthorizationService.getInstance(),
      original = iam.authorize.bind(iam);
    let calls = 0;
    vi.spyOn(iam, "authorize").mockImplementation(async (input) => {
      if (input.action === "quyan:ip_whitelist:DeleteEntry" && ++calls >= 4)
        return { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
      return original(input);
    });
    await expect(service.remove(row.ipAddress, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.iPWhiteList.findUnique({ where: { id: row.id } })).toMatchObject({ status: 1 });
  });
  it("rejects stale record snapshots before a deletion", async () => {
    await group();
    const row = await create(),
      original = repo.remove.bind(repo);
    vi.spyOn(repo, "remove").mockImplementation(async (target, guard) => {
      await prisma.iPWhiteList.update({
        where: { id: row.id },
        data: { reason: "changed", updateTime: new Date(Date.now() + 1000) },
      });
      return original(target, guard);
    });
    await expect(service.remove(row.ipAddress, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.iPWhiteList.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 1,
      reason: "changed",
    });
  });
  it("does not inherit user or global-group grants during AssumeRole mutations", async () => {
    await group();
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "whitelist-write-" + randomUUID() },
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
    await expect(service.create("192.0.2.1", "", actor, undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.iPWhiteList.count()).toBe(0);
    await bind(
      {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: ["quyan:ip_whitelist:CreateEntry", "quyan:ip_whitelist:DeleteEntry"],
          Resource: [platformIpWhitelistCollectionArn(), "acs:platform:*:platform:ip-whitelist/*"],
        },
      },
      "role",
      role.id,
    );
    const row = await service.create("192.0.2.1", "", actor, undefined, req);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.remove("192.0.2.1", actor, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.iPWhiteList.findUnique({ where: { id: row!.id } })).toMatchObject({
      status: RECORD_STATUS.ACTIVE,
    });
  });
  it("uses the same record-level Deny for AccessKey authentication context", async () => {
    await group();
    const req = request();
    req.authContext!.subjectType = "access_key";
    const row = await service.create("192.0.2.1", "", actor, undefined, req);
    await deny("quyan:ip_whitelist:DeleteEntry", platformIpWhitelistArn(row!.id));
    await expect(service.remove("192.0.2.1", actor, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.iPWhiteList.findUnique({ where: { id: row!.id } })).toMatchObject({
      status: RECORD_STATUS.ACTIVE,
    });
  });
  it("retains the identity of soft-deleted records in the legacy rollback path too", async () => {
    const row = await create();
    await prisma.iPWhiteList.update({ where: { id: row.id }, data: { status: RECORD_STATUS.DELETED } });
    expect(
      await IPWhiteListRepository.getInstance().create({
        ipAddress: row.ipAddress,
        reason: "legacy restored",
        addedBy: actor,
      }),
    ).toMatchObject({ id: row.id, status: 1, expiresAt: null });
  });
});
