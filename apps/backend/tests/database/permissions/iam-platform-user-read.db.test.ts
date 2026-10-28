import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { PlatformUserReadIamService } from "@/services/users/platform-user-read-iam.service";
import { PlatformUserReadRepository } from "@/store/users/platform-user-read.repository";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { PermissionService } from "@/services/users/permission.service";
import type { TypedRequest } from "@/types/express";
import * as conditions from "@/iam/request/condition-context";
let owner: string,
  actor: string,
  groupId: string,
  targetGroup: string,
  first: string,
  second: string,
  ram: string,
  higher: string;
const mode = env.security.iamAuthorizationMode,
  service = PlatformUserReadIamService.getInstance(),
  repository = PlatformUserReadRepository.getInstance(),
  list = "quyan:user:ListUsers",
  detail = "quyan:user:GetUser";
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "directory-fixture-" + randomUUID(),
        password: "fixture-only-credential",
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
    headers: { "x-action": "*", "x-account-id": "forged" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const query = () => ({ groupId: targetGroup });
async function bind(
  effect: "Allow" | "Deny",
  action: string | string[],
  targetId = first,
  principalType = "user",
  principalId = actor,
  condition?: Record<string, Record<string, string>>,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: {
      Effect: effect,
      Action: action,
      Resource: platformUserArn(targetId),
      ...(condition ? { Condition: condition } : {}),
    },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "directory-policy-" + randomUUID(),
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
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  first = await user();
  second = await user();
  higher = await user();
  ram = await user(first);
  groupId = (
    await prisma.group.create({
      data: {
        username: "directory-global-" + randomUUID(),
        name: "Reviewer",
        level: 1,
        permissions: [Permission.USER_READ],
        accountOwnerId: null,
      },
    })
  ).id;
  targetGroup = (
    await prisma.group.create({
      data: {
        username: "directory-target-" + randomUUID(),
        name: "Visible",
        level: 2,
        permissions: [],
        accountOwnerId: null,
      },
    })
  ).id;
  const highGroup = await prisma.group.create({
    data: {
      username: "directory-high-" + randomUUID(),
      name: "Higher",
      level: 0,
      permissions: [],
      accountOwnerId: null,
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  await prisma.user.update({
    where: { id: first },
    data: { groupId: targetGroup, email: "private@example.invalid", name: "Visible" },
  });
  await prisma.user.update({ where: { id: second }, data: { groupId: targetGroup, status: 0 } });
  await prisma.user.update({
    where: { id: ram },
    data: { groupId: targetGroup, userType: "ram_user", parentUserId: first },
  });
  await prisma.user.update({ where: { id: higher }, data: { groupId: highGroup.id } });
  await prisma.balanceAccount.create({ data: { userId: first, balance: 32.125 } });
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
});
describe("persisted platform user directory reads", () => {
  it("returns credential-free authorized user views including disabled records", async () => {
    const result = await service.list(query(), request());
    expect(result.total).toBe(2);
    expect(result.users.map((row) => row.id).sort()).toEqual([first, second].sort());
    expect(result.users.find((row) => row.id === second)!.status).toBe(0);
    const dto = await service.detail(first, request());
    expect(dto).toMatchObject({
      id: first,
      email: "private@example.invalid",
      groupName: "Visible",
      balance: 32.125,
      accountOwnerId: first,
    });
    expect(dto).not.toHaveProperty("password");
    expect(dto).not.toHaveProperty("permissionAdds");
    const principal = {
      subjectUserId: actor,
      principalUserId: actor,
      accountOwnerId: owner,
      subjectType: "sub_user" as const,
    };
    const targets = await repository.scan(
      principal,
      await repository.where(principal, { groupId: targetGroup, excludeUserType: "ram_user" }),
    );
    expect(targets[0]).not.toHaveProperty("email");
    expect(targets[0]).not.toHaveProperty("password");
    expect(targets[0]!.revision).toMatch(/^[a-f0-9]{64}$/);
  });
  it("filters scoped group Deny before totals and pagination", async () => {
    await bind("Deny", list, first, "group", groupId);
    const hydrate = vi.spyOn(repository, "hydrate"),
      result = await service.list({ ...query(), pageSize: 1 }, request());
    expect(result).toMatchObject({ total: 1, hasMore: false, users: [{ id: second }] });
    expect(hydrate.mock.calls[0]![1].map((row) => row.id)).toEqual([second]);
  });
  it("retains list tier visibility and explicit RAM-user filters", async () => {
    expect((await service.list({ userId: higher }, request())).total).toBe(0);
    expect((await service.list({ ...query(), userType: "ram_user" }, request())).users.map((row) => row.id)).toEqual([
      ram,
    ]);
    await prisma.user.update({ where: { id: ram }, data: { permissionAdds: [Permission.RAM_USER_READ] } });
    expect((await service.list({ ...query(), hasRamPermission: true }, request())).users.map((row) => row.id)).toEqual([
      ram,
    ]);
  });
  it("does not use list authorization as a detail grant", async () => {
    await bind("Deny", detail);
    expect((await service.list(query(), request())).total).toBe(2);
    const hydrate = vi.spyOn(repository, "hydrate");
    await expect(service.detail(first, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("keeps disabled users readable and deleted users unavailable", async () => {
    expect((await service.detail(second, request()))!.status).toBe(0);
    await prisma.user.update({ where: { id: second }, data: { status: -1 } });
    expect((await service.list(query(), request())).total).toBe(1);
    await expect(service.detail(second, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["personal", "private", "disabled", "wrong"])(
    "requires persisted global qualification for %s",
    async (kind) => {
      if (kind === "personal")
        await prisma.user.update({
          where: { id: actor },
          data: { groupId: null, permissionAdds: [Permission.USER_READ] },
        });
      if (kind === "private") await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      if (kind === "disabled") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      if (kind === "wrong")
        await prisma.group.update({ where: { id: groupId }, data: { permissions: [Permission.USER_UPDATE] } });
      await bind("Allow", [list, detail]);
      await expect(service.list(query(), request())).rejects.toMatchObject({ statusCode: 403 });
      await expect(service.detail(first, request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("rejects contact changes with preserved timestamps after hydration", async () => {
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (principal, targets) => {
      const rows = await hydrate(principal, targets),
        row = rows.find((item) => item.id === first)!;
      await prisma.user.update({
        where: { id: first },
        data: { email: "changed@example.invalid", updateTime: row.updateTime },
      });
      return rows;
    });
    await expect(service.list(query(), request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects changed account ownership before locked hydration", async () => {
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (principal, targets) => {
      await prisma.user.update({
        where: { id: first },
        data: { accountOwnerId: owner, updateTime: targets[0]!.updateTime },
      });
      return hydrate(principal, targets);
    });
    await expect(service.detail(first, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects balance changes with preserved timestamps", async () => {
    const hydrate = repository.hydrate.bind(repository),
      account = await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: first } });
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.balanceAccount.update({
        where: { id: account.id },
        data: { balance: 99, updateTime: account.updateTime },
      });
      return rows;
    });
    await expect(service.detail(first, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects changed group display data with unchanged user timestamps", async () => {
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.group.update({ where: { id: targetGroup }, data: { name: "Changed" } });
      return rows;
    });
    await expect(service.list(query(), request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects reviewer tier changes even when group update time is preserved", async () => {
    const hydrate = repository.hydrate.bind(repository),
      group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.group.update({ where: { id: groupId }, data: { level: 3, updateTime: group.updateTime } });
      return rows;
    });
    await expect(service.list(query(), request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects group eligibility revocation before returning views", async () => {
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      return rows;
    });
    await expect(service.detail(first, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires explicit role read grants and denies revoked sessions", async () => {
    const role = await prisma.ramRole.create({
        data: { accountOwnerId: owner, name: "directory-role-" + randomUUID() },
      }),
      session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: owner,
          roleId: role.id,
          subjectUserId: actor,
          sessionName: "fixture",
          tokenJtiHash: randomUUID(),
          expiresAt: new Date(Date.now() + 60000),
        },
      });
    const req = request();
    req.authContext!.roleSessionId = session.id;
    req.authContext!.assumedRoleId = role.id;
    await expect(service.detail(first, req)).rejects.toMatchObject({ statusCode: 403 });
    expect((await service.list(query(), req)).total).toBe(0);
    await bind("Allow", [list, detail], first, "role", role.id);
    expect((await service.detail(first, req))!.id).toBe(first);
    expect((await service.list(query(), req)).users.map((row) => row.id)).toEqual([first]);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { status: 0 } });
    await expect(service.detail(first, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("applies user resource Deny to authenticated AccessKeys", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    await bind("Deny", detail);
    await expect(service.detail(first, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks live conditions before returning a user detail", async () => {
    await bind("Deny", detail, first, "user", actor, { IpAddress: { "acs:SourceIp": "192.0.3.0/24" } });
    const original = conditions.requestConditionContext,
      hydrate = repository.hydrate.bind(repository);
    let changed = false;
    vi.spyOn(conditions, "requestConditionContext").mockImplementation((req, principal) => ({
      ...original(req, principal),
      "acs:SourceIp": changed ? "192.0.3.21" : "192.0.2.20",
    }));
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      changed = true;
      return rows;
    });
    await expect(service.detail(first, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("retains old permission checks and user views in %s", async (current) => {
    env.security.iamAuthorizationMode = current;
    const hydrate = vi.spyOn(repository, "hydrate");
    expect((await service.list(query(), request())).total).toBe(2);
    expect((await service.detail(first, request()))!.balance).toBe(32.125);
    expect(hydrate).not.toHaveBeenCalled();
    vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({
      hasPermission: false,
      checkedPermissions: [Permission.USER_READ],
      missingPermissions: [Permission.USER_READ],
    });
    await expect(service.list(query(), request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.detail(first, request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
