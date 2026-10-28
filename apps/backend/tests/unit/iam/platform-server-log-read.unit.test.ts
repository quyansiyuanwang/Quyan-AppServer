import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
import { env } from "@/config/env";
import { PlatformServerLogReadIamService } from "@/services/system/platform-server-log-read-iam.service";
import { platformServerLogArn } from "@/iam/resources/platform-server-log-resources";
import { platformServerLogFileResourceResolver } from "@/iam/request/platform-server-log-resource-resolvers";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { TypedRequest } from "@/types/express";
const iam = { loadPolicies: vi.fn(), evaluateLoadedPolicies: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformServerLogReadIamService(iam, snapshots, permissions);
const name = "combined-2026-10-14.log",
  denied = "error-2026-10-14.log.gz";
const file = (name: string) => ({
  name,
  type: "combined" as const,
  date: "2026-10-14",
  compressed: name.endsWith(".gz"),
  sizeBytes: 1,
  modifiedTime: "2026-10-14T00:00:00Z",
});
const content = (name: string) => ({
  file: file(name),
  totalLineCount: 1,
  matchedLineCount: 1,
  returnedLines: 1,
  truncated: false,
  search: null,
  content: "fixture content",
});
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
    headers: {},
    params: { fileName: name },
    secure: true,
  }) as unknown as TypedRequest;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  snapshots.snapshot.mockResolvedValue({});
  snapshots.recheck.mockResolvedValue(undefined);
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  iam.evaluateLoadedPolicies.mockImplementation(async ({ resources }) =>
    resources.map((resource: string) => ({
      decision: resource.endsWith(denied) ? "ExplicitDeny" : "Allow",
      reason: "fixture",
      matchedStatements: [],
    })),
  );
});
afterEach(() => {
  env.security.iamAuthorizationMode = "enforce";
});
describe("server log file resource authorization", () => {
  it("builds exact file ARNs and rejects path aliases without resolving to a wildcard", async () => {
    expect(platformServerLogArn(name)).toBe("acs:platform:*:platform:server-log-file/" + name);
    for (const bad of ["../" + name, "dir/" + name, "dir\\" + name, name + "*", "", name + "\n"]) {
      expect(() => platformServerLogArn(bad)).toThrow();
      const req = request();
      req.params.fileName = bad;
      expect(await platformServerLogFileResourceResolver({ request: req, principal: {} as never })).toBeUndefined();
    }
  });
  it("filters metadata per file while preserving order and keeping list and content actions distinct", async () => {
    const hydrate = vi.fn().mockResolvedValue({ files: [file(name), file(denied)] });
    expect(await service.list(request(), hydrate)).toEqual({ files: [file(name)] });
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(
      iam.evaluateLoadedPolicies.mock.calls.every(([input]) => input.action === "quyan:system:server_log:ListFiles"),
    ).toBe(true);
  });
  it("authorizes content before hydration and denies explicit or implicit refusal", async () => {
    for (const decision of ["ExplicitDeny", "ImplicitDeny"]) {
      iam.evaluateLoadedPolicies.mockResolvedValue([{ decision, reason: "fixture", matchedStatements: [] }]);
      const hydrate = vi.fn().mockResolvedValue(content(name));
      await expect(service.content(name, request(), hydrate)).rejects.toMatchObject({ statusCode: 403 });
      expect(hydrate).not.toHaveBeenCalled();
    }
  });
  it("rechecks identity and policies after hydration and does not return a revoked content result", async () => {
    const hydrate = vi.fn().mockImplementation(async () => {
      snapshots.recheck.mockRejectedValue(new Error("fixture revoked"));
      return content(name);
    });
    await expect(service.content(name, request(), hydrate)).rejects.toThrow("fixture revoked");
  });
  it("does not expose a payload hydrated for another file", async () => {
    await expect(service.content(name, request(), async () => content(denied))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("reports absence only after authorization and checks again before returning", async () => {
    await expect(service.content(name, request(), async () => null)).rejects.toMatchObject({ statusCode: 404 });
    expect(iam.evaluateLoadedPolicies).toHaveBeenCalledTimes(2);
  });
  it("requires platform qualification before even enumerating metadata", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("fixture unqualified"));
    const hydrate = vi.fn();
    await expect(service.list(request(), hydrate)).rejects.toThrow("fixture unqualified");
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("handles empty collections and fails closed on malformed or duplicate filenames", async () => {
    expect(await service.list(request(), async () => ({ files: [] }))).toEqual({ files: [] });
    for (const files of [[file("../" + name)], [file(name), file(name)]])
      await expect(service.list(request(), async () => ({ files }))).rejects.toMatchObject({ statusCode: 403 });
  });
  it("bounds evaluation batches and retained request decisions for large collections", async () => {
    const files = Array.from({ length: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 1 }, (_, index) =>
      file("combined-" + String(2000 + index) + "-01-01.log"),
    );
    const req = request();
    expect((await service.list(req, async () => ({ files }))).files).toHaveLength(files.length);
    expect(
      iam.evaluateLoadedPolicies.mock.calls.every(
        ([input]) => input.resources.length <= IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
      ),
    ).toBe(true);
    expect(req.iamDecisions).toHaveLength(IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
  });
  it("rejects incomplete decisions instead of treating missing results as Allow", async () => {
    iam.evaluateLoadedPolicies.mockResolvedValue([]);
    await expect(service.content(name, request(), async () => content(name))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each(["legacy", "shadow"] as const)("preserves original results and hydrates once in %s mode", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const hydrate = vi.fn().mockResolvedValue({ files: [file(name), file(denied)] });
    expect((await service.list(request(), hydrate)).files).toHaveLength(2);
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(permissions.checkUserPermissions).toHaveBeenCalledTimes(1);
  });
  it("fails closed for missing identities, OAuth identities and invalid authorization modes", async () => {
    const req = request();
    req.user = undefined;
    await expect(service.list(req, async () => ({ files: [] }))).rejects.toMatchObject({ statusCode: 403 });
    const oauth = request();
    oauth.oauthAccessToken = {} as never;
    await expect(service.list(oauth, async () => ({ files: [] }))).rejects.toMatchObject({ statusCode: 403 });
    env.security.iamAuthorizationMode = "invented" as never;
    await expect(service.content(name, request(), async () => content(name))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
