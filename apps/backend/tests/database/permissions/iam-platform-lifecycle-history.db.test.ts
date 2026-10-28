import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { PlatformLifecycleHistoryIamService } from "@/services/system/platform-lifecycle-history-iam.service";
import { PlatformLifecycleHistoryRepository } from "@/store/system/platform-lifecycle-history.repository";
import { DataLifecycleService } from "@/services/system/data-lifecycle.service";
import { ObservabilityRepository } from "@/store/system/observability.repository";

import { PermissionService } from "@/services/users/permission.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformLifecycleRunArn, platformLifecycleArtifactArn } from "@/iam/resources/platform-lifecycle-resources";
import type { TypedRequest } from "@/types/express";
const service = PlatformLifecycleHistoryIamService.getInstance(),
  bridge = DataLifecycleService.getInstance();
const list = "quyan:system:data_lifecycle:ListRuns" as const,
  listArtifacts = "quyan:system:data_lifecycle:ListArtifacts" as const;
let owner: string, actor: string;
async function user(accountOwnerId?: string) {
  return (
    await prisma.user.create({
      data: {
        username: "lifecycle-iam-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
}
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*" },
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
beforeEach(async () => {
  vi.restoreAllMocks();
  await prisma.dataLifecycleRun.deleteMany({ where: { id: { startsWith: "history-fixture-" } } });
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.dataLifecycleRun.deleteMany({ where: { id: { startsWith: "history-fixture-" } } });
  env.security.iamAuthorizationMode = "enforce";
});
async function group(permissions = [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE]) {
  const g = await prisma.group.create({
    data: {
      username: "lifecycle-" + randomUUID(),
      name: "fixture platform",
      level: 0,
      permissions,
      accountOwnerId: null,
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: g.id } });
  return g;
}
async function bind(document: unknown) {
  const parsed = parseIamPolicy(document),
    policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "lifecycle-" + randomUUID(),
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
async function deny(action: string, resource = "*") {
  return bind({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: resource } });
}

async function run(status = 1) {
  return prisma.dataLifecycleRun.create({
    data: {
      id: "history-fixture-" + randomUUID(),
      status,
      dataset: "api_logs",
      runType: "manual",
      cutoffAt: new Date(),
      runStatus: "completed",
      candidateCount: 2,
      archivedCount: 2,
    },
  });
}
async function artifact(runId: string, status = 1, dataset = "api_logs") {
  return prisma.archiveArtifact.create({
    data: {
      status,
      dataset,
      lifecycleRunId: runId,
      objectKey: "fixture-history/" + randomUUID() + ".ndjson.gz",
      sha256: "a".repeat(64),
      recordCount: 1,
      byteSize: 5n,
    },
  });
}
describe("lifecycle history and archive listing database", () => {
  it("filters runs before pagination and total, preserving stable page ordering", async () => {
    await group();
    const a = await run(),
      hidden = await run(),
      c = await run();
    await deny(list, platformLifecycleRunArn(hidden.id));
    const expected = [a, c].sort((x, y) => y.createTime.getTime() - x.createTime.getTime() || y.id.localeCompare(x.id));
    const result = await service.listRuns(1, 1, request());
    expect(result.total).toBe(2);
    expect(result.items.map((r) => r.id)).toEqual([expected[0].id]);
    expect((await service.listRuns(2, 1, request())).items.map((r) => r.id)).toEqual([expected[1].id]);
  });
  it("counts only authorized child files and filters artifact totals before slicing", async () => {
    await group();
    const parent = await run(),
      visible = await artifact(parent.id),
      hidden = await artifact(parent.id);
    await deny(listArtifacts, platformLifecycleArtifactArn(parent.id, hidden.id));
    const result = await service.listRuns(1, 20, request());
    expect(result.items[0]._count.artifacts).toBe(1);
    const files = await service.listArtifacts(parent.id, 1, 1, request());
    expect(files.total).toBe(1);
    expect(files.items[0]).toMatchObject({
      id: visible.id,
      objectKey: visible.objectKey,
      sha256: visible.sha256,
      byteSize: 5n,
    });
    expect((await service.listArtifacts(parent.id, 2, 1, request())).items).toEqual([]);
  });
  it("never scans denied parent children and does not reveal file counts", async () => {
    await group();
    const parent = await run();
    await artifact(parent.id);
    await deny(listArtifacts, platformLifecycleRunArn(parent.id));
    const scan = vi.spyOn(PlatformLifecycleHistoryRepository.getInstance(), "scanArtifacts");
    expect((await service.listRuns(1, 20, request())).items[0]._count.artifacts).toBe(0);
    await expect(service.listArtifacts(parent.id, 1, 20, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(scan).not.toHaveBeenCalled();
  });
  it("does not make archive visibility depend on the independent run list action", async () => {
    await group();
    const parent = await run();
    await artifact(parent.id);
    await deny(list);
    expect(await service.listRuns(1, 20, request())).toEqual({ items: [], total: 0 });
    expect((await service.listArtifacts(parent.id, 1, 20, request())).total).toBe(1);
  });
  it("omits inactive runs, files and inconsistent dataset ancestry", async () => {
    await group();
    const parent = await run(),
      inactive = await run(0);
    await artifact(parent.id, 0);
    await artifact(parent.id, 1, "business_logs");
    expect((await service.listRuns(1, 20, request())).total).toBe(1);
    expect(await service.listArtifacts(parent.id, 1, 20, request())).toEqual({ items: [], total: 0 });
    await expect(service.listArtifacts(inactive.id, 1, 20, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("preserves authorized deleted-file history without granting download access", async () => {
    await group();
    const parent = await run(),
      file = await artifact(parent.id);
    const deletedAt = new Date();
    await prisma.archiveArtifact.update({ where: { id: file.id }, data: { deletedAt } });
    expect((await service.listArtifacts(parent.id, 1, 20, request())).items[0].deletedAt).toEqual(deletedAt);
  });
  it("requires global platform qualification even with broad policies or account ownership", async () => {
    const parent = await run();
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE] },
    });
    await expect(service.listRuns(1, 20, request())).rejects.toMatchObject({ statusCode: 403 });
    const root = request();
    root.user!.userId = owner;
    root.authContext!.principalUserId = owner;
    await expect(service.listArtifacts(parent.id, 1, 20, root)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects private groups and a group version changed during hydration", async () => {
    const g = await group();
    await run();
    await prisma.group.update({ where: { id: g.id }, data: { accountOwnerId: owner } });
    await expect(service.listRuns(1, 20, request())).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({ where: { id: g.id }, data: { accountOwnerId: null } });
    const repo = PlatformLifecycleHistoryRepository.getInstance(),
      original = repo.hydrateRuns.bind(repo);
    vi.spyOn(repo, "hydrateRuns").mockImplementation(async (...args) => {
      const rows = await original(...args);
      await prisma.group.update({ where: { id: g.id }, data: { permissions: [] } });
      return rows;
    });
    await expect(service.listRuns(1, 20, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks resources contributing to total even outside the page", async () => {
    await group();
    const a = await run(),
      b = await run();
    const sorted = [a, b].sort((x, y) => y.createTime.getTime() - x.createTime.getTime() || y.id.localeCompare(x.id));
    const repo = PlatformLifecycleHistoryRepository.getInstance(),
      original = repo.hydrateRuns.bind(repo);
    vi.spyOn(repo, "hydrateRuns").mockImplementation(async (...args) => {
      const rows = await original(...args);
      await deny(list, platformLifecycleRunArn(sorted[1].id));
      return rows;
    });
    await expect(service.listRuns(1, 1, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects final file denial and file version changes after object metadata reads", async () => {
    await group();
    const parent = await run(),
      file = await artifact(parent.id);
    const repo = PlatformLifecycleHistoryRepository.getInstance(),
      original = repo.hydrateArtifacts.bind(repo);
    vi.spyOn(repo, "hydrateArtifacts").mockImplementation(async (...args) => {
      const rows = await original(...args);
      await prisma.archiveArtifact.update({ where: { id: file.id }, data: { recordCount: 9 } });
      return rows;
    });
    await expect(service.listArtifacts(parent.id, 1, 20, request())).rejects.toMatchObject({ statusCode: 403 });
    vi.restoreAllMocks();
    vi.spyOn(repo, "hydrateArtifacts").mockImplementation(async (...args) => {
      const rows = await original(...args);
      await deny(listArtifacts, platformLifecycleArtifactArn(parent.id, file.id));
      return rows;
    });
    await expect(service.listArtifacts(parent.id, 1, 20, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks child visibility used by archiveCount after reading metadata", async () => {
    await group();
    const parent = await run(),
      file = await artifact(parent.id);
    const repo = PlatformLifecycleHistoryRepository.getInstance(),
      original = repo.checkRuns.bind(repo);
    let checks = 0;
    vi.spyOn(repo, "checkRuns").mockImplementation(async (...args) => {
      const rows = await original(...args);
      if (++checks === 2) await deny(listArtifacts, platformLifecycleArtifactArn(parent.id, file.id));
      return rows;
    });
    await expect(service.listRuns(1, 20, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires role grants instead of inheriting the user's group grants", async () => {
    await group();
    const parent = await run();
    await artifact(parent.id);
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "lifecycle-history-role-" + randomUUID() },
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
    expect(await service.listRuns(1, 20, req)).toEqual({ items: [], total: 0 });
    const b = await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: list, Resource: platformLifecycleRunArn(parent.id) },
    });
    await prisma.ramAuthorization.update({
      where: { id: b.id },
      data: { principalType: "role", principalId: role.id },
    });
    const result = await service.listRuns(1, 20, req);
    expect(result.total).toBe(1);
    expect(result.items[0]._count.artifacts).toBe(0);
    await expect(service.listArtifacts(parent.id, 1, 20, req)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.listRuns(1, 20, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("handles collections larger than a decision batch without leaking raw totals", async () => {
    await group();
    await prisma.dataLifecycleRun.createMany({
      data: Array.from({ length: 501 }, () => ({
        id: "history-fixture-" + randomUUID(),
        dataset: "api_logs",
        runType: "manual",
        cutoffAt: new Date(),
        runStatus: "completed",
      })),
    });
    const result = await service.listRuns(1, 1, request());
    expect(result.total).toBe(501);
    expect(result.items).toHaveLength(1);
  });
  it("rejects missing or forged identity, OAuth and malformed pagination", async () => {
    await group();
    await expect(service.listRuns(1, 20)).rejects.toMatchObject({ statusCode: 403 });
    const forged = request();
    forged.authContext!.accountOwnerId = await user();
    await expect(service.listRuns(1, 20, forged)).rejects.toMatchObject({ statusCode: 403 });
    const oauth = request();
    oauth.oauthAccessToken = { id: "fixture" } as any;
    await expect(service.listRuns(1, 20, oauth)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.listRuns(0, 20, request())).rejects.toMatchObject({ statusCode: 400 });
  });
  it.each(["legacy", "shadow"] as const)(
    "keeps %s reads without native display hydration or duplicate legacy work",
    async (mode) => {
      await group();
      const parent = await run();
      env.security.iamAuthorizationMode = mode;
      vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({
        hasPermission: true,
        missingPermissions: [],
        checkedPermissions: [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE],
      });
      const legacyRuns = vi
        .spyOn(ObservabilityRepository.getInstance(), "listLifecycleRuns")
        .mockResolvedValue({ items: [], total: 17 });
      const legacyArtifacts = vi
        .spyOn(ObservabilityRepository.getInstance(), "listArchiveArtifacts")
        .mockResolvedValue({ items: [], total: 19 });
      const native = vi.spyOn(PlatformLifecycleHistoryRepository.getInstance(), "hydrateArtifacts");
      expect(await bridge.listRunsRequest(1, 20, request())).toEqual({ items: [], total: 17 });
      expect(await bridge.listArtifactsRequest(parent.id, 1, 20, request())).toEqual({ items: [], total: 19 });
      expect(legacyRuns).toHaveBeenCalledTimes(1);
      expect(legacyArtifacts).toHaveBeenCalledTimes(1);
      expect(native).not.toHaveBeenCalled();
    },
  );
});
