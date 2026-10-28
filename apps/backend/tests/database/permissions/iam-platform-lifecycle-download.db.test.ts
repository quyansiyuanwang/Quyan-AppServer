import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { PlatformLifecycleHistoryRepository } from "@/store/system/platform-lifecycle-history.repository";
import { DataLifecycleService } from "@/services/system/data-lifecycle.service";

import { PermissionService } from "@/services/users/permission.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformLifecycleArtifactArn } from "@/iam/resources/platform-lifecycle-resources";
import type { TypedRequest } from "@/types/express";
const bridge = DataLifecycleService.getInstance();
const download = "quyan:system:data_lifecycle:DownloadArtifact" as const;
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
const originalArchiveEnabled = env.integrations.objectStorage.archive.enabled;
let storage: any;
beforeEach(async () => {
  vi.restoreAllMocks();
  await prisma.dataLifecycleRun.deleteMany({ where: { id: { startsWith: "history-fixture-" } } });
  env.security.iamAuthorizationMode = "enforce";
  env.integrations.objectStorage.archive.enabled = true;
  storage = {
    head: vi.fn().mockResolvedValue({ res: { headers: { "x-oss-storage-class": "Standard" } } }),
    restore: vi.fn().mockResolvedValue(undefined),
    signatureUrl: vi.fn().mockReturnValue("fixture-signed-link"),
  };
  vi.spyOn(bridge as any, "getOssClient").mockReturnValue(storage);
  owner = await user();
  actor = await user(owner);
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.integrations.objectStorage.archive.enabled = originalArchiveEnabled;
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

describe("archive download signing and restore database", () => {
  it("grants an authorized active artifact without using client object keys", async () => {
    await group();
    const parent = await run(),
      file = await artifact(parent.id);
    const result = await bridge.getArchiveDownloadRequest(file.id, request());
    expect(result).toEqual({
      url: "fixture-signed-link",
      expiresInSeconds: 300,
      restoreRequired: false,
      restoreStatus: "ready",
    });
    expect(storage.head).toHaveBeenCalledWith(file.objectKey);
    expect(storage.signatureUrl).toHaveBeenCalledWith(file.objectKey, { expires: 300, method: "GET" });
    expect(storage.restore).not.toHaveBeenCalled();
  });
  it("requires independent download permission before all object-storage effects", async () => {
    await group();
    const parent = await run(),
      file = await artifact(parent.id);
    await deny(download, platformLifecycleArtifactArn(parent.id, file.id));
    await expect(bridge.getArchiveDownloadRequest(file.id, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(storage.head).not.toHaveBeenCalled();
    expect(storage.restore).not.toHaveBeenCalled();
    expect(storage.signatureUrl).not.toHaveBeenCalled();
  });
  it("does not require list permission to exercise a valid direct download grant", async () => {
    await group();
    const parent = await run(),
      file = await artifact(parent.id);
    await deny("quyan:system:data_lifecycle:ListArtifacts");
    await deny("quyan:system:data_lifecycle:ListRuns");
    expect((await bridge.getArchiveDownloadRequest(file.id, request())).restoreStatus).toBe("ready");
  });
  it("rejects inactive, deleted, expired and orphaned/inconsistent files before OSS", async () => {
    await group();
    const parent = await run(),
      file = await artifact(parent.id);
    for (const data of [
      { status: 0 },
      { status: 1, deletedAt: new Date() },
      { deletedAt: null, expiresAt: new Date(0) },
      { expiresAt: null, dataset: "business_logs" },
    ]) {
      await prisma.archiveArtifact.update({ where: { id: file.id }, data });
      await expect(bridge.getArchiveDownloadRequest(file.id, request())).rejects.toMatchObject({ statusCode: 403 });
    }
    await prisma.archiveArtifact.update({ where: { id: file.id }, data: { dataset: "api_logs" } });
    await prisma.dataLifecycleRun.update({ where: { id: parent.id }, data: { status: 0 } });
    await expect(bridge.getArchiveDownloadRequest(file.id, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(storage.head).not.toHaveBeenCalled();
  });
  it("keeps global eligibility separate from broad policies and account ownership", async () => {
    const parent = await run(),
      file = await artifact(parent.id);
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE] },
    });
    await expect(bridge.getArchiveDownloadRequest(file.id, request())).rejects.toMatchObject({ statusCode: 403 });
    const root = request();
    root.user!.userId = owner;
    root.authContext!.principalUserId = owner;
    await expect(bridge.getArchiveDownloadRequest(file.id, root)).rejects.toMatchObject({ statusCode: 403 });
    expect(storage.head).not.toHaveBeenCalled();
  });
  it("rejects a group revocation during head before restoring or signing", async () => {
    const g = await group();
    const parent = await run(),
      file = await artifact(parent.id);
    storage.head.mockImplementation(async () => {
      await prisma.group.update({ where: { id: g.id }, data: { permissions: [] } });
      return { res: { headers: { "x-oss-storage-class": "Archive" } } };
    });
    await expect(bridge.getArchiveDownloadRequest(file.id, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(storage.restore).not.toHaveBeenCalled();
    expect(storage.signatureUrl).not.toHaveBeenCalled();
  });
  it("rejects newly attached Deny and artifact key changes during head", async () => {
    await group();
    const parent = await run(),
      file = await artifact(parent.id);
    storage.head.mockImplementation(async () => {
      await deny(download);
      return { res: { headers: {} } };
    });
    await expect(bridge.getArchiveDownloadRequest(file.id, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(storage.signatureUrl).not.toHaveBeenCalled();
  });
  it("never signs a mutated file or a disabled parent run", async () => {
    await group();
    const parent = await run(),
      file = await artifact(parent.id);
    storage.head.mockImplementation(async () => {
      await prisma.archiveArtifact.update({ where: { id: file.id }, data: { objectKey: "fixture-changed" } });
      return { res: { headers: {} } };
    });
    await expect(bridge.getArchiveDownloadRequest(file.id, request())).rejects.toMatchObject({ statusCode: 403 });
    storage.head.mockImplementation(async () => {
      await prisma.dataLifecycleRun.update({ where: { id: parent.id }, data: { status: 0 } });
      return { res: { headers: {} } };
    });
    await expect(bridge.getArchiveDownloadRequest(file.id, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(storage.signatureUrl).not.toHaveBeenCalled();
  });
  it("preserves archive restore requested, in-progress and ready responses", async () => {
    await group();
    const parent = await run(),
      file = await artifact(parent.id);
    storage.head.mockResolvedValue({ res: { headers: { "x-oss-storage-class": "ColdArchive" } } });
    expect(await bridge.getArchiveDownloadRequest(file.id, request())).toEqual({
      url: null,
      expiresInSeconds: 0,
      restoreRequired: true,
      restoreStatus: "requested",
    });
    expect(storage.restore).toHaveBeenCalledWith(file.objectKey, { type: "ColdArchive" });
    storage.head.mockResolvedValue({
      res: { headers: { "x-oss-storage-class": "Archive", "x-oss-restore": 'ongoing-request="true"' } },
    });
    expect((await bridge.getArchiveDownloadRequest(file.id, request())).restoreStatus).toBe("in-progress");
    expect(storage.restore).toHaveBeenCalledTimes(1);
    storage.head.mockResolvedValue({
      res: { headers: { "x-oss-storage-class": "Archive", "x-oss-restore": 'ongoing-request="false"' } },
    });
    expect((await bridge.getArchiveDownloadRequest(file.id, request())).restoreStatus).toBe("ready");
  });
  it("denies the response if authorization changes after a restore was requested", async () => {
    await group();
    const parent = await run(),
      file = await artifact(parent.id);
    storage.head.mockResolvedValue({ res: { headers: { "x-oss-storage-class": "Archive" } } });
    storage.restore.mockImplementation(async () => {
      await deny(download);
    });
    await expect(bridge.getArchiveDownloadRequest(file.id, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(storage.restore).toHaveBeenCalledTimes(1);
    expect(storage.signatureUrl).not.toHaveBeenCalled();
  });
  it("does not release a newly signed URL if the final group snapshot is revoked", async () => {
    const g = await group();
    const parent = await run(),
      file = await artifact(parent.id);
    const { PlatformManagementReadRepository } = await import("@/store/system/platform-management-read.repository");
    const snapshots = PlatformManagementReadRepository.getInstance(),
      original = snapshots.recheck.bind(snapshots);
    let signed = false;
    storage.signatureUrl.mockImplementation(() => {
      signed = true;
      return "fixture-signed-link";
    });
    vi.spyOn(snapshots, "recheck").mockImplementation(async (...args) => {
      if (signed) await prisma.group.update({ where: { id: g.id }, data: { permissions: [] } });
      return original(...args);
    });
    await expect(bridge.getArchiveDownloadRequest(file.id, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(storage.signatureUrl).toHaveBeenCalledTimes(1);
  });
  it("uses only the role's download grant and checks session revocation before signing", async () => {
    await group();
    const parent = await run(),
      file = await artifact(parent.id);
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "lifecycle-download-" + randomUUID() },
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
    await expect(bridge.getArchiveDownloadRequest(file.id, req)).rejects.toMatchObject({ statusCode: 403 });
    const b = await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: download, Resource: platformLifecycleArtifactArn(parent.id, file.id) },
    });
    await prisma.ramAuthorization.update({
      where: { id: b.id },
      data: { principalType: "role", principalId: role.id },
    });
    storage.head.mockImplementation(async () => {
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return { res: { headers: {} } };
    });
    await expect(bridge.getArchiveDownloadRequest(file.id, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(storage.signatureUrl).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("retains %s storage flow once without native key hydration", async (mode) => {
    await group();
    const parent = await run(),
      file = await artifact(parent.id);
    env.security.iamAuthorizationMode = mode;
    vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({
      hasPermission: true,
      missingPermissions: [],
      checkedPermissions: [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE],
    });
    const native = vi.spyOn(PlatformLifecycleHistoryRepository.getInstance(), "hydrateArtifacts");
    expect((await bridge.getArchiveDownloadRequest(file.id, request())).restoreStatus).toBe("ready");
    expect(native).not.toHaveBeenCalled();
    expect(storage.head).toHaveBeenCalledTimes(1);
    expect(storage.signatureUrl).toHaveBeenCalledTimes(1);
  });
  it("fails safely when storage is unavailable, without restoring or signing", async () => {
    await group();
    const parent = await run(),
      file = await artifact(parent.id);
    storage.head.mockRejectedValue(new Error("fixture storage unavailable"));
    await expect(bridge.getArchiveDownloadRequest(file.id, request())).rejects.toThrow("fixture storage unavailable");
    expect(storage.restore).not.toHaveBeenCalled();
    expect(storage.signatureUrl).not.toHaveBeenCalled();
  });
});
