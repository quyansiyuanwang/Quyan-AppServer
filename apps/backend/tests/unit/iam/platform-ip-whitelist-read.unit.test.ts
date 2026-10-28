import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/security/platform-ip-whitelist-read.repository", () => ({
  PlatformIpWhitelistReadRepository: { getInstance: vi.fn() },
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
import { PlatformIpWhitelistReadIamService } from "@/services/system/platform-ip-whitelist-read-iam.service";
import { PlatformIpWhitelistReadRepository } from "@/store/security/platform-ip-whitelist-read.repository";
import { platformIpWhitelistStatusResource } from "@/iam/request/platform-ip-whitelist-resource-resolvers";
import { platformIpWhitelistArn } from "@/iam/resources/platform-ip-whitelist-resources";
import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { ...allow, decision: "ExplicitDeny" };
const target = (id: string, expiresAt: Date | null = null) => ({
  id,
  status: 1,
  createTime: new Date(0),
  updateTime: new Date(0),
  expiresAt,
});
let service: PlatformIpWhitelistReadIamService, iam: any, repo: any, identities: any, request: TypedRequest;
beforeEach(() => {
  iam = {
    loadPolicies: vi.fn(),
    authorizeMany: vi.fn().mockImplementation(async ({ resources }: any) => resources.map(() => allow)),
  };
  repo = {
    scan: vi.fn().mockResolvedValue([target("a"), target("b"), target("c")]),
    target: vi.fn().mockResolvedValue(target("a")),
    recheck: vi.fn().mockImplementation(async (_: unknown, targets: any[]) => targets),
    hydrate: vi
      .fn()
      .mockImplementation(async (_: unknown, targets: any[]) =>
        targets.map((t) => ({ ...t, ipAddress: "2001:db8::1", reason: "fixture-only", addedBy: "actor" })),
      ),
  };
  identities = {
    snapshot: vi.fn().mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] }),
    recheck: vi.fn(),
  };
  service = new (PlatformIpWhitelistReadIamService as unknown as new (
    ...args: any[]
  ) => PlatformIpWhitelistReadIamService)(iam, repo, identities);
  vi.mocked(PlatformIpWhitelistReadRepository.getInstance).mockReturnValue(repo);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    params: { ip: "2001:db8::1" },
    body: { accountId: "foreign" },
  } as unknown as TypedRequest;
});
describe("platform IP whitelist reads", () => {
  it("filters Deny before paging and counts only authorized records", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((r: string) => (r.endsWith("/b") ? deny : allow)),
    );
    const result = await service.list(1, 1, request);
    expect(result.total).toBe(2);
    expect(result.whitelists.map((r) => r.id)).toEqual(["a"]);
    expect(repo.hydrate).toHaveBeenCalledWith(expect.anything(), [target("a")]);
    for (const [entry] of iam.authorizeMany.mock.calls) expect(entry.action).toBe("quyan:ip_whitelist:ListEntries");
  });
  it("never loads display fields for an empty authorized list or shadow diagnostics", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: any) => resources.map(() => deny));
    expect(await service.list(10, 0, request)).toEqual({ whitelists: [], total: 0 });
    await service.list(10, 0, request, false);
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("discards a page if a record outside that page changes or permission is revoked during hydration", async () => {
    repo.recheck.mockImplementation(async (_: unknown, targets: any[]) => targets.filter((t) => t.id !== "a"));
    await expect(service.list(1, 0, request)).rejects.toMatchObject({ statusCode: 403 });
    repo.recheck.mockImplementation(async (_: unknown, targets: any[]) => targets);
    repo.hydrate.mockImplementation(async (_: unknown, targets: any[]) => {
      iam.authorizeMany.mockResolvedValue(targets.map(() => deny));
      return targets.map((t) => ({ ...t, ipAddress: "2001:db8::1" }));
    });
    await expect(service.list(1, 0, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses actual record IDs for IPv6 addresses and never fabricates an absent resource", async () => {
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    expect(await platformIpWhitelistStatusResource({ request, principal })).toBe(platformIpWhitelistArn("a"));
    expect(repo.target).toHaveBeenCalledWith(principal, "2001:db8::1");
    repo.target.mockResolvedValue(null);
    expect(await platformIpWhitelistStatusResource({ request, principal })).toBeUndefined();
    await expect(service.status("2001:db8::1", request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("reads expiry from metadata and rejects a deleted or finally denied record", async () => {
    repo.target.mockResolvedValue(target("a", new Date(0)));
    repo.recheck.mockResolvedValue([target("a", new Date(0))]);
    expect(await service.status("2001:db8::1", request)).toBe(false);
    repo.recheck.mockResolvedValue([]);
    await expect(service.status("2001:db8::1", request)).rejects.toMatchObject({ statusCode: 403 });
    repo.recheck.mockResolvedValue([target("a", new Date(0))]);
    iam.authorizeMany.mockResolvedValueOnce([allow]).mockResolvedValueOnce([deny]);
    await expect(service.status("2001:db8::1", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("rejects missing identities, OAuth, invalid pagination and malformed metadata", async () => {
    await expect(service.list(0, 0, request)).rejects.toMatchObject({ statusCode: 400 });
    repo.scan.mockResolvedValue([target("b"), target("a")]);
    await expect(service.list(10, 0, request)).rejects.toMatchObject({ statusCode: 403 });
    request.oauthAccessToken = { id: "fixture" } as any;
    await expect(service.list(10, 0, request)).rejects.toMatchObject({ statusCode: 403 });
    delete request.oauthAccessToken;
    delete request.authContext;
    await expect(service.list(10, 0, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("registers both routes with fixed native actions", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/system/ipwhitelist.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    expect(routes.find((r) => r.key === "GET /v1/ip-whitelist/list")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:ip_whitelist:ListEntries"],
      issues: [],
    });
    expect(routes.find((r) => r.key === "GET /v1/ip-whitelist/exists/{ip}")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:ip_whitelist:GetStatus"],
      issues: [],
    });
  });
});

it("scans additional batches without exposing denied records in the authorized total", async () => {
  const targets = Array.from({ length: 501 }, (_, i) => target("id-" + String(i).padStart(4, "0")));
  repo.scan.mockResolvedValueOnce(targets.slice(0, 500)).mockResolvedValueOnce(targets.slice(500));
  iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
    resources.map((r: string) => (r.endsWith("/id-0001") ? deny : allow)),
  );
  const result = await service.list(1, 0, request);
  expect(result.total).toBe(500);
  expect(result.whitelists.map((r) => r.id)).toEqual(["id-0500"]);
  expect(repo.scan.mock.calls.map((args: any[]) => args[1])).toEqual([undefined, "id-0499"]);
});
it("rejects a record removed or rebound from the requested address after final policy evaluation", async () => {
  repo.target.mockResolvedValueOnce(target("a")).mockResolvedValueOnce(null);
  await expect(service.status("2001:db8::1", request)).rejects.toMatchObject({ statusCode: 403 });
  repo.target.mockResolvedValueOnce(target("a")).mockResolvedValueOnce(target("replacement"));
  await expect(service.status("2001:db8::1", request)).rejects.toMatchObject({ statusCode: 403 });
});
