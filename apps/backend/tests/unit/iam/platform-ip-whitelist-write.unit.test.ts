import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/security/platform-ip-whitelist-write.repository", () => ({
  PlatformIpWhitelistWriteRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture deny", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { Permission, getIamActionDefinition, getIamResourceType } from "@quyan/shared";
import { PlatformIpWhitelistWriteIamService } from "@/services/system/platform-ip-whitelist-write-iam.service";
import {
  platformIpWhitelistArn,
  platformIpWhitelistCollectionArn,
} from "@/iam/resources/platform-ip-whitelist-resources";
import { createIPWhitelistBodySchema, ipWhitelistIpParamsSchema } from "@/api/schema/system/ipwhitelist.schema";
import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
let service: PlatformIpWhitelistWriteIamService, iam: any, repo: any, identities: any, request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  iam = { authorize: vi.fn().mockResolvedValue(allow) };
  repo = {
    create: vi.fn().mockResolvedValue({ id: "entry" }),
    remove: vi.fn().mockResolvedValue(true),
    target: vi.fn().mockResolvedValue({ id: "entry", ipAddress: "2001:db8::1", status: 1, updateTime: new Date(0) }),
  };
  identities = {
    snapshot: vi.fn().mockResolvedValue({
      group: { id: "global", updateTime: new Date(0) },
      users: [
        { id: "actor", updateTime: new Date(0) },
        { id: "owner", updateTime: new Date(0) },
      ],
    }),
    recheck: vi.fn(),
  };
  service = new (PlatformIpWhitelistWriteIamService as unknown as new (
    ...args: any[]
  ) => PlatformIpWhitelistWriteIamService)(iam, repo, identities);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "quyan:ip_whitelist:DeleteEntry" },
  } as unknown as TypedRequest;
});
describe("platform IP whitelist write authorization", () => {
  it("requires both the fixed creation boundary and actual record resource", async () => {
    await service.create("2001:db8::1", "fixture", "actor", undefined, request);
    const guard = repo.create.mock.calls[0][1];
    expect(guard.permission).toBe(Permission.IP_WHITELIST_CREATE);
    await guard.recheckEntry("entry");
    await guard.users.recheck();
    expect(iam.authorize.mock.calls.map((c: any) => [c[0].action, c[0].resource])).toEqual([
      ["quyan:ip_whitelist:CreateEntry", platformIpWhitelistCollectionArn()],
      ["quyan:ip_whitelist:CreateEntry", platformIpWhitelistArn("entry")],
      ["quyan:ip_whitelist:CreateEntry", platformIpWhitelistCollectionArn()],
    ]);
  });
  it("rejects missing principal, actor spoofing and OAuth tokens without a write", async () => {
    await expect(service.create("192.0.2.1", "", "other", undefined, request)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.create("192.0.2.1", "", "actor", undefined)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.create("192.0.2.1", "", "actor", undefined, { ...request, oauthAccessToken: {} } as TypedRequest),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.create).not.toHaveBeenCalled();
  });
  it("does not execute a write after initial denial or an unavailable decision", async () => {
    for (const result of [{ ...allow, decision: "ExplicitDeny" }, undefined]) {
      iam.authorize.mockResolvedValue(result);
      await expect(service.create("192.0.2.1", "", "actor", undefined, request)).rejects.toMatchObject({
        statusCode: 403,
      });
    }
    expect(repo.create).not.toHaveBeenCalled();
  });
  it("fails its transaction callbacks on a late grant or global-group revocation", async () => {
    await service.create("192.0.2.1", "", "actor", undefined, request);
    const guard = repo.create.mock.calls[0][1];
    iam.authorize.mockResolvedValue({ ...allow, decision: "ExplicitDeny" });
    await expect(guard.recheckEntry("entry")).rejects.toMatchObject({ statusCode: 403 });
    identities.recheck.mockRejectedValue(new Error("revoked"));
    await expect(guard.users.recheck()).rejects.toThrow("revoked");
  });
  it("resolves deletion by its existing record and refuses missing records", async () => {
    expect(await service.remove("2001:db8::1", "actor", request)).toBe(true);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:ip_whitelist:DeleteEntry", resource: platformIpWhitelistArn("entry") }),
    );
    repo.target.mockResolvedValue(null);
    await expect(service.remove("2001:db8::2", "actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.remove).toHaveBeenCalledTimes(1);
  });
  it("shadow evaluation does not create or delete data", async () => {
    expect(await service.create("192.0.2.1", "", "actor", undefined, request, false)).toBeUndefined();
    expect(await service.remove("2001:db8::1", "actor", request, false)).toBe(false);
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
  });
  it("rejects malformed IPv4/IPv6 and invalid dates before any metadata or write", async () => {
    for (const ip of ["not-ip", "999.0.0.1", "192.0.2.1:80", "2001::db8::1", "192.0.2.1/24"]) {
      expect(createIPWhitelistBodySchema.safeParse({ ipAddress: ip }).success).toBe(false);
      expect(ipWhitelistIpParamsSchema.safeParse({ ip }).success).toBe(false);
      await expect(service.remove(ip, "actor", request)).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(service.create("192.0.2.1", "", "actor", new Date(NaN), request)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(repo.target).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });
  it("registers platform boundaries and fixed native route metadata", () => {
    expect(getIamResourceType(platformIpWhitelistCollectionArn())?.accountScope).toBe("platform");
    expect(getIamActionDefinition("quyan:ip_whitelist:CreateEntry")?.resourceTypes).toContain("platform/ip-whitelist");
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/system/ipwhitelist.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    expect(routes.find((r) => r.method === "addWhiteIp")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:ip_whitelist:CreateEntry"],
    });
    expect(routes.find((r) => r.method === "removeWhiteIp")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:ip_whitelist:DeleteEntry"],
    });
  });
});
