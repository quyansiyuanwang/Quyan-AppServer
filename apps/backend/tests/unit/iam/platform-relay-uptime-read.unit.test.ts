import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { getIamActionDefinition } from "@quyan/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/util/logger", () => ({
  LogCategory: { SECURITY: "security", BUSINESS: "business" },
  getLogger: () => logger,
}));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/relay/platform-relay-configuration-read.repository", () => ({
  PlatformRelayConfigurationReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/relay/relay-config.service", () => ({ RelayConfigService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  return { ...actual, default: { ...actual.default, get: vi.fn() } };
});
import axios from "axios";
import { env } from "@/config/env";
import { PlatformRelayUptimeReadIamService } from "@/services/relay/platform-relay-uptime-read-iam.service";
import { RelayUptimeService } from "@/services/relay/relay-uptime.service";
import { relayUptimeTargets, projectRelayUptimeResponse } from "@/util/relay-uptime-projection";
import { platformRelayUptimeArn, platformRelayUptimeMonitorArn } from "@/iam/resources/platform-relay-uptime-resources";
import type { TypedRequest } from "@/types/express";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { configurationTarget: vi.fn(), hydrateConfiguration: vi.fn() },
  reports = { getStatus: vi.fn(), fromConfiguration: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformRelayUptimeReadIamService(iam, snapshots, repository, reports, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const metadata = () => ({
  id: "config_default",
  source: "config",
  recordId: "config_row",
  status: 1,
  revision: "a".repeat(64),
  createTime: new Date(0),
  updateTime: new Date(0),
});
const heartbeat = () => ({ status: 1, time: "2026-10-14T00:00:00Z", msg: "ok", ping: 1 });
const response = () => ({
  data: [
    {
      categoryName: "Services",
      monitors: [
        { id: "1", name: "one", uptime: 99, status: 1, heartbeats: [heartbeat()] },
        { id: "2", name: "two", uptime: 90, status: 0, heartbeats: [heartbeat()] },
      ],
    },
  ],
  success: true,
  message: "Success",
});
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
  repository.configurationTarget.mockImplementation(async () => metadata());
  repository.hydrateConfiguration.mockResolvedValue({
    uptimeStatusUrl: "https://example.invalid/status",
    monitorNameMapping: null,
  });
  reports.fromConfiguration.mockResolvedValue(response());
  reports.getStatus.mockResolvedValue(response());
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
});
describe("native upstream monitoring resource authorization", () => {
  it("registers the fixed native endpoint and its resource types", () => {
    expect(getIamActionDefinition("quyan:relay:GetUptimeStatus")).toMatchObject({
      authorizationBoundary: "platform",
      resourceTypes: ["platform/relay-uptime-control", "platform/relay-uptime-monitor"],
    });
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-config.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find((route) => route.method === "getUptimeStatus"),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:GetUptimeStatus"], issues: [] });
  });
  it("uses a fixed server Action and filters each monitor independently", async () => {
    denied.add(platformRelayUptimeMonitorArn("2"));
    const req = request(),
      result = await service.read(req);
    expect(result.data[0]!.monitors.map((row) => row.id)).toEqual(["1"]);
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === "quyan:relay:GetUptimeStatus")).toBe(true);
    expect(reports.getStatus).not.toHaveBeenCalled();
    expect(req.iamDecisions?.length).toBeGreaterThan(0);
  });
  it("denies the collection before metadata hydration or an outbound request", async () => {
    denied.add(platformRelayUptimeArn());
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.configurationTarget).not.toHaveBeenCalled();
    expect(reports.fromConfiguration).not.toHaveBeenCalled();
  });
  it("does not reveal categories with no admitted monitors", async () => {
    denied.add(platformRelayUptimeMonitorArn("1"));
    denied.add(platformRelayUptimeMonitorArn("2"));
    expect((await service.read(request())).data).toEqual([]);
  });
  it("does not project invalid heartbeat payloads for denied monitors", async () => {
    const raw = response();
    raw.data[0]!.monitors[1]!.heartbeats[0]!.ping = Number.NaN;
    reports.fromConfiguration.mockResolvedValue(raw);
    denied.add(platformRelayUptimeMonitorArn("2"));
    expect((await service.read(request())).data[0]!.monitors).toHaveLength(1);
  });
  it("rejects malformed admitted monitor payloads without exposing the provider data", async () => {
    const raw = response();
    raw.data[0]!.monitors[0]!.heartbeats[0]!.ping = Number.NaN;
    reports.fromConfiguration.mockResolvedValue(raw);
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["source", "group", "policy", "decision"])("rechecks %s changes after the outbound request", async (kind) => {
    reports.fromConfiguration.mockImplementationOnce(async () => {
      if (kind === "source")
        repository.configurationTarget.mockResolvedValue({ ...metadata(), revision: "b".repeat(64) });
      if (kind === "group") snapshots.recheck.mockRejectedValue(new Error("fixture group revoked"));
      if (kind === "policy")
        iam.loadPolicies.mockResolvedValue([
          { document: { Version: "1", Statement: { Effect: "Deny", Action: "*", Resource: "*" } } },
        ]);
      if (kind === "decision") denied.add(platformRelayUptimeArn());
      return response();
    });
    await expect(service.read(request())).rejects.toThrow();
  });
  it("rechecks a previously allowed monitor if its condition expires", async () => {
    const original = iam.authorizeMany.getMockImplementation()!;
    let monitorCalls = 0;
    iam.authorizeMany.mockImplementation(async (input) => {
      if (input.resources.includes(platformRelayUptimeMonitorArn("1")) && ++monitorCalls > 1)
        denied.add(platformRelayUptimeMonitorArn("1"));
      return original(input);
    });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("batches more than 500 monitors and bounds request audit entries", async () => {
    reports.fromConfiguration.mockResolvedValue({
      ...response(),
      data: [
        {
          categoryName: "Services",
          monitors: Array.from({ length: 501 }, (_, i) => ({ id: String(i), name: "fixture", uptime: 99, status: 1 })),
        },
      ],
    });
    const req = request(),
      result = await service.read(req);
    expect(result.data[0]!.monitors).toHaveLength(501);
    expect(req.iamDecisions!.length).toBeLessThanOrEqual(500);
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.resources.length <= 500)).toBe(true);
  });
  it("never bootstraps a missing configuration through a read", async () => {
    repository.configurationTarget.mockResolvedValue({ ...metadata(), recordId: null, revision: "0".repeat(64) });
    repository.hydrateConfiguration.mockResolvedValue(null);
    reports.fromConfiguration.mockResolvedValue({ data: [], success: false, message: "No uptime data configured" });
    expect((await service.read(request())).success).toBe(false);
    expect(reports.fromConfiguration).toHaveBeenCalledExactlyOnceWith({});
    expect(reports.getStatus).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("retains %s behavior and sends a single monitoring request", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    denied.add(platformRelayUptimeArn());
    const result = await service.read(request());
    expect(result).toEqual(response());
    expect(reports.getStatus).toHaveBeenCalledOnce();
    expect(reports.fromConfiguration).not.toHaveBeenCalled();
    if (mode === "shadow") expect(logger.warn).toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("keeps legacy denial authoritative in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(reports.getStatus).not.toHaveBeenCalled();
  });
  it.each(["principal", "oauth", "mode", "qualification", "storage", "results"])(
    "fails closed for invalid %s",
    async (kind) => {
      const req = request();
      if (kind === "principal") delete req.user;
      if (kind === "oauth") req.oauthAccessToken = {} as never;
      if (kind === "mode") env.security.iamAuthorizationMode = "invalid" as never;
      if (kind === "qualification") snapshots.snapshot.mockRejectedValue(new Error("fixture unqualified"));
      if (kind === "storage")
        repository.configurationTarget.mockRejectedValue(new Error("fixture storage unavailable"));
      if (kind === "results") iam.authorizeMany.mockResolvedValue([]);
      await expect(service.read(req)).rejects.toThrow();
      expect(reports.fromConfiguration).not.toHaveBeenCalled();
    },
  );
});
describe("monitoring provider and static projection", () => {
  it("retains upstream precedence, mapping and the last 100 heartbeats", async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { heartbeatList: { "1": Array.from({ length: 101 }, heartbeat), "2": [] }, uptimeList: { "1_24": 99 } },
    });
    const result = await RelayUptimeService.getInstance().fromConfiguration({
      uptimeStatusUrl: "https://example.invalid/?token=fixture-secret",
      monitorNameMapping: { "1": "Primary" },
      showOnlyConfigured: true,
      uptimeStaticData: { categoryName: "Fallback", monitors: [] },
    });
    expect(result.data[0]!.monitors).toHaveLength(1);
    expect(result.data[0]!.monitors[0]!.heartbeats).toHaveLength(100);
    expect(result.data[0]!.monitors[0]!.name).toBe("Primary");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("fixture-secret");
  });
  it("keeps a configured static fallback on upstream failure without logging the URL or arbitrary error", async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error("fixture-secret"));
    const raw = { categoryName: "Static", monitors: [{ name: "Database", uptime: 100, status: 1 }] };
    const result = await RelayUptimeService.getInstance().fromConfiguration({
      uptimeStatusUrl: "https://example.invalid/?token=fixture-secret",
      uptimeStaticData: raw,
    });
    const targets = relayUptimeTargets(result),
      projected = projectRelayUptimeResponse(result, targets, new Set([targets[0]!.id]));
    expect(targets[0]!.id).toMatch(/^static_[a-f0-9]{64}$/);
    expect(projected.data[0]!.monitors[0]!.id).toBe(targets[0]!.id);
    expect(relayUptimeTargets(structuredClone(result))[0]!.id).toBe(targets[0]!.id);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("fixture-secret");
  });
  it.each(["*", "../1", "1/2", "1:2", "bad\n"])("rejects unsafe monitor identifiers: %j", (id) => {
    const result = response();
    result.data[0]!.monitors[0]!.id = id;
    expect(() => relayUptimeTargets(result)).toThrow();
    expect(() => platformRelayUptimeMonitorArn(id)).toThrow();
  });
  it("returns only registered monitoring fields rather than arbitrary static JSON", () => {
    const raw = response();
    Object.assign(raw.data[0]!.monitors[0]!, {
      apiKey: "fixture-secret",
      providerConfig: { password: "fixture-secret" },
    });
    const targets = relayUptimeTargets(raw),
      result = projectRelayUptimeResponse(raw, targets, new Set(["1"]));
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
  });
  it("rejects duplicate monitor identities instead of merging resource grants", () => {
    const result = response();
    result.data[0]!.monitors[1]!.id = "1";
    expect(() => relayUptimeTargets(result)).toThrow();
  });
});
