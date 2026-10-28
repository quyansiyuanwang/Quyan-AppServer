import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/relay/platform-relay-concurrency-read.repository", () => ({
  PlatformRelayConcurrencyReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/relay/relay-proxy.service", () => ({ RelayProxyService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/services/infrastructure/ai-resource-config.service", () => ({
  getAIResourceConfig: () => ({
    relay: {
      resourceGuard: {
        imageMaxConcurrency: 2,
        imageQueueTimeoutMs: 1000,
        nonStreamUpstreamTimeoutMs: 10000,
      },
    },
  }),
}));
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { env } from "@/config/env";
import { PlatformRelayConcurrencyReadIamService } from "@/services/relay/platform-relay-concurrency-read-iam.service";
import {
  platformRelayConcurrencyArn,
  platformRelayImageConcurrencyArn,
  platformRelayUserConcurrencyArn,
} from "@/iam/resources/platform-relay-concurrency-resources";
import { relayConcurrencyKeyTarget } from "@/util/relay-concurrency-status-projection";
import type { TypedRequest } from "@/types/express";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = {
    configurationTarget: vi.fn(),
    hydrateConfiguration: vi.fn(),
    users: vi.fn(),
    scan: vi.fn(),
    ttl: vi.fn(),
  },
  reports = { getConcurrencyStatus: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformRelayConcurrencyReadIamService(iam, snapshots, repository, reports, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    secure: true,
    headers: { "x-action": "*" },
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const user = (id: string) => ({
  id,
  accountOwnerId: "owner",
  status: 1,
  createTime: new Date(0),
  updateTime: new Date(0),
});
const target = () => ({
  id: "config_default",
  source: "config",
  recordId: "row",
  status: 1,
  revision: "a".repeat(64),
  createTime: new Date(0),
  updateTime: new Date(0),
});
const key = (id: string, kind = "slot", slot = 1, scope = "default") =>
  relayConcurrencyKeyTarget(`relay:concurrency:${scope}:${id}:${kind === "slot" ? "slot" : "queue:waiter"}:${slot}`)!;
let denied: Set<string>;
beforeEach(() => {
  vi.resetAllMocks();
  denied = new Set();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }: { resources: string[] }) =>
    resources.map((resource) => ({
      decision: denied.has(resource) ? "ExplicitDeny" : "Allow",
      reason: "fixture",
      matchedStatements: [],
    })),
  );
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  snapshots.recheck.mockResolvedValue(undefined);
  repository.configurationTarget.mockImplementation(async () => target());
  repository.hydrateConfiguration.mockResolvedValue({
    maxConcurrency: 5,
    enableQueue: true,
    queueTimeout: 30000,
    upstreamStreamTimeout: 120000,
  });
  repository.users.mockImplementation(async (ids: string[]) => ids.map(user));
  repository.ttl.mockResolvedValue(10);
  repository.scan.mockImplementation(async (scope: string, kind: string, selected?: string) => ({
    cursor: "0",
    keys:
      scope === "image"
        ? [key("global", kind, 1, "image")]
        : (selected ? [selected] : ["user-1", "user-2"]).map((id) => key(id, kind)),
  }));
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  reports.getConcurrencyStatus.mockResolvedValue({
    redisAvailable: true,
    items: [],
    totals: { activeCount: 0 },
    limits: { maxConcurrency: 5 },
  });
});
describe("native concurrency resource authorization", () => {
  it("registers a fixed native Action and typed scope", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-config.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (route) => route.method === "getConcurrencyStatus",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:GetConcurrencyStatus"], issues: [] });
  });
  it("filters denied users before TTL hydration and computes totals from visible rows only", async () => {
    denied.add(platformRelayUserConcurrencyArn("user-2"));
    denied.add(platformRelayImageConcurrencyArn());
    const result = await service.read(request());
    expect(result.items.map((row) => row.userId)).toEqual(["user-1"]);
    expect(result.totals).toEqual({
      activeCount: 1,
      defaultScopeActiveCount: 1,
      imageScopeActiveCount: 0,
      queuedCount: 1,
      userCount: 1,
    });
    expect(repository.ttl.mock.calls.every(([id]) => id.includes("user-1"))).toBe(true);
    expect(repository.scan.mock.calls.every(([scope]) => scope === "default")).toBe(true);
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === "quyan:relay:GetConcurrencyStatus")).toBe(
      true,
    );
  });
  it("never turns access to a selected user into global image statistics", async () => {
    denied.add(platformRelayImageConcurrencyArn());
    const result = await service.read(request(), "user-1");
    expect(result.items.map((row) => row.userId)).toEqual(["user-1"]);
    expect(result.totals.imageScopeActiveCount).toBe(0);
  });
  it("denies a selected unauthorized or unresolved user", async () => {
    denied.add(platformRelayUserConcurrencyArn("user-1"));
    await expect(service.read(request(), "user-1")).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scan).not.toHaveBeenCalled();
    denied.clear();
    repository.users.mockResolvedValue([]);
    await expect(service.read(request(), "missing")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("denies the collection before source hydration or Redis scans", async () => {
    denied.add(platformRelayConcurrencyArn());
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.configurationTarget).not.toHaveBeenCalled();
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it("does not hydrate orphaned or disabled-user keys", async () => {
    repository.users.mockImplementation(async (ids: string[]) => ids.filter((id) => id === "user-1").map(user));
    const result = await service.read(request());
    expect(result.items.some((row) => row.userId === "user-2")).toBe(false);
    expect(repository.ttl.mock.calls.every(([id]) => !id.includes("user-2"))).toBe(true);
  });
  it("returns a bounded page with totals for all permitted records", async () => {
    const result = await service.read(request(), undefined, { page: 2, pageSize: 1 });
    expect(result.items).toHaveLength(1);
    expect(result).toMatchObject({ page: 2, pageSize: 1, total: 3, hasNext: true });
    expect(result.totals.activeCount).toBe(3);
  });
  it("follows empty intermediate pages and deduplicates Redis SCAN keys", async () => {
    repository.scan.mockImplementation(async (scope: string, kind: string, _selected: string, cursor: string) => {
      if (scope !== "default" || kind !== "slot") return { cursor: "0", keys: [] };
      return cursor === "0" ? { cursor: "19", keys: [] } : { cursor: "0", keys: [key("user-1"), key("user-1")] };
    });
    const result = await service.read(request());
    expect(result.totals.activeCount).toBe(1);
    expect(repository.ttl).toHaveBeenCalledOnce();
  });
  it("rejects cursor loops rather than issuing an unbounded scan", async () => {
    repository.scan.mockResolvedValue({ cursor: "19", keys: [] });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scan).toHaveBeenCalledTimes(2);
  });
  it("skips keys that expire between metadata discovery and hydration", async () => {
    repository.ttl.mockResolvedValue(-2);
    expect((await service.read(request())).items).toEqual([]);
  });
  it("rechecks ownership and source revisions even if timestamps were preserved", async () => {
    repository.ttl.mockImplementationOnce(async () => {
      repository.users.mockImplementation(async (ids: string[]) =>
        ids.map((id) => ({ ...user(id), accountOwnerId: "changed-owner" })),
      );
      return 10;
    });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["policy", "group", "config", "decision"])("rechecks a %s change before releasing data", async (kind) => {
    repository.ttl.mockImplementationOnce(async () => {
      if (kind === "policy")
        iam.loadPolicies.mockResolvedValue([
          { document: { Version: "1", Statement: { Effect: "Deny", Action: "*", Resource: "*" } } },
        ]);
      if (kind === "group") snapshots.recheck.mockRejectedValue(new Error("fixture group changed"));
      if (kind === "config")
        repository.configurationTarget.mockResolvedValue({ ...target(), revision: "b".repeat(64) });
      if (kind === "decision") denied.add(platformRelayUserConcurrencyArn("user-1"));
      return 10;
    });
    await expect(service.read(request())).rejects.toThrow();
  });
  it("batches and accounts for more than 500 user resources without returning an unbounded list", async () => {
    repository.scan.mockImplementation(async (scope: string, kind: string) => ({
      cursor: "0",
      keys:
        scope === "default" && kind === "slot" ? Array.from({ length: 501 }, (_, index) => key("user-" + index)) : [],
    }));
    const req = request(),
      result = await service.read(req);
    expect(result).toMatchObject({ page: 1, pageSize: 50, total: 501, hasNext: true });
    expect(result.items).toHaveLength(50);
    expect(result.totals.activeCount).toBe(501);
    expect(req.iamDecisions!.length).toBeLessThanOrEqual(500);
    expect(repository.users.mock.calls.every(([ids]) => ids.length <= 500)).toBe(true);
  });
  it.each(["*", "../user", "user:2", "user\n"])("rejects unsafe selector %j before any backend access", async (id) => {
    await expect(service.read(request(), id)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it.each([{ page: 0 }, { page: 1.5 }, { page: 10001 }, { pageSize: 101 }])(
    "rejects invalid pagination %j",
    async (pagination) => {
      await expect(service.read(request(), undefined, pagination)).rejects.toMatchObject({ statusCode: 400 });
      expect(repository.scan).not.toHaveBeenCalled();
    },
  );
  it.each(["principal", "oauth", "mode", "qualification", "storage", "results", "ttl"])(
    "fails closed for invalid %s",
    async (kind) => {
      const req = request();
      if (kind === "principal") delete req.user;
      if (kind === "oauth") req.oauthAccessToken = {} as never;
      if (kind === "mode") env.security.iamAuthorizationMode = "invalid" as never;
      if (kind === "qualification") snapshots.snapshot.mockRejectedValue(new Error("fixture unqualified"));
      if (kind === "storage") repository.scan.mockRejectedValue(new Error("fixture unavailable"));
      if (kind === "results") iam.authorizeMany.mockResolvedValue([]);
      if (kind === "ttl") repository.ttl.mockResolvedValue(null);
      await expect(service.read(req)).rejects.toThrow();
      expect(reports.getConcurrencyStatus).not.toHaveBeenCalled();
    },
  );
  it.each(["legacy", "shadow"] as const)("preserves a single %s telemetry read", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    denied.add(platformRelayConcurrencyArn());
    const result = await service.read(request());
    expect(result).toEqual(await reports.getConcurrencyStatus.mock.results[0]!.value);
    expect(reports.getConcurrencyStatus).toHaveBeenCalledOnce();
    expect(repository.scan).not.toHaveBeenCalled();
  });
});
