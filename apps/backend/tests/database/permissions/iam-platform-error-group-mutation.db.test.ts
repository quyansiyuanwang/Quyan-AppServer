import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { PlatformErrorGroupMutationIamService } from "@/services/system/platform-error-group-mutation-iam.service";
import { PlatformErrorGroupMutationRepository } from "@/store/system/platform-error-group-mutation.repository";
import { ErrorReportController } from "@/api/controllers/v1/system/error-report.controller";
import { ErrorReportService } from "@/services/system/error-report.service";
import { platformErrorGroupArn } from "@/iam/resources/platform-error-group-resources";
import { PermissionService } from "@/services/users/permission.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import * as revision from "@/store/users/iam-authorization-revision";
import * as context from "@/iam/request/condition-context";
import type { TypedRequest } from "@/types/express";
const service = PlatformErrorGroupMutationIamService.getInstance(),
  repo = PlatformErrorGroupMutationRepository.getInstance();
const action = "quyan:system:error_report:UpdateErrorGroupStatus",
  get = "quyan:system:error_report:GetErrorGroup";
const body = { resolutionStatus: "resolved" as const };
let owner: string, actor: string, id: string;
async function user(accountOwnerId?: string) {
  return (
    await prisma.user.create({
      data: {
        username: "error-mutation-fixture-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
}
async function qualifier(
  permissions = [Permission.SYSTEM_ERROR_REPORT_READ, Permission.SYSTEM_ERROR_REPORT_UPDATE],
  global = true,
) {
  const row = await prisma.group.create({
    data: {
      username: "error-mutation-fixture-" + randomUUID(),
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
    params: { id },
    headers: { "x-action": "*", "x-account-id": "other" },
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
async function policy(
  effect: "Allow" | "Deny",
  requestedAction: string,
  resource = platformErrorGroupArn(id),
  condition?: any,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: {
      Effect: effect,
      Action: requestedAction,
      Resource: resource,
      ...(condition ? { Condition: condition } : {}),
    },
  });
  return RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "error-mutation-fixture-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
}
async function bind(
  effect: "Allow" | "Deny",
  requestedAction: string,
  resource = platformErrorGroupArn(id),
  condition?: any,
) {
  const p = await policy(effect, requestedAction, resource, condition);
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
  id = (
    await prisma.errorGroup.create({
      data: {
        fingerprint: "error-mutation-fixture-" + randomUUID(),
        source: "frontend",
        errorType: "Error",
        message: "fixture summary",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    })
  ).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  await prisma.errorGroup.deleteMany({ where: { id } });
});
const status = async () => (await prisma.errorGroup.findUniqueOrThrow({ where: { id } })).resolutionStatus;
describe("guarded error group status mutations", () => {
  it("updates the concrete group and keeps the full compatible response", async () => {
    await qualifier();
    const legacy = vi.spyOn(ErrorReportService.getInstance(), "updateGroupStatus");
    expect(await new ErrorReportController().updateStatus(id, body, request())).toMatchObject({
      id,
      resolutionStatus: "resolved",
      message: "fixture summary",
    });
    expect(await status()).toBe("resolved");
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each([action, get])("does not write or disclose a summary when %s is explicitly denied", async (denied) => {
    await qualifier();
    await bind("Deny", denied);
    const hydrate = vi.spyOn(ErrorReportService.getInstance(), "getGroup"),
      write = vi.spyOn(repo, "update");
    await expect(new ErrorReportController().updateStatus(id, body, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await status()).toBe("open");
    expect(hydrate).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
  it.each([Permission.SYSTEM_ERROR_REPORT_READ, Permission.SYSTEM_ERROR_REPORT_UPDATE])(
    "requires real global %s eligibility as well as policies",
    async (permission) => {
      await qualifier([permission]);
      await bind("Allow", "*");
      await expect(service.update(id, body, request())).rejects.toMatchObject({ statusCode: 403 });
      expect(await status()).toBe("open");
    },
  );
  it.each(["adds", "private-group", "owner"])("does not manufacture platform eligibility with %s", async (kind) => {
    if (kind === "adds")
      await prisma.user.update({
        where: { id: actor },
        data: { permissionAdds: [Permission.SYSTEM_ERROR_REPORT_READ, Permission.SYSTEM_ERROR_REPORT_UPDATE] },
      });
    if (kind === "private-group") await qualifier(undefined, false);
    const r = request();
    if (kind === "owner") {
      r.user!.userId = owner;
      r.authContext = { principalUserId: owner, accountOwnerId: owner } as any;
    }
    await bind("Allow", "*", "*");
    await expect(service.update(id, body, r)).rejects.toMatchObject({ statusCode: 403 });
    expect(await status()).toBe("open");
  });
  it("honors another group's Deny without denying the requested resource", async () => {
    await qualifier();
    await bind("Deny", action, platformErrorGroupArn("other-group"));
    expect(await service.update(id, body, request())).toMatchObject({ id, resolutionStatus: "resolved" });
  });
  it.each(["policy", "authorization", "role-binding", "resource-group", "status", "target", "user", "owner", "group"])(
    "rejects a prepared write after %s changes",
    async (kind) => {
      const group = await qualifier(),
        guard = await service.prepare(id, request());
      if (kind === "policy") await bind("Deny", action);
      if (kind === "authorization") await bind("Allow", action, platformErrorGroupArn("other-group"));
      if (kind === "role-binding") {
        const role = await prisma.ramRole.create({
          data: { accountOwnerId: owner, name: "fixture-role-" + randomUUID() },
        });
        await prisma.ramUserRoleBinding.create({ data: { accountOwnerId: owner, userId: actor, roleId: role.id } });
      }
      if (kind === "resource-group")
        await prisma.ramResourceGroup.create({
          data: { accountOwnerId: owner, name: "fixture-group-" + randomUUID() },
        });
      if (kind === "status")
        await prisma.errorGroup.update({
          where: { id },
          data: { resolutionStatus: "ignored", updateTime: guard.target.updateTime },
        });
      if (kind === "target") await prisma.errorGroup.update({ where: { id }, data: { status: 0 } });
      if (kind === "user") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
      if (kind === "owner") await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
      if (kind === "group") await prisma.group.update({ where: { id: group.id }, data: { permissions: [] } });
      await expect(repo.update(guard, body)).rejects.toMatchObject({ statusCode: 403 });
      expect(await status()).toBe(kind === "status" ? "ignored" : "open");
    },
  );
  it("rolls back the write when final authorization fails inside the transaction", async () => {
    await qualifier();
    const guard = await service.prepare(id, request()),
      recheck = guard.users.recheck;
    let checks = 0;
    guard.users.recheck = async () => {
      await recheck();
      if (++checks === 2) throw iamAccountDenied();
    };
    await expect(repo.update(guard, body)).rejects.toMatchObject({ statusCode: 403 });
    expect(await status()).toBe("open");
  });
  it("rolls back on an actual time-dependent GetErrorGroup Deny after the update", async () => {
    await qualifier();
    const future = "2100-01-01T00:00:00.000Z";
    await bind("Deny", get, platformErrorGroupArn(id), { DateGreaterThanEquals: { "acs:CurrentTime": future } });
    const guard = await service.prepare(id, request()),
      recheck = guard.users.recheck,
      originalContext = context.requestConditionContext;
    let checks = 0;
    guard.users.recheck = async () => {
      if (++checks === 2)
        vi.spyOn(context, "requestConditionContext").mockImplementation((r, p) => ({
          ...originalContext(r, p),
          "acs:CurrentTime": future,
        }));
      await recheck();
    };
    await expect(repo.update(guard, body)).rejects.toMatchObject({ statusCode: 403 });
    expect(await status()).toBe("open");
  });
  it("serializes a default-policy switch behind the authorized write", async () => {
    await qualifier();
    const grant = await bind("Allow", get),
      deny = parseIamPolicy({
        Version: "1",
        Statement: { Effect: "Deny", Action: get, Resource: platformErrorGroupArn(id) },
      });
    const version = await prisma.ramPolicyVersion.create({
      data: {
        policyId: grant.policyId,
        version: 2,
        document: deny.document as any,
        documentHash: deny.documentHash,
        createdBy: owner,
      },
    });
    let locked!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => {
        locked = resolve;
      }),
      resume = new Promise<void>((resolve) => {
        release = resolve;
      });
    const original = revision.readIamAuthorizationRevision;
    vi.spyOn(revision, "readIamAuthorizationRevision").mockImplementation(async (client, account) => {
      const value = await original(client, account);
      if (client !== prisma) {
        locked();
        await resume;
      }
      return value;
    });
    const operation = service.update(id, body, request());
    let writer: Promise<unknown> | undefined,
      finished = false;
    try {
      await Promise.race([
        ready,
        operation.then(() => {
          throw new Error("fixture missed transaction gate");
        }),
      ]);
      writer = prisma.ramPolicy
        .update({ where: { id: grant.policyId }, data: { defaultVersionId: version.id } })
        .then((r) => {
          finished = true;
          return r;
        });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(finished).toBe(false);
      release();
      expect(await operation).toMatchObject({ id, resolutionStatus: "resolved" });
      await writer;
    } finally {
      release();
      await Promise.allSettled([operation, ...(writer ? [writer] : [])]);
    }
    vi.restoreAllMocks();
    await expect(service.update(id, { resolutionStatus: "open" }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await status()).toBe("resolved");
  });
  it("requires role grants for both actions and rejects a revoked session", async () => {
    await qualifier();
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "fixture-role-" + randomUUID() } });
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
    Object.assign(r.authContext!, { roleSessionId: session.id, assumedRoleId: role.id });
    await expect(service.update(id, body, r)).rejects.toMatchObject({ statusCode: 403 });
    for (const current of [action, get]) {
      const binding = await bind("Allow", current);
      await prisma.ramAuthorization.update({
        where: { id: binding.id },
        data: { principalType: "role", principalId: role.id },
      });
    }
    expect(await service.update(id, body, r)).toHaveProperty("resolutionStatus", "resolved");
    const guard = await service.prepare(id, r);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(repo.update(guard, { resolutionStatus: "open" })).rejects.toMatchObject({ statusCode: 403 });
    expect(await status()).toBe("resolved");
  });
  it("applies the same resource and read dependency gates to AccessKey subjects", async () => {
    await qualifier();
    const r = request();
    r.authContext!.subjectType = "access_key";
    await bind("Deny", get);
    await expect(service.update(id, body, r)).rejects.toMatchObject({ statusCode: 403 });
    expect(await status()).toBe("open");
  });
  it.each(["account", "oauth", "missing", "target"])("fails closed on %s", async (kind) => {
    await qualifier();
    const r = request();
    if (kind === "account") r.authContext!.accountOwnerId = actor;
    if (kind === "oauth") r.oauthAccessToken = {} as any;
    if (kind === "missing") delete r.authContext;
    await expect(service.update(kind === "target" ? "missing-id" : id, body, r)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await status()).toBe("open");
  });
  it.each(["legacy", "shadow"] as const)(
    "preserves %s writes and full response with the original permission",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({
        hasPermission: true,
      } as any);
      await bind("Deny", get);
      await bind("Deny", action);
      expect(await new ErrorReportController().updateStatus(id, body, request())).toMatchObject({
        resolutionStatus: "resolved",
        message: "fixture summary",
      });
      vi.mocked(PermissionService.getInstance().checkUserPermissions).mockResolvedValue({
        hasPermission: false,
      } as any);
      await expect(service.update(id, { resolutionStatus: "open" }, request())).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(await status()).toBe("resolved");
    },
  );
});
