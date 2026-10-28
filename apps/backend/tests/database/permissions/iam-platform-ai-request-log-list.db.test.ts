import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { PlatformAiRequestLogListIamService } from "@/services/relay/platform-ai-request-log-list-iam.service";
import { AIRequestLogController } from "@/api/controllers/v1/relay/ai-request-log.controller";
import { AIRequestLogRepository } from "@/store/system/ai-request-log.repository";
import { AIRequestLogService } from "@/services/relay/ai-request-log.service";
import { PermissionService } from "@/services/users/permission.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformAiRequestLogArn } from "@/iam/resources/platform-ai-request-log-resources";
import type { AIRequestLogQuery } from "@/store/system/ai-request-log.store";
import type { TypedRequest } from "@/types/express";
const service = PlatformAiRequestLogListIamService.getInstance(),
  repo = AIRequestLogRepository.getInstance();
const action = "quyan:relay:ai_request_log:ListLogs";
let owner: string, actor: string, prefix: string;
async function user(accountOwnerId?: string) {
  return (
    await prisma.user.create({
      data: {
        username: "ai-list-fixture-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
}
async function group(global = true) {
  const g = await prisma.group.create({
    data: {
      username: "ai-list-fixture-" + randomUUID(),
      name: "fixture platform",
      level: 0,
      permissions: [Permission.RELAY_AI_REQUEST_LOG_READ],
      accountOwnerId: global ? null : owner,
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: g.id } });
  return g;
}
async function create(index = 0, extra: Record<string, unknown> = {}) {
  return prisma.aIRequestLog.create({
    data: {
      requestId: prefix + index,
      path: "/fixture",
      method: "POST",
      ipAddress: "127.0.0.1",
      statusCode: 200,
      createTime: new Date(Date.UTC(2020, 0, 1) - index * 1000),
      requestBody: { input: "中文目标\n下一行", temperature: 0.7 },
      responseBody: { output: "response text" },
      ...extra,
    },
  });
}
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*" },
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const query = (extra: Partial<AIRequestLogQuery> = {}): AIRequestLogQuery => ({
  page: 1,
  pageSize: 2,
  requestId: prefix,
  ...extra,
});
async function bind(effect: "Allow" | "Deny", selectedAction: string, resource = "*") {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: selectedAction, Resource: resource },
  });
  const p = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "ai-list-fixture-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  return prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: p.id,
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
  prefix = "ai-list-" + randomUUID().slice(0, 8) + "-";
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  await prisma.aIRequestLog.deleteMany({ where: { requestId: { startsWith: prefix } } });
});
describe("AI log collection resource authorization and SQL predicates", () => {
  it("filters denied records before pagination and total and returns no bodies or attempts", async () => {
    await group();
    const first = await create(0),
      denied = await create(1),
      last = await create(2);
    await bind("Deny", action, platformAiRequestLogArn(denied.id));
    const result = await service.list(query({ page: 2, pageSize: 1 }), request());
    expect(result.total).toBe(2);
    expect(result.items.map((r) => r.id)).toEqual([last.id]);
    const page = await service.list(query({ page: 1, pageSize: 1 }), request());
    expect(page.items[0]?.id).toBe(first.id);
    for (const item of result.items)
      for (const field of ["requestBody", "responseBody", "attempts", "updateTime"])
        expect(item).not.toHaveProperty(field);
  });
  it("preserves decoded Chinese/newlines, JSON keys, numeric values and literal wildcard escaping", async () => {
    await group();
    await create(0, {
      requestBody: { messages: [{ text: "中文目标\n下一行 literal 100%_ = '中文'" }], temperature: 0.7 },
    });
    for (const keyword of ["中文目标\n下一行", "temperature", "0.7", "100%_", "= '中文'"])
      expect((await service.list(query({ keyword }), request())).total).toBe(1);
    expect((await service.list(query({ keyword: "' OR 1=1 --" }), request())).total).toBe(0);
  });
  it("combines all advanced filters identically with and without a keyword", async () => {
    await group();
    await create(0, {
      userId: "fixture-user",
      username: "fixture-user",
      relayTokenId: "fixture-token",
      relayTokenName: "fixture-token",
      model: "fixture-model",
      requestFormat: "openai-chat-completions",
      outcome: "failed",
      isStreaming: false,
      failureStage: "upstream",
      durationMs: 230,
      requestTruncated: false,
      responseTruncated: false,
      bodyOmissionReason: "not-recorded",
    });
    const filters = query({
      user: "fixture-user",
      relayToken: "fixture-token",
      model: "fixture-model",
      requestFormat: "openai-chat-completions",
      outcome: "failed",
      isStreaming: false,
      failureStage: "upstream",
      statusCode: 200,
      ipAddress: "127.0.0.1",
      minDurationMs: 200,
      maxDurationMs: 300,
      startDate: new Date("2019-12-31"),
      endDate: new Date("2020-01-02"),
      truncated: false,
      bodyOmissionReason: "not-recorded",
    });
    for (const keyword of [undefined, "fixture-model"]) {
      expect((await service.list({ ...filters, keyword }, request())).total).toBe(1);
      expect((await service.list({ ...filters, keyword, outcome: "success" }, request())).total).toBe(0);
    }
  });
  it("reads only collection identity fields during keyword scans and preserves SSE matching", async () => {
    await group();
    const row = await create(0, { responseBody: 'data: {"delta":{"text":"流式答案"}}\n\n' });
    const targets = await repo.scan(query({ keyword: "流式答案" }));
    expect(targets).toHaveLength(1);
    expect(Object.keys(targets[0]).sort()).toEqual(["createTime", "id", "status", "updateTime"]);
    expect((await service.list(query({ keyword: "流式答案" }), request())).items[0]?.id).toBe(row.id);
  });
  it.each([undefined, "中文目标"])("handles timestamp ties across SQL/ORM batches with keyword=%s", async (keyword) => {
    await group();
    const ids: string[] = [];
    for (let index = 0; index < 5; index++) ids.push((await create(index, { createTime: new Date("2020-01-01") })).id);
    const selected = query({ keyword }),
      first = (await repo.scan(selected)).slice(0, 2),
      tail = await repo.scan(selected, first[1], first[0]);
    expect(tail).toHaveLength(3);
    expect(new Set([...first, ...tail].map((r) => r.id)).size).toBe(5);
    const one = await service.list(query({ keyword, pageSize: 3 }), request()),
      two = await service.list(query({ keyword, page: 2, pageSize: 3 }), request());
    expect(one.total).toBe(5);
    expect(new Set([...one.items, ...two.items].map((r) => r.id)).size).toBe(5);
  });
  it.each(["private-group", "adds", "owner"])(
    "does not let %s or wildcard policies manufacture platform qualification",
    async (kind) => {
      if (kind === "private-group") await group(false);
      if (kind === "adds")
        await prisma.user.update({
          where: { id: actor },
          data: { permissionAdds: [Permission.RELAY_AI_REQUEST_LOG_READ] },
        });
      const r = request();
      if (kind === "owner") {
        r.user!.userId = owner;
        r.authContext = { principalUserId: owner, accountOwnerId: owner } as any;
      }
      await bind("Allow", "*");
      const scan = vi.spyOn(repo, "scan");
      await expect(service.list(query(), r)).rejects.toMatchObject({ statusCode: 403 });
      expect(scan).not.toHaveBeenCalled();
    },
  );
  it("returns an empty authorized collection without hydrating displays or granting details", async () => {
    await group();
    const row = await create();
    await bind("Deny", action);
    const hydrate = vi.spyOn(repo, "hydrate");
    expect(await service.list(query(), request())).toEqual({ items: [], total: 0 });
    expect(hydrate).not.toHaveBeenCalled();
    expect(await new AIRequestLogController().metadata(request(), row.id)).toHaveProperty("id", row.id);
  });
  it.each(["deny-off-page", "version-off-page", "deleted-off-page", "group", "user"])(
    "suppresses response and stale totals after %s during hydration",
    async (kind) => {
      const g = await group();
      await create(0);
      await create(1);
      const off = await create(2);
      const hydrate = repo.hydrate.bind(repo);
      vi.spyOn(repo, "hydrate").mockImplementation(async (targets) => {
        const result = await hydrate(targets);
        if (kind === "deny-off-page") await bind("Deny", action, platformAiRequestLogArn(off.id));
        if (kind === "version-off-page")
          await prisma.aIRequestLog.update({ where: { id: off.id }, data: { errorSummary: "changed" } });
        if (kind === "deleted-off-page")
          await prisma.aIRequestLog.update({ where: { id: off.id }, data: { status: -1 } });
        if (kind === "group") await prisma.group.update({ where: { id: g.id }, data: { permissions: [] } });
        if (kind === "user") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
        return result;
      });
      await expect(service.list(query({ pageSize: 1 }), request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("keeps newer records for the next query and fails on backdated inserts into the selected snapshot", async () => {
    await group();
    await create(0);
    const hydrate = repo.hydrate.bind(repo);
    let insert = 1;
    vi.spyOn(repo, "hydrate").mockImplementation(async (targets) => {
      const result = await hydrate(targets);
      await create(insert++, { createTime: new Date("2025-01-01") });
      return result;
    });
    expect((await service.list(query(), request())).total).toBe(1);
    vi.restoreAllMocks();
    const original = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (targets) => {
      const result = await original(targets);
      await create(9, { createTime: new Date("2019-01-01") });
      return result;
    });
    await expect(service.list(query(), request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses role ListLogs independently and stops on role-session revocation", async () => {
    await group();
    const row = await create();
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "ai-list-fixture-" + randomUUID() },
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
    expect(await service.list(query(), r)).toEqual({ items: [], total: 0 });
    const binding = await bind("Allow", action, platformAiRequestLogArn(row.id));
    await prisma.ramAuthorization.update({
      where: { id: binding.id },
      data: { principalType: "role", principalId: role.id },
    });
    expect((await service.list(query(), r)).total).toBe(1);
    await expect(new AIRequestLogController().metadata(r, row.id)).rejects.toMatchObject({ statusCode: 403 });
    const hydrate = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (targets) => {
      const result = await hydrate(targets);
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return result;
    });
    await expect(service.list(query(), r)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)(
    "keeps %s enforcement and one legacy query without native display hydration",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({
        hasPermission: true,
      } as any);
      await group();
      await create();
      await bind("Deny", action);
      const hydrate = vi.spyOn(repo, "hydrate"),
        legacy = vi.spyOn(AIRequestLogService.getInstance(), "query");
      expect((await service.list(query(), request())).total).toBe(1);
      expect(legacy).toHaveBeenCalledOnce();
      expect(hydrate).not.toHaveBeenCalled();
    },
  );
});
