import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { Permission } from "@quyan/shared";
import { env } from "@/config/env";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { PlatformTicketAssignmentIamService } from "@/services/ticket/platform-ticket-assignment-iam.service";
import { PlatformTicketAssignmentRepository } from "@/store/ticket/platform-ticket-assignment.repository";
import { platformTicketAssignmentArn } from "@/iam/resources/platform-ticket-assignment-resources";
import { platformConfigurationArn } from "@/iam/resources/platform-configuration-resources";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { PermissionService } from "@/services/users/permission.service";
import { TicketService } from "@/services/ticket/ticket.service";
import * as conditions from "@/iam/request/condition-context";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, groupId: string;
const mode = env.security.iamAuthorizationMode,
  key = CONFIG_KEYS.NOTIFICATION.TICKET_ASSIGNMENT_RULES,
  service = PlatformTicketAssignmentIamService.getInstance(),
  repository = PlatformTicketAssignmentRepository.getInstance(),
  engine = IamAuthorizationService.getInstance();
const get = "quyan:ticket:GetAssignmentRules",
  write = "quyan:ticket:UpdateAssignmentRules";
const rules = () => ({ rules: [{ type: "bug" as const, assigneeUserIds: [actor] }] });
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*", "x-config-key": "fixture-other" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "ticket-config-" + randomUUID(),
        password: "fixture-only",
        permissionAdds: [],
        permissionRemoves: [],
        accountOwnerId,
      },
    })
  ).id;
async function bind(
  effect: "Allow" | "Deny",
  action: string,
  principalType = "user",
  principalId = actor,
  condition?: Record<string, Record<string, string>>,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: {
      Effect: effect,
      Action: action,
      Resource: platformTicketAssignmentArn(),
      ...(condition ? { Condition: condition } : {}),
    },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "ticket-config-" + randomUUID(),
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
  await prisma.serverConfig.deleteMany({ where: { key } });
  owner = await user();
  actor = await user(owner);
  const group = await prisma.group.create({
    data: {
      username: "ticket-config-" + randomUUID(),
      name: "fixture-global",
      level: 0,
      permissions: [Permission.TICKET_REVIEW_UPDATE],
      accountOwnerId: null,
    },
  });
  groupId = group.id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  await prisma.serverConfig.create({ data: { key, value: JSON.stringify(rules().rules) } });
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
});
describe("persisted assignment configuration scope", () => {
  it("uses the canonical configuration identity across API paths", async () => {
    expect(platformTicketAssignmentArn()).toBe(platformConfigurationArn(key));
    expect(await service.read(request())).toEqual(rules());
  });
  it("returns empty defaults without bootstrap on reads", async () => {
    await prisma.serverConfig.deleteMany({ where: { key } });
    expect(await service.read(request())).toEqual({ rules: [] });
    expect(await prisma.serverConfig.count({ where: { key } })).toBe(0);
  });
  it("creates missing rules only on an explicitly authorized write", async () => {
    await prisma.serverConfig.deleteMany({ where: { key } });
    expect(await service.update(rules(), request())).toEqual(rules());
    expect((await prisma.serverConfig.findUniqueOrThrow({ where: { key } })).value).toBe(JSON.stringify(rules().rules));
  });
  it("rejects a matching Deny before source hydration", async () => {
    await bind("Deny", get);
    const hydrate = vi.spyOn(repository, "hydrate");
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("does not let write grants replace read grants", async () => {
    await bind("Deny", get);
    expect(await service.update({ rules: [] }, request())).toEqual({ rules: [] });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not grant writes from read permission", async () => {
    await bind("Deny", write);
    await expect(service.update({ rules: [] }, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await service.read(request())).toEqual(rules());
  });
  it.each(["personal", "private", "disabled", "wrong"])(
    "requires persisted global qualification for %s",
    async (kind) => {
      if (kind === "personal")
        await prisma.user.update({
          where: { id: actor },
          data: { groupId: null, permissionAdds: [Permission.TICKET_REVIEW_UPDATE] },
        });
      if (kind === "private") await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      if (kind === "disabled") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      if (kind === "wrong")
        await prisma.group.update({ where: { id: groupId }, data: { permissions: [Permission.SYSTEM_CONFIG] } });
      await bind("Allow", get);
      await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("fails closed on malformed stored rules", async () => {
    await prisma.serverConfig.update({ where: { key }, data: { value: "{broken" } });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects source changes after credential-free hydration with preserved timestamps", async () => {
    const original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (principal, target) => {
      const value = await original(principal, target);
      await prisma.serverConfig.update({ where: { key }, data: { value: "[]", updateTime: target!.updateTime } });
      return value;
    });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects content changes between write preparation and locking", async () => {
    const original = repository.update.bind(repository);
    vi.spyOn(repository, "update").mockImplementation(async (value, target, guard) => {
      await prisma.serverConfig.update({
        where: { key },
        data: {
          value: JSON.stringify([{ priority: "urgent", assigneeUserIds: [owner] }]),
          updateTime: target!.updateTime,
        },
      });
      return original(value, target, guard);
    });
    await expect(service.update({ rules: [] }, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.serverConfig.findUniqueOrThrow({ where: { key } })).value).not.toBe("[]");
  });
  it("rejects authorization revision changes before writes", async () => {
    const original = repository.update.bind(repository);
    vi.spyOn(repository, "update").mockImplementation(async (value, target, guard) => {
      await bind("Deny", write);
      return original(value, target, guard);
    });
    await expect(service.update({ rules: [] }, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.serverConfig.findUniqueOrThrow({ where: { key } })).value).toBe(JSON.stringify(rules().rules));
  });
  it("rolls back if final permission changes after upsert", async () => {
    const original = engine.authorizeMany.bind(engine);
    let passes = 0;
    vi.spyOn(engine, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      if (input.action === write && ++passes === 5)
        return result.map((item) => ({ ...item, decision: "ExplicitDeny" }));
      return result;
    });
    await expect(service.update({ rules: [] }, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.serverConfig.findUniqueOrThrow({ where: { key } })).value).toBe(JSON.stringify(rules().rules));
  });
  it("rechecks real date conditions before returning rules", async () => {
    let now = new Date("2026-10-14T00:00:00Z");
    await bind("Deny", get, "user", actor, { DateGreaterThanEquals: { "acs:CurrentTime": "2026-10-14T00:00:01Z" } });
    vi.spyOn(conditions, "requestConditionContext").mockImplementation((_request, principal) => ({
      ...conditions.principalConditionContext(principal, now),
      "acs:SecureTransport": true,
    }));
    const original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (principal, target) => {
      const value = await original(principal, target);
      now = new Date("2026-10-14T00:00:02Z");
      return value;
    });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("enforces role grants without inheriting actor global-group Allow", async () => {
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "ticket-config-role-" + randomUUID() },
    });
    const session = await prisma.ramRoleSession.create({
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
    await expect(service.read(req)).rejects.toMatchObject({ statusCode: 403 });
    await bind("Allow", get, "role", role.id);
    expect(await service.read(req)).toEqual(rules());
    await expect(service.update({ rules: [] }, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("enforces resource scope for authenticated access keys", async () => {
    await bind("Deny", get);
    const req = request();
    req.authContext!.subjectType = "access_key";
    await expect(service.read(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("preserves old permission checks for %s", async (current) => {
    env.security.iamAuthorizationMode = current;
    vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({
      hasPermission: false,
      checkedPermissions: [Permission.TICKET_REVIEW_UPDATE],
      missingPermissions: [Permission.TICKET_REVIEW_UPDATE],
    });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.update({ rules: [] }, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shadow writes once through the legacy flow", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await bind("Deny", write);
    const observed = vi.spyOn(TicketService.getInstance(), "updateAssignmentConfig"),
      native = vi.spyOn(repository, "update");
    expect(await service.update({ rules: [] }, request())).toEqual({ rules: [] });
    expect(observed).toHaveBeenCalledOnce();
    expect(native).not.toHaveBeenCalled();
    expect((await prisma.serverConfig.findUniqueOrThrow({ where: { key } })).value).toBe("[]");
  });
});
