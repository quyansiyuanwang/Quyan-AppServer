import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/infrastructure/ai-resource-config.service", async () => {
  const { AI_RESOURCE_DEFAULTS } = await import("@/config/ai-resource-policy");
  return { getAIResourceConfig: () => AI_RESOURCE_DEFAULTS };
});
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/ai-request-log.repository", () => ({ AIRequestLogRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/relay/ai-request-log.service", () => ({ AIRequestLogService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { PlatformAiRequestLogListIamService } from "@/services/relay/platform-ai-request-log-list-iam.service";
import { env } from "@/config/env";
import { getIamActionDefinition } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const action = "quyan:relay:ai_request_log:ListLogs",
  query = { page: 1, pageSize: 2 };
const row = (index: number) => ({
  id: "log-" + index,
  status: 1,
  createTime: new Date(1000000 - index),
  updateTime: new Date(0),
});
let rows: any[],
  iam: any,
  snapshots: any,
  repo: any,
  logs: any,
  permissions: any,
  service: PlatformAiRequestLogListIamService,
  request: any;
beforeEach(() => {
  env.security.iamAuthorizationMode = "enforce";
  rows = [row(0), row(1), row(2), row(3), row(4)];
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorizeMany: vi.fn(async ({ resources }) =>
      resources.map(() => ({ decision: "Allow", reason: "matched-allow", matchedStatements: [] })),
    ),
  };
  snapshots = {
    snapshot: vi.fn().mockResolvedValue({ users: [], group: { id: "global", updateTime: new Date(0) } }),
    recheck: vi.fn().mockResolvedValue(undefined),
  };
  repo = {
    scan: vi.fn(async (_query, after, boundary) =>
      rows
        .filter(
          (r) => (!after || r.createTime < after.createTime) && (!boundary || r.createTime <= boundary.createTime),
        )
        .slice(0, IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
    ),
    hydrate: vi.fn(async (targets) => targets.map((t: any) => ({ ...t, requestId: t.id }))),
  };
  logs = {
    listItems: vi.fn((r) => r.map((t: any) => ({ id: t.id }))),
    query: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  };
  permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) };
  service = new (PlatformAiRequestLogListIamService as any)(iam, snapshots, repo, logs, permissions);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
  };
});
describe("AI request log authorized collections", () => {
  it("declares a separate list action and completes all controller metadata", () => {
    expect(getIamActionDefinition(action)).toMatchObject({
      accessLevel: "List",
      sensitive: true,
      resourceTypes: ["platform/relay-ai-request-log"],
      authorizationBoundary: "platform",
    });
    const p = new Project({ skipAddingFilesFromTsConfig: true });
    p.addSourceFileAtPath("src/api/controllers/v1/relay/ai-request-log.controller.ts");
    const routes = collectIamRoutes(p.getSourceFiles(), process.cwd());
    expect(routes.find((r) => r.key === "GET /v1/relay/ai-request-logs")).toMatchObject({
      coverage: "explicit",
      actions: [action],
      issues: [],
    });
    expect(routes.every((r) => r.coverage === "explicit" && !r.issues.length)).toBe(true);
  });
  it("filters before pagination and total and never hydrates denied rows", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((r: string) => ({
        decision: r.endsWith("/log-1") ? "ExplicitDeny" : "Allow",
        matchedStatements: [],
      })),
    );
    expect(await service.list({ page: 2, pageSize: 2 }, request)).toEqual({
      items: [{ id: "log-3" }, { id: "log-4" }],
      total: 4,
    });
    expect(repo.hydrate).toHaveBeenCalledWith([row(3), row(4)]);
    expect(
      iam.authorizeMany.mock.calls.every(
        ([r]: any) =>
          r.action === action &&
          r.resources.every((a: string) => a.startsWith("acs:platform:*:platform:relay-ai-request-log/")),
      ),
    ).toBe(true);
  });
  it("performs bounded scans and decision storage across more than one batch", async () => {
    rows = Array.from({ length: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 3 }, (_, i) => row(i));
    expect(await service.list({ page: 251, pageSize: 2 }, request)).toEqual({
      items: [{ id: "log-500" }, { id: "log-501" }],
      total: 503,
    });
    expect(repo.scan).toHaveBeenCalledTimes(4);
    expect(request.iamDecisions).toHaveLength(IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
    expect(
      iam.authorizeMany.mock.calls.every(
        ([r]: any) => r.resources.length <= IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
      ),
    ).toBe(true);
  });
  it("returns an empty page without querying displays when nothing is allowed", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map(() => ({ decision: "ImplicitDeny", matchedStatements: [] })),
    );
    expect(await service.list(query, request)).toEqual({ items: [], total: 0 });
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("does not add newly collected records to the current snapshot", async () => {
    repo.hydrate.mockImplementation(async (targets: any[]) => {
      rows.unshift({ ...row(-1), id: "newer" });
      return targets;
    });
    expect(await service.list(query, request)).toEqual({ items: [{ id: "log-0" }, { id: "log-1" }], total: 5 });
  });
  it.each(["denied-off-page", "version-off-page", "removed-off-page", "backdated-insert"])(
    "suppresses stale totals after %s",
    async (kind) => {
      repo.hydrate.mockImplementation(async (targets: any[]) => {
        if (kind === "denied-off-page")
          iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
            resources.map((r: string) => ({
              decision: r.endsWith("/log-4") ? "ExplicitDeny" : "Allow",
              matchedStatements: [],
            })),
          );
        if (kind === "version-off-page") rows[4].updateTime = new Date(1);
        if (kind === "removed-off-page") rows.pop();
        if (kind === "backdated-insert") rows.push(row(5));
        return targets;
      });
      await expect(service.list(query, request)).rejects.toMatchObject({ statusCode: 403 });
      expect(logs.listItems).not.toHaveBeenCalled();
    },
  );
  it("refuses missing, changed or injected displays", async () => {
    for (const displays of [[], [{ ...row(0), updateTime: new Date(1) }, row(1)], [row(0), row(0)], [row(0), row(4)]]) {
      repo.hydrate.mockResolvedValue(displays);
      await expect(service.list(query, request)).rejects.toMatchObject({ statusCode: 403 });
    }
  });
  it("fails closed on non-array or incomplete authorization results before displays", async () => {
    for (const result of [undefined, [], [null]]) {
      iam.authorizeMany.mockResolvedValue(result);
      await expect(service.list(query, request)).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("rejects invalid source metadata, duplicate batches and over-capacity scans", async () => {
    for (const result of [
      [{ ...row(0), status: 0 }],
      [row(0), row(0)],
      Array.from({ length: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 1 }, (_, i) => row(i)),
    ]) {
      repo.scan.mockResolvedValue(result);
      await expect(service.list(query, request)).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("rejects absent context and OAuth before scanning", async () => {
    await expect(service.list(query, {} as any)).rejects.toMatchObject({ statusCode: 403 });
    request.oauthAccessToken = {};
    await expect(service.list(query, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.scan).not.toHaveBeenCalled();
  });
  it.each([
    { ...query, page: 0 },
    { ...query, pageSize: 10001 },
    { ...query, startDate: new Date("invalid") },
    { ...query, accountOwnerId: "forged" },
  ])("rejects invalid query %j", async (input) => {
    await expect(service.list(input as any, request)).rejects.toMatchObject({ statusCode: 400 });
    expect(repo.scan).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)(
    "keeps %s enforcement and one legacy read without native display hydration",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      await service.list(query, request);
      expect(logs.query).toHaveBeenCalledOnce();
      expect(repo.hydrate).not.toHaveBeenCalled();
      permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
      await expect(service.list(query, request)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("rejects a policy change after the last authorization batch before delivery", async () => {
    let calls = 0;
    iam.loadPolicies.mockImplementation(async () =>
      ++calls < 5
        ? []
        : [
            {
              policyId: "changed",
              document: { Version: "1", Statement: [{ Effect: "Deny", Action: action, Resource: "*" }] },
            },
          ],
    );
    await expect(service.list(query, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(logs.listItems).not.toHaveBeenCalled();
  });
  it("suppresses response after final platform qualification recheck fails", async () => {
    let calls = 0;
    snapshots.recheck.mockImplementation(async () => {
      if (++calls === 4) throw new Error("fixture revoked");
    });
    await expect(service.list(query, request)).rejects.toThrow("fixture revoked");
    expect(logs.listItems).not.toHaveBeenCalled();
  });
});
