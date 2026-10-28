import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { PlatformServerLogReadIamService } from "@/services/system/platform-server-log-read-iam.service";
import { SystemController } from "@/api/controllers/v1/system/system.controller";
import { SystemService } from "@/services/system/system.service";
import { platformServerLogArn } from "@/iam/resources/platform-server-log-resources";
import type { TypedRequest } from "@/types/express";
const service = PlatformServerLogReadIamService.getInstance(),
  mode = env.security.iamAuthorizationMode;
const name = "combined-2026-10-14.log",
  hidden = "error-2026-10-14.log.gz",
  list = "quyan:system:server_log:ListFiles",
  get = "quyan:system:server_log:GetFileContent";
let owner: string, actor: string, groupId: string, roleId: string, sessionId: string;
const user = async (accountOwnerId?: string, groupId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "server-log-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        parentUserId: accountOwnerId,
        userType: accountOwnerId ? "ram_user" : "root",
        groupId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const file = (name: string) => ({
  name,
  type: "combined" as const,
  date: "2026-10-14",
  compressed: name.endsWith(".gz"),
  sizeBytes: 1,
  modifiedTime: "2026-10-14T00:00:00Z",
});
const content = () => ({
  file: file(name),
  totalLineCount: 1,
  matchedLineCount: 1,
  returnedLines: 1,
  truncated: false,
  search: null,
  content: "fixture-only-content",
});
const request = (role = true) =>
  ({
    user: { userId: actor },
    headers: { "x-action": list },
    params: { fileName: name },
    ip: "127.0.0.1",
    secure: true,
    authContext: {
      principalUserId: actor,
      accountOwnerId: owner,
      subjectType: role ? "assumed_role" : "sub_user",
      ...(role ? { assumedRoleId: roleId, roleSessionId: sessionId } : {}),
    },
  }) as unknown as TypedRequest;
async function grant(action: string | string[], resource: string | string[], effect: "Allow" | "Deny" = "Allow") {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: effect, Action: action, Resource: resource } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "server-log-policy-" + randomUUID(),
    permissions: [],
    iamVersion: { document: parsed.document, documentHash: parsed.documentHash, createdBy: owner },
  });
  await RamPolicyRepository.getInstance().attachPolicy(owner, policy.id, "role", roleId);
  return policy;
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  groupId = (
    await prisma.group.create({
      data: { username: "server-log-global-" + randomUUID(), permissions: [Permission.SYSTEM_SERVER_LOG_READ] },
    })
  ).id;
  actor = await user(owner, groupId);
  roleId = (await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "server-log-role-" + randomUUID() } }))
    .id;
  sessionId = (
    await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
        tokenJtiHash: randomUUID(),
      },
    })
  ).id;
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("server-log files with real IAM policies and platform qualification", () => {
  it("lists only matching file ARNs and retains explicit Deny with no inherited group Allow in a role session", async () => {
    await grant(list, "acs:platform:*:platform:server-log-file/*");
    await grant(list, platformServerLogArn(hidden), "Deny");
    expect(await service.list(request(), async () => ({ files: [file(hidden), file(name)] }))).toEqual({
      files: [file(name)],
    });
  });
  it("keeps listing and content grants independent and ignores a client Action header", async () => {
    await grant(list, platformServerLogArn(name));
    const hydrate = vi.fn().mockResolvedValue(content());
    await expect(service.content(name, request(), hydrate)).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
    await grant(get, platformServerLogArn(name));
    expect((await service.content(name, request(), hydrate)).content).toBe("fixture-only-content");
  });
  it("an exact grant for a different file cannot read this file or disclose its existence", async () => {
    await grant(get, platformServerLogArn(hidden));
    const hydrate = vi.fn().mockResolvedValue(null);
    await expect(service.content(name, request(), hydrate)).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("does not let account policies or user permission additions manufacture a global operational qualification", async () => {
    await grant([list, get], "*");
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.SYSTEM_SERVER_LOG_READ] } });
    const hydrate = vi.fn().mockResolvedValue({ files: [file(name)] });
    await expect(service.list(request(), hydrate)).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it.each(["private-group", "group-disabled", "actor-disabled", "owner-disabled", "revoked-session"])(
    "refuses %s platform readers",
    async (change) => {
      await grant([list, get], "*");
      if (change === "private-group")
        await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      if (change === "group-disabled") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      if (change === "actor-disabled") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
      if (change === "owner-disabled") await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
      if (change === "revoked-session")
        await prisma.ramRoleSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
      const hydrate = vi.fn().mockResolvedValue(content());
      await expect(service.content(name, request(), hydrate)).rejects.toMatchObject({ statusCode: 403 });
      expect(hydrate).not.toHaveBeenCalled();
    },
  );
  it("does not return content when its policy is disabled during hydration", async () => {
    const policy = await grant(get, platformServerLogArn(name));
    await expect(
      service.content(name, request(), async () => {
        await prisma.ramPolicy.update({ where: { id: policy.id }, data: { status: 0 } });
        return content();
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks binding scopes and platform qualification after enumeration", async () => {
    await grant(list, platformServerLogArn(name));
    await expect(
      service.list(request(), async () => {
        await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        return { files: [file(name)] };
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("AccessKey identities use the same platform qualifications and per-file Deny", async () => {
    const req = request(false);
    req.authContext!.subjectType = "access_key";
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Deny", Action: get, Resource: platformServerLogArn(name) },
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "server-log-accesskey-" + randomUUID(),
      permissions: [],
      iamVersion: { document: parsed.document, documentHash: parsed.documentHash, createdBy: owner },
    });
    await RamPolicyRepository.getInstance().attachPolicy(owner, policy.id, "user", actor);
    const hydrate = vi.fn().mockResolvedValue(content());
    await expect(service.content(name, req, hydrate)).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("returns the legacy file list and reads exactly once in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const hydrate = vi.fn().mockResolvedValue({ files: [file(name), file(hidden)] });
    expect((await service.list(request(false), hydrate)).files).toHaveLength(2);
    expect(hydrate).toHaveBeenCalledTimes(1);
  });
  it("the controller preserves file-type, tail-length and search inputs while enforcing resource grants", async () => {
    await grant([list, get], platformServerLogArn(name));
    const listFiles = vi
      .spyOn(SystemService.getInstance(), "getServerLogFiles")
      .mockResolvedValue({ files: [file(name)] });
    const tail = vi.spyOn(SystemService.getInstance(), "getServerLogContent").mockResolvedValue(content());
    const controller = new SystemController();
    expect((await controller.getServerLogFiles(request(), "combined")).files).toHaveLength(1);
    expect((await controller.getServerLogContent(name, request(), 42, "needle")).returnedLines).toBe(1);
    expect(listFiles).toHaveBeenCalledWith("combined");
    expect(tail).toHaveBeenCalledWith(name, 42, "needle");
  });
});
