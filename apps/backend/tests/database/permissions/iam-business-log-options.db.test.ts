import BusinessLogService from "@/services/system/businesslog.service";
import { BusinessLogController } from "@/api/controllers/v1/system/businesslog.controller";
import { ALL_OPERATION_TYPES, ALL_OPERATION_CATEGORIES } from "@/constant/operation-type";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { PlatformManagementReadIamService } from "@/services/system/platform-management-read-iam.service";
import { platformSystemArn } from "@/iam/resources/platform-system-resources";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string;
const service = PlatformManagementReadIamService.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "platform-read-" + randomUUID(),
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
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
  vi.restoreAllMocks();
});
async function group(permissions: Permission[] = [Permission.SYSTEM_STATS_READ]) {
  const row = await prisma.group.create({
    data: { username: "platform-read-" + randomUUID(), name: "fixture", level: 0, permissions, accountOwnerId: null },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function bind(document: unknown, principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy(document);
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "platform-read-" + randomUUID(),
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
const action = "quyan:system:business_log:GetFilterOptions",
  resource = platformSystemArn("business-log-options");
describe("business log option catalog platform authorization", () => {
  it("preserves the static catalog through the fixed server endpoint", async () => {
    await group([Permission.SYSTEM_BUSINESS_LOG_READ]);
    const req = request();
    req.headers["x-action"] = "quyan:system:GetStatistics";
    const result = await new BusinessLogController().getBusinessLogFilterOptions(req);
    expect(result).toEqual({ operationTypes: ALL_OPERATION_TYPES, operationCategories: ALL_OPERATION_CATEGORIES });
    expect(req.iamDecisions!.every((decision) => decision.action === action)).toBe(true);
  });
  it("does not use a statistics qualifier as business log eligibility", async () => {
    await group([Permission.SYSTEM_STATS_READ]);
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: action, Resource: "*" } });
    await expect(BusinessLogService.getInstance().getAuthorizedFilterOptions(request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("cannot manufacture eligibility using private groups or user additions", async () => {
    const row = await group([Permission.SYSTEM_BUSINESS_LOG_READ]);
    await prisma.group.update({ where: { id: row.id }, data: { accountOwnerId: owner } });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.SYSTEM_BUSINESS_LOG_READ] } });
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: action, Resource: "*" } });
    await expect(BusinessLogService.getInstance().getAuthorizedFilterOptions(request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("honors matching Deny", async () => {
    await group([Permission.SYSTEM_BUSINESS_LOG_READ]);
    await bind({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: resource } });
    await expect(BusinessLogService.getInstance().getAuthorizedFilterOptions(request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("discards the already-read catalog after qualification changes", async () => {
    const row = await group([Permission.SYSTEM_BUSINESS_LOG_READ]),
      original = BusinessLogService.getInstance().getFilterOptions.bind(BusinessLogService.getInstance());
    const read = vi.fn(async () => {
      const result = original();
      await prisma.group.update({ where: { id: row.id }, data: { permissions: [] } });
      return result;
    });
    await expect(service.read(action, resource, request(), read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("supports AccessKey and rejects OAuth service bypass", async () => {
    await group([Permission.SYSTEM_BUSINESS_LOG_READ]);
    const req = request();
    req.authContext!.subjectType = "access_key";
    expect((await BusinessLogService.getInstance().getAuthorizedFilterOptions(req)).operationTypes).toEqual(
      ALL_OPERATION_TYPES,
    );
    req.oauthAccessToken = {} as never;
    await expect(BusinessLogService.getInstance().getAuthorizedFilterOptions(req)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each(["legacy", "shadow"] as const)(
    "retains one static read using the previous effective permission in %s",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      await prisma.user.update({
        where: { id: actor },
        data: { permissionAdds: [Permission.SYSTEM_BUSINESS_LOG_READ] },
      });
      const read = vi.spyOn(BusinessLogService.getInstance(), "getFilterOptions");
      expect((await BusinessLogService.getInstance().getAuthorizedFilterOptions(request())).operationTypes).toEqual(
        ALL_OPERATION_TYPES,
      );
      expect(read).toHaveBeenCalledTimes(1);
    },
  );
});
