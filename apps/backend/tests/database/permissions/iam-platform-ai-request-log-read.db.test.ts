import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { PlatformAiRequestLogReadIamService } from "@/services/relay/platform-ai-request-log-read-iam.service";
import { AIRequestLogController } from "@/api/controllers/v1/relay/ai-request-log.controller";
import { AIRequestLogRepository } from "@/store/system/ai-request-log.repository";
import { platformAiRequestLogArn } from "@/iam/resources/platform-ai-request-log-resources";
import type { TypedRequest } from "@/types/express";
const service = PlatformAiRequestLogReadIamService.getInstance();
const metadata = "quyan:relay:ai_request_log:GetMetadata",
  diagnostics = "quyan:relay:ai_request_log:ReadDiagnostics";
let owner: string, actor: string, logId: string;
async function user(accountOwnerId?: string) {
  return (
    await prisma.user.create({
      data: {
        username: "ai-log-fixture-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
}
async function group(
  permissions = [Permission.RELAY_AI_REQUEST_LOG_READ, Permission.RELAY_REQUEST_DIAGNOSTICS_READ],
  global = true,
) {
  const row = await prisma.group.create({
    data: {
      username: "ai-log-fixture-" + randomUUID(),
      name: "fixture platform",
      level: 0,
      permissions,
      accountOwnerId: global ? null : owner,
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    params: { id: logId },
    headers: { "x-action": "*" },
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
async function bind(effect: "Allow" | "Deny", action: string, resource = "*") {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: effect, Action: action, Resource: resource } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "ai-log-fixture-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  return prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
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
  owner = await user();
  actor = await user(owner);
  logId = (
    await prisma.aIRequestLog.create({
      data: {
        requestId: randomUUID(),
        userId: owner,
        path: "/fixture",
        method: "POST",
        statusCode: 200,
        ipAddress: "127.0.0.1",
        requestBody: { prompt: "test prompt", api_key: "fixture-secret" },
        responseBody: { answer: "test answer", password: "fixture-secret" },
        attempts: [{ sequence: 1, stage: "upstream", success: false, errorText: "Bearer fixture-secret" }],
      },
    })
  ).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  await prisma.aIRequestLog.deleteMany({ where: { id: logId } });
});
describe("platform AI request log resource authorization", () => {
  it("authorizes each detail operation on the actual stored log", async () => {
    await group();
    const c = new AIRequestLogController(),
      r = request();
    expect(await c.metadata(r, logId)).toMatchObject({ id: logId, availableSides: ["request", "response"] });
    expect(await c.content(r, logId)).toHaveProperty("items");
    expect(await c.search(r, logId, "test", "request")).toMatchObject({ total: 1 });
    expect(await c.attempts(r, logId)).toMatchObject({ total: 1 });
    expect(await c.detail(r, logId)).toMatchObject({
      requestBody: { prompt: "test prompt", api_key: "***FILTERED***" },
      responseBody: { password: "***FILTERED***" },
    });
  });
  it("metadata denial is resource-specific and does not implicitly revoke content", async () => {
    await group();
    await bind("Deny", metadata, platformAiRequestLogArn(logId));
    const hydrate = vi.fn();
    await expect(service.read(metadata, logId, request(), hydrate)).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
    expect(await new AIRequestLogController().content(request(), logId)).toHaveProperty("items");
  });
  it.each(["adds", "private-group", "owner"])(
    "prevents %s and wildcard policies from manufacturing global log access",
    async (kind) => {
      if (kind === "adds")
        await prisma.user.update({
          where: { id: actor },
          data: { permissionAdds: [Permission.RELAY_AI_REQUEST_LOG_READ] },
        });
      if (kind === "private-group") await group([Permission.RELAY_AI_REQUEST_LOG_READ], false);
      const r = request();
      if (kind === "owner") {
        r.user!.userId = owner;
        r.authContext = { principalUserId: owner, accountOwnerId: owner } as any;
      }
      await bind("Allow", "*");
      const hydrate = vi.fn();
      await expect(service.read(metadata, logId, r, hydrate)).rejects.toMatchObject({ statusCode: 403 });
      expect(hydrate).not.toHaveBeenCalled();
    },
  );
  it("does not read denied request bodies or diagnostic attempts", async () => {
    await group();
    await bind("Deny", "quyan:relay:ai_request_log:GetContent");
    await bind("Deny", diagnostics);
    const payload = vi.spyOn(AIRequestLogRepository.getInstance(), "findPayload"),
      attempts = vi.spyOn(AIRequestLogRepository.getInstance(), "findAttempts");
    const c = new AIRequestLogController();
    await expect(c.content(request(), logId)).rejects.toMatchObject({ statusCode: 403 });
    await expect(c.attempts(request(), logId)).rejects.toMatchObject({ statusCode: 403 });
    await expect(c.search(request(), logId, "text", "attempts")).rejects.toMatchObject({ statusCode: 403 });
    expect(payload).not.toHaveBeenCalled();
    expect(attempts).not.toHaveBeenCalled();
  });
  it("read permission does not grant global diagnostics qualification", async () => {
    await group([Permission.RELAY_AI_REQUEST_LOG_READ]);
    await bind("Allow", diagnostics);
    await expect(new AIRequestLogController().attempts(request(), logId)).rejects.toMatchObject({ statusCode: 403 });
    expect(await new AIRequestLogController().metadata(request(), logId)).toHaveProperty("id", logId);
  });
  it.each(["deny", "group", "disabled-log", "changed-log", "disabled-user"])(
    "suppresses response after %s revocation during hydration",
    async (kind) => {
      const g = await group();
      const hydrate = vi.fn(async () => {
        if (kind === "deny") await bind("Deny", metadata);
        if (kind === "group") await prisma.group.update({ where: { id: g.id }, data: { permissions: [] } });
        if (kind === "disabled-log") await prisma.aIRequestLog.update({ where: { id: logId }, data: { status: 0 } });
        if (kind === "changed-log")
          await prisma.aIRequestLog.update({ where: { id: logId }, data: { errorSummary: "changed" } });
        if (kind === "disabled-user") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
        return "withheld";
      });
      await expect(service.read(metadata, logId, request(), hydrate)).rejects.toMatchObject({ statusCode: 403 });
      expect(hydrate).toHaveBeenCalledOnce();
    },
  );
  it("fails closed on absent/deleted targets before invoking hydration", async () => {
    await group();
    const hydrate = vi.fn();
    await expect(service.read(metadata, "missing", request(), hydrate)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.aIRequestLog.update({ where: { id: logId }, data: { status: -1 } });
    await expect(service.read(metadata, logId, request(), hydrate)).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("does not return secrets from historical detail, attempts or attempt searches", async () => {
    await group();
    const c = new AIRequestLogController(),
      r = request();
    for (const result of [
      await c.detail(r, logId),
      await c.attempts(r, logId),
      await c.search(r, logId, "fixture-secret", "attempts"),
    ])
      expect(JSON.stringify(result)).not.toContain("fixture-secret");
  });
  it("uses role grants without inheriting user-group Allow and detects revoked sessions", async () => {
    await group();
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "ai-log-fixture-" + randomUUID() },
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
    const r = request();
    Object.assign(r.authContext!, { assumedRoleId: role.id, roleSessionId: session.id });
    await expect(service.read(metadata, logId, r, async () => "safe")).rejects.toMatchObject({ statusCode: 403 });
    const binding = await bind("Allow", metadata, platformAiRequestLogArn(logId));
    await prisma.ramAuthorization.update({
      where: { id: binding.id },
      data: { principalType: "role", principalId: role.id },
    });
    await expect(
      service.read(metadata, logId, r, async () => {
        await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        return "withheld";
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
