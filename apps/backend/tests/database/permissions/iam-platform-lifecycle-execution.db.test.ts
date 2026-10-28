import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { PlatformLifecycleExecutionIamService } from "@/services/system/platform-lifecycle-execution-iam.service";
import { DataLifecycleService } from "@/services/system/data-lifecycle.service";
import { DataLifecycleSchedulerService } from "@/services/system/data-lifecycle-scheduler.service";
import { ObservabilityRepository } from "@/store/system/observability.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { PermissionService } from "@/services/users/permission.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
const service = PlatformLifecycleExecutionIamService.getInstance(),
  bridge = DataLifecycleService.getInstance(),
  repo = service.repository;
const runAction = "quyan:system:data_lifecycle:RunPolicy",
  batchAction = "quyan:system:data_lifecycle:RunBatch";
let owner: string, actor: string, ids: string[], previousEnabled: boolean;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*" },
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
async function user(accountOwnerId?: string) {
  return (
    await prisma.user.create({
      data: {
        username: "execution-fixture-" + randomUUID(),
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
      username: "execution-fixture-" + randomUUID(),
      name: "fixture platform",
      level: 0,
      accountOwnerId: global ? null : owner,
      permissions: [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE],
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: g.id } });
  return g;
}
async function bind(effect: "Allow" | "Deny", action: string, resource = "*") {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: effect, Action: action, Resource: resource } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "execution-fixture-" + randomUUID(),
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
async function source() {
  const row = await prisma.aPILog.create({
    data: {
      requestID: "execution-fixture-" + randomUUID(),
      path: "/fixture",
      method: "GET",
      ipAddress: "127.0.0.1",
      statusCode: 200,
      createTime: new Date("2020-01-01"),
    },
  });
  ids.push(row.id);
  return row;
}
async function guard() {
  return (await service.prepare(runAction, ["api_logs"], request()))[0];
}
function artifact(runId: string, dataset: "api_logs" | "server_logs" = "api_logs") {
  return {
    lifecycleRunId: runId,
    dataset,
    objectKey: "execution-fixture/" + randomUUID(),
    sha256: "a".repeat(64),
    recordCount: 1,
    byteSize: 10n,
    expiresAt: null,
  };
}
function mockArchive(onHead?: () => Promise<void>, valid = true) {
  let sha = "",
    length = 0;
  const client = {
    put: vi.fn(async (_key: string, body: Buffer, options: any) => {
      sha = options.headers["x-oss-meta-sha256"];
      length = body.length;
    }),
    head: vi.fn(async () => {
      await onHead?.();
      return { res: { headers: { "x-oss-meta-sha256": valid ? sha : "mismatch", "content-length": String(length) } } };
    }),
  };
  vi.spyOn(bridge as any, "getOssClient").mockReturnValue(client);
  vi.spyOn(bridge as any, "countCandidates").mockResolvedValue(1);
  vi.spyOn(ObservabilityRepository.getInstance(), "listDatasetBatch").mockImplementation(async (_dataset, cutoffAt) =>
    prisma.aPILog.findMany({ where: { id: { in: ids }, createTime: { lt: cutoffAt } } }),
  );
  return client;
}
beforeEach(async () => {
  vi.restoreAllMocks();
  ids = [];
  env.security.iamAuthorizationMode = "enforce";
  previousEnabled = env.integrations.objectStorage.archive.enabled;
  env.integrations.objectStorage.archive.enabled = true;
  owner = await user();
  actor = await user(owner);
  await bridge.initialize();
  await prisma.dataLifecyclePolicy.updateMany({ data: { enabled: false } });
  await prisma.dataLifecyclePolicy.update({
    where: { dataset: "api_logs" },
    data: { status: 1, enabled: true, hotRetentionDays: 90, lastRunAt: null },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.integrations.objectStorage.archive.enabled = previousEnabled;
  env.security.iamAuthorizationMode = "enforce";
  await prisma.dataLifecycleRun.deleteMany({ where: { startedByUserId: actor } });
  await prisma.aPILog.deleteMany({ where: { id: { in: ids } } });
});
describe("platform lifecycle manual execution", () => {
  it("archives and deletes the exact exported source rows atomically and records completion without rewriting policy configuration", async () => {
    await group();
    const record = await source(),
      g = await guard();
    const run = await repo.start(g, new Date(), 1);
    const result = await repo.commitArchive(g, artifact(run.id), [record]);
    expect(result.deletedCount).toBe(1);
    expect(await prisma.aPILog.findUnique({ where: { id: record.id } })).toBeNull();
    const before = g.policy;
    await repo.complete(g, run.id);
    await g.recheck();
    expect(g.policy).toMatchObject({
      enabled: before.enabled,
      hotRetentionDays: before.hotRetentionDays,
      archiveRetentionDays: before.archiveRetentionDays,
    });
    expect(g.policy.lastRunAt).toBeInstanceOf(Date);
    expect(await prisma.dataLifecycleRun.findUnique({ where: { id: run.id } })).toMatchObject({
      runStatus: "completed",
      archivedCount: 1,
      deletedCount: 1,
    });
  });
  it.each(["source-change", "hot-row", "foreign-run", "duplicate-id"])(
    "rejects %s without any deletion or artifact",
    async (kind) => {
      await group();
      const row = await source(),
        g = await guard(),
        run = await repo.start(g, new Date(), 1);
      if (kind === "source-change") await prisma.aPILog.update({ where: { id: row.id }, data: { statusCode: 500 } });
      if (kind === "hot-row")
        await prisma.aPILog.update({ where: { id: row.id }, data: { createTime: new Date(Date.now() + 60000) } });
      await expect(
        repo.commitArchive(
          g,
          artifact(kind === "foreign-run" ? "unknown" : run.id),
          kind === "duplicate-id" ? [row, row] : [row],
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(await prisma.aPILog.findUnique({ where: { id: row.id } })).not.toBeNull();
      expect(await prisma.archiveArtifact.count({ where: { lifecycleRunId: run.id } })).toBe(0);
    },
  );
  it("rolls back artifact, source deletion and progress when final authorization fails", async () => {
    await group();
    const row = await source(),
      g = await guard(),
      run = await repo.start(g, new Date(), 1);
    const check = g.users.recheck;
    let calls = 0;
    g.users.recheck = async () => {
      if (++calls === 2) throw iamAccountDenied();
      await check();
    };
    await expect(repo.commitArchive(g, artifact(run.id), [row])).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.aPILog.findUnique({ where: { id: row.id } })).not.toBeNull();
    expect(await prisma.archiveArtifact.count({ where: { lifecycleRunId: run.id } })).toBe(0);
    expect(await prisma.dataLifecycleRun.findUnique({ where: { id: run.id } })).toMatchObject({
      archivedCount: 0,
      deletedCount: 0,
    });
  });
  it.each(["deny", "policy", "group", "user"])("rejects %s revocation before source deletion", async (kind) => {
    const platform = await group(),
      row = await source(),
      g = await guard(),
      run = await repo.start(g, new Date(), 1);
    if (kind === "deny") await bind("Deny", runAction);
    if (kind === "policy")
      await prisma.dataLifecyclePolicy.update({ where: { id: g.policy.id }, data: { hotRetentionDays: 99 } });
    if (kind === "group") await prisma.group.update({ where: { id: platform.id }, data: { permissions: [] } });
    if (kind === "user") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    await expect(repo.commitArchive(g, artifact(run.id), [row])).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.aPILog.findUnique({ where: { id: row.id } })).not.toBeNull();
    await repo.fail(g, run.id);
    expect(await prisma.dataLifecycleRun.findUnique({ where: { id: run.id } })).toMatchObject({
      runStatus: "failed",
      errorMessage: "Lifecycle archive interrupted",
    });
  });
  it.each(["owner", "adds", "private-group"])(
    "does not let %s or wildcard policies manufacture platform qualification",
    async (kind) => {
      if (kind === "owner") {
        const r = request();
        r.user!.userId = owner;
        r.authContext = { principalUserId: owner, accountOwnerId: owner } as any;
        await expect(service.prepare(runAction, ["api_logs"], r)).rejects.toMatchObject({ statusCode: 403 });
        return;
      }
      if (kind === "adds")
        await prisma.user.update({
          where: { id: actor },
          data: { permissionAdds: [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE] },
        });
      if (kind === "private-group") await group(false);
      await bind("Allow", "*");
      await expect(guard()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("completes native service execution with verified storage and true source snapshots", async () => {
    await group();
    const row = await source(),
      client = mockArchive();
    const result = await bridge.runPolicyRequest("api_logs", request());
    expect(result).toMatchObject({ candidateCount: 1, archivedCount: 1, deletedCount: 1 });
    expect(client.head).toHaveBeenCalledTimes(1);
    expect(await prisma.aPILog.findUnique({ where: { id: row.id } })).toBeNull();
  });
  it.each(["deny", "source-change", "checksum"])(
    "stops after OSS %s without deleting source or exposing storage details",
    async (kind) => {
      await group();
      const row = await source();
      mockArchive(async () => {
        if (kind === "deny") await bind("Deny", runAction);
        if (kind === "source-change") await prisma.aPILog.update({ where: { id: row.id }, data: { statusCode: 500 } });
      }, kind !== "checksum");
      await expect(bridge.runPolicyRequest("api_logs", request())).rejects.toThrow();
      expect(await prisma.aPILog.findUnique({ where: { id: row.id } })).not.toBeNull();
      const run = await prisma.dataLifecycleRun.findFirstOrThrow({ where: { startedByUserId: actor } });
      expect(run).toMatchObject({
        runStatus: "failed",
        errorMessage: "Lifecycle archive interrupted",
        deletedCount: 0,
      });
      expect(await prisma.archiveArtifact.count({ where: { lifecycleRunId: run.id } })).toBe(0);
    },
  );
  it("rejects batch denial on any selected dataset before counting or uploading", async () => {
    await group();
    await bind("Deny", batchAction, "acs:platform:*:platform:lifecycle-dataset/business_logs");
    const client = mockArchive();
    await expect(bridge.runPoliciesRequest(["api_logs", "business_logs"], request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(client.put).not.toHaveBeenCalled();
    expect((bridge as any).countCandidates).not.toHaveBeenCalled();
    expect(await prisma.dataLifecycleRun.count({ where: { startedByUserId: actor } })).toBe(0);
  });
  it("empty batch runs only the enabled selection and keeps RunBatch independent from RunPolicy", async () => {
    await group();
    await bind("Deny", runAction);
    await source();
    mockArchive();
    expect(await bridge.runPoliciesRequest([], request())).toMatchObject({
      completedCount: 1,
      failedCount: 0,
      items: [expect.objectContaining({ dataset: "api_logs", deletedCount: 1 })],
    });
  });
  it("does not swallow batch authorization failure or process subsequent datasets", async () => {
    await group();
    await source();
    const client = mockArchive(async () => {
      await bind("Deny", batchAction);
    });
    await expect(bridge.runPoliciesRequest(["api_logs", "business_logs"], request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(client.put).toHaveBeenCalledTimes(1);
    expect(await prisma.dataLifecycleRun.count({ where: { startedByUserId: actor } })).toBe(1);
  });
  it("manual scheduler propagates the denied request after releasing its lock", async () => {
    const scheduler = DataLifecycleSchedulerService.getInstance();
    const { DistributedLockService } = await import("@/services/infrastructure/distributed-lock.service");
    const locks = DistributedLockService.getInstance();
    vi.spyOn(locks, "acquire").mockResolvedValue({ acquired: true } as any);
    const release = vi.spyOn(locks, "release").mockResolvedValue(true);
    await expect(scheduler.runManualBatchRequest(["api_logs"], request())).rejects.toMatchObject({ statusCode: 403 });
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("keeps server files after revocation during upload verification", async () => {
    await group();
    const client = mockArchive(async () => {
      await bind("Deny", runAction);
    });
    vi.spyOn(bridge as any, "listServerLogCandidates").mockResolvedValue([
      { name: "combined-2020-01-01.log", path: "/fixture/log", date: new Date("2020-01-01") },
    ]);
    vi.spyOn(fs, "readFile").mockResolvedValue(Buffer.from("fixture\n"));
    const unlink = vi.spyOn(fs, "unlink").mockResolvedValue(undefined);
    await expect(bridge.runPolicyRequest("server_logs", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(client.put).toHaveBeenCalledOnce();
    expect(unlink).not.toHaveBeenCalled();
  });
  it("records native server-log archive and deletion without leaking storage failures", async () => {
    await group();
    mockArchive();
    vi.spyOn(bridge as any, "listServerLogCandidates").mockResolvedValue([
      { name: "combined-2020-01-01.log", path: "/fixture/log", date: new Date("2020-01-01") },
    ]);
    vi.spyOn(fs, "readFile").mockResolvedValue(Buffer.from("fixture"));
    const unlink = vi.spyOn(fs, "unlink").mockResolvedValue(undefined);
    const result = await bridge.runPolicyRequest("server_logs", request());
    expect(result).toMatchObject({ candidateCount: 1, archivedCount: 1, deletedCount: 1 });
    expect(unlink).toHaveBeenCalledOnce();
    expect(await prisma.dataLifecycleRun.findUnique({ where: { id: result!.runId } })).toMatchObject({
      runStatus: "completed",
      archivedCount: 1,
      deletedCount: 1,
    });
  });
  it("retains a server file changed during archiving and preserves its verified archive", async () => {
    await group();
    mockArchive();
    vi.spyOn(bridge as any, "listServerLogCandidates").mockResolvedValue([
      { name: "combined-2020-01-01.log", path: "/fixture/log", date: new Date("2020-01-01") },
    ]);
    vi.spyOn(fs, "readFile")
      .mockResolvedValueOnce(Buffer.from("original"))
      .mockResolvedValue(Buffer.from("new contents"));
    const unlink = vi.spyOn(fs, "unlink").mockResolvedValue(undefined);
    await expect(bridge.runPolicyRequest("server_logs", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(unlink).not.toHaveBeenCalled();
    const row = await prisma.dataLifecycleRun.findFirstOrThrow({ where: { startedByUserId: actor } });
    expect(row).toMatchObject({ runStatus: "failed", archivedCount: 1, deletedCount: 0 });
    expect(await prisma.archiveArtifact.count({ where: { lifecycleRunId: row.id } })).toBe(1);
  });
  it("suppresses raw storage errors in the response and failed run", async () => {
    await group();
    await source();
    const client = mockArchive();
    client.put.mockRejectedValue(new Error("fixture raw storage credential"));
    await expect(bridge.runPolicyRequest("api_logs", request())).rejects.toMatchObject({
      statusCode: 500,
      message: "Lifecycle archive interrupted",
    });
    expect(await prisma.dataLifecycleRun.findFirstOrThrow({ where: { startedByUserId: actor } })).toMatchObject({
      runStatus: "failed",
      errorMessage: "Lifecycle archive interrupted",
    });
  });
  it("preserves completed batch progress when later revocation stops subsequent datasets", async () => {
    await group();
    await source();
    const client = mockArchive();
    const complete = repo.complete.bind(repo);
    vi.spyOn(repo, "complete").mockImplementation(async (g, id) => {
      const policy = await complete(g, id);
      await bind("Deny", batchAction);
      return policy;
    });
    await expect(bridge.runPoliciesRequest(["api_logs", "business_logs"], request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(client.put).toHaveBeenCalledOnce();
    expect(await prisma.dataLifecycleRun.findMany({ where: { startedByUserId: actor } })).toMatchObject([
      { dataset: "api_logs", runStatus: "completed", archivedCount: 1, deletedCount: 1 },
    ]);
  });
  it("role execution requires role grants and rechecks session revocation", async () => {
    await group();
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "execution-fixture-" + randomUUID() },
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
    await expect(service.prepare(runAction, ["api_logs"], req)).rejects.toMatchObject({ statusCode: 403 });
    const binding = await bind("Allow", runAction, "acs:platform:*:platform:lifecycle-dataset/api_logs");
    await prisma.ramAuthorization.update({
      where: { id: binding.id },
      data: { principalType: "role", principalId: role.id },
    });
    const [g] = await service.prepare(runAction, ["api_logs"], req);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(g.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("keeps %s enforcement and exactly one legacy execution", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({ hasPermission: true } as any);
    const execute = vi
      .spyOn(bridge, "runPolicy")
      .mockResolvedValue({ runId: "fixture", candidateCount: 0, archivedCount: 0, deletedCount: 0 });
    expect(await bridge.runPolicyRequest("api_logs", request())).toMatchObject({ runId: "fixture" });
    expect(execute).toHaveBeenCalledOnce();
    expect(await prisma.dataLifecycleRun.count({ where: { startedByUserId: actor } })).toBe(0);
  });
});
