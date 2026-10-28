import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { RECORD_STATUS } from "@/constant/status";
import { Permission } from "@quyan/shared";
import { PlatformIpWhitelistReadIamService } from "@/services/system/platform-ip-whitelist-read-iam.service";
import { PlatformIpWhitelistReadRepository } from "@/store/security/platform-ip-whitelist-read.repository";
import { platformIpWhitelistArn } from "@/iam/resources/platform-ip-whitelist-resources";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const service = PlatformIpWhitelistReadIamService.getInstance(),
  repo = PlatformIpWhitelistReadRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "whitelist-read-" + randomUUID(),
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
beforeEach(async () => {
  vi.restoreAllMocks();
  await prisma.iPWhiteList.deleteMany();
  owner = await user();
  actor = await user(owner);
});
afterEach(() => {
  vi.restoreAllMocks();
});
async function group() {
  const row = await prisma.group.create({
    data: {
      username: "whitelist-read-" + randomUUID(),
      name: "fixture global",
      level: 0,
      permissions: [Permission.IP_WHITELIST_READ],
      accountOwnerId: null,
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function bind(document: unknown, principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy(document);
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "whitelist-read-" + randomUUID(),
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
const create = (ip: string, expiresAt?: Date) =>
  prisma.iPWhiteList.create({ data: { ipAddress: ip, reason: "fixture-only", addedBy: actor, expiresAt } });
describe("platform IP whitelist read authorization database", () => {
  it("filters Deny before pagination and preserves an authorized total and IPv6 display", async () => {
    await group();
    const denied = await create("192.0.2.1"),
      visible = await create("2001:db8::1");
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:ip_whitelist:ListEntries",
        Resource: platformIpWhitelistArn(denied.id),
      },
    });
    const page = await service.list(1, 0, request());
    expect(page.total).toBe(1);
    expect(page.whitelists.map((r) => r.id)).toEqual([visible.id]);
    expect(page.whitelists[0].ipAddress).toBe("2001:db8::1");
    expect(await service.list(1, 1, request())).toEqual({ whitelists: [], total: 1 });
  });
  it("does not grant global eligibility to account owners or account-created groups", async () => {
    await create("192.0.2.1");
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.list(10, 0, request())).rejects.toMatchObject({ statusCode: 403 });
    const ownerRequest = request();
    ownerRequest.user!.userId = owner;
    ownerRequest.authContext!.principalUserId = owner;
    await expect(service.list(10, 0, ownerRequest)).rejects.toMatchObject({ statusCode: 403 });
    const row = await group();
    await prisma.group.update({ where: { id: row.id }, data: { accountOwnerId: owner } });
    await expect(service.status("192.0.2.1", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses the real record resource for status and reads expiry without a cached grant", async () => {
    await group();
    const active = await create("2001:db8::1");
    await create("192.0.2.1", new Date(0));
    expect(await service.status("2001:db8::1", request())).toBe(true);
    expect(await service.status("192.0.2.1", request())).toBe(false);
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:ip_whitelist:GetStatus",
        Resource: platformIpWhitelistArn(active.id),
      },
    });
    await expect(service.status("2001:db8::1", request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.status("198.51.100.1", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("discards a page if a record changes after metadata selection", async () => {
    await group();
    const row = await create("192.0.2.1"),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (principal, targets) => {
      await prisma.iPWhiteList.update({
        where: { id: row.id },
        data: { reason: "changed", updateTime: new Date(Date.now() + 1000) },
      });
      return original(principal, targets);
    });
    await expect(service.list(10, 0, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects group revocation and a newly bound Deny after display fields are loaded", async () => {
    const global = await group(),
      row = await create("192.0.2.1"),
      original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (principal, targets) => {
      const rows = await original(principal, targets);
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return rows;
    });
    await expect(service.list(10, 0, request())).rejects.toMatchObject({ statusCode: 403 });
    vi.restoreAllMocks();
    await prisma.group.update({ where: { id: global.id }, data: { permissions: [Permission.IP_WHITELIST_READ] } });
    vi.spyOn(repo, "hydrate").mockImplementation(async (principal, targets) => {
      const rows = await original(principal, targets);
      await bind({
        Version: "1",
        Statement: {
          Effect: "Deny",
          Action: "quyan:ip_whitelist:ListEntries",
          Resource: platformIpWhitelistArn(row.id),
        },
      });
      return rows;
    });
    await expect(service.list(10, 0, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a deleted record at the status read boundary", async () => {
    await group();
    const row = await create("192.0.2.1"),
      original = repo.recheck.bind(repo);
    vi.spyOn(repo, "recheck").mockImplementation(async (principal, targets) => {
      await prisma.iPWhiteList.update({ where: { id: row.id }, data: { status: RECORD_STATUS.DELETED } });
      return original(principal, targets);
    });
    await expect(service.status("192.0.2.1", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps AssumeRole policies isolated from the subject's global group Allow", async () => {
    await group();
    const row = await create("192.0.2.1");
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "whitelist-read-" + randomUUID() },
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
    expect(await service.list(10, 0, req)).toEqual({ whitelists: [], total: 0 });
    await bind(
      {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: ["quyan:ip_whitelist:ListEntries", "quyan:ip_whitelist:GetStatus"],
          Resource: platformIpWhitelistArn(row.id),
        },
      },
      "role",
      role.id,
    );
    expect((await service.list(10, 0, req)).total).toBe(1);
    expect(await service.status("192.0.2.1", req)).toBe(true);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.list(10, 0, req)).rejects.toMatchObject({ statusCode: 403 });
  });
});
