import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
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
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { env } from "@/config/env";
import { getIamActionDefinition, Permission } from "@quyan/shared";
import { PlatformRelayConfigurationReadIamService } from "@/services/relay/platform-relay-configuration-read-iam.service";
import type { RelayConfigurationReadTarget } from "@/store/relay/platform-relay-configuration-read.store";
import { platformRelayConfigurationArn } from "@/iam/resources/platform-relay-configuration-resources";
import { platformModelPricingArn } from "@/iam/resources/platform-model-pricing-resources";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:GetConfiguration";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { where: vi.fn(), scan: vi.fn(), hydrateConfiguration: vi.fn(), hydratePricing: vi.fn() },
  reports = { getRelayConfig: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformRelayConfigurationReadIamService(iam, snapshots, repository, reports, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    secure: true,
  }) as unknown as TypedRequest;
const row = (source: "config" | "pricing", recordId: string | null): RelayConfigurationReadTarget => ({
  id: source === "config" ? "config_default" : "pricing_" + recordId,
  source,
  recordId,
  revision: "a".repeat(64),
  status: 1,
  createTime: new Date(1000),
  updateTime: new Date(1000),
});
const prices = (targets: readonly RelayConfigurationReadTarget[]) =>
  targets.map((target) => ({
    id: target.recordId,
    status: 1,
    createTime: target.createTime,
    updateTime: target.updateTime,
    model: target.recordId,
    pricingType: "token-based",
    inputPrice: 1,
    outputPrice: 2,
    fixedPrice: null,
    cacheCreationMultiplier: 1.25,
    cacheReadMultiplier: 0.1,
    supportedFormats: null,
    provider: "fixture",
  }));
let rows: RelayConfigurationReadTarget[];
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  rows = [row("config", null), row("pricing", "a"), row("pricing", "b")];
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  snapshots.snapshot.mockResolvedValue({});
  snapshots.recheck.mockResolvedValue(undefined);
  repository.where.mockImplementation(async (value) => value);
  repository.scan.mockImplementation(async (_where, after, boundary) =>
    rows
      .filter(
        (value) =>
          (!after ||
            value.createTime < after.createTime ||
            (value.createTime.getTime() === after.createTime.getTime() && value.id < after.id)) &&
          (!boundary ||
            value.createTime < boundary.createTime ||
            (value.createTime.getTime() === boundary.createTime.getTime() && value.id <= boundary.id)),
      )
      .sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, 500)
      .map((value) => ({ ...value })),
  );
  repository.hydrateConfiguration.mockResolvedValue(null);
  repository.hydratePricing.mockImplementation(async (targets) => prices(targets));
  reports.getRelayConfig.mockResolvedValue({ legacy: true });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
});
describe("relay configuration read IAM", () => {
  it("filters prices by actual ARN and ignores a client action header", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => ({
        decision: resource === platformModelPricingArn("b") ? "ExplicitDeny" : "Allow",
        matchedStatements: [],
      })),
    );
    expect((await service.read(request())).modelRates.map((item) => item.model)).toEqual(["a"]);
    expect(
      repository.hydratePricing.mock.calls.flatMap(([targets]) =>
        targets.map((target: RelayConfigurationReadTarget) => target.recordId),
      ),
    ).toEqual(["a"]);
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === action)).toBe(true);
    expect(snapshots.snapshot.mock.calls[0]![1]).toEqual([Permission.MODEL_PRICING_UPDATE]);
  });
  it("configuration-only permission returns an empty model price list", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => ({
        decision: resource === platformRelayConfigurationArn() ? "Allow" : "ImplicitDeny",
        matchedStatements: [],
      })),
    );
    expect((await service.read(request())).modelRates).toEqual([]);
    expect(repository.hydratePricing).not.toHaveBeenCalled();
  });
  it("pricing-only permission cannot return configuration", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => ({
        decision: resource === platformRelayConfigurationArn() ? "ExplicitDeny" : "Allow",
        matchedStatements: [],
      })),
    );
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrateConfiguration).not.toHaveBeenCalled();
    expect(repository.hydratePricing).not.toHaveBeenCalled();
  });
  it.each(["missing", "oauth", "impersonation"])("rejects %s context before scanning", async (kind) => {
    const req = request();
    if (kind === "missing") req.authContext = undefined;
    if (kind === "oauth") req.oauthAccessToken = {} as never;
    if (kind === "impersonation") req.authContext!.principalUserId = "owner";
    await expect(service.read(req)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it("requires platform qualification before scanning", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("fixture unqualified"));
    await expect(service.read(request())).rejects.toThrow();
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it("does not use the legacy fallback when storage fails in enforce", async () => {
    repository.scan.mockRejectedValue(new Error("fixture database unavailable"));
    await expect(service.read(request())).rejects.toThrow();
    expect(reports.getRelayConfig).not.toHaveBeenCalled();
  });
  it("rejects invalid and incomplete authorization output", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydratePricing).not.toHaveBeenCalled();
  });
  it("discards projected data on qualification revocation", async () => {
    repository.hydratePricing.mockImplementation(async (targets) => {
      snapshots.recheck.mockRejectedValue(new Error("fixture revoked"));
      return prices(targets);
    });
    await expect(service.read(request())).rejects.toThrow();
  });
  it("discards projected data on a newly matching deny", async () => {
    repository.hydratePricing.mockImplementation(async (targets) => {
      iam.authorizeMany.mockImplementation(async ({ resources }) =>
        resources.map(() => ({ decision: "ExplicitDeny", matchedStatements: [] })),
      );
      return prices(targets);
    });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["config", "pricing"] as const)("detects changed %s content with unchanged timestamps", async (source) => {
    repository.hydratePricing.mockImplementation(async (targets) => {
      rows.find((value) => value.source === source)!.revision = "b".repeat(64);
      return prices(targets);
    });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects duplicate and foreign payload rows", async () => {
    repository.hydratePricing.mockImplementation(async (targets) => {
      const result = prices(targets);
      result[1] = result[0]!;
      return result;
    });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("scans more than 500 prices including the configuration cursor entry", async () => {
    rows = [
      row("config", null),
      ...Array.from({ length: 501 }, (_, index) => row("pricing", "id-" + String(index).padStart(4, "0"))),
    ];
    const result = await service.read(request());
    expect(result.modelRates).toHaveLength(501);
    expect(result.modelRates[0]!.model).toBe("id-0000");
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.resources.length <= 500)).toBe(true);
  });
  it.each(["legacy", "shadow"] as const)(
    "retains the original read once in %s without native payload reads",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      expect(await service.read(request())).toEqual({ legacy: true });
      expect(reports.getRelayConfig).toHaveBeenCalledOnce();
      expect(repository.hydrateConfiguration).not.toHaveBeenCalled();
      expect(repository.hydratePricing).not.toHaveBeenCalled();
    },
  );
  it("rejects an unknown mode", async () => {
    env.security.iamAuthorizationMode = "invalid" as never;
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(reports.getRelayConfig).not.toHaveBeenCalled();
  });
  it("registers the native route and both platform resource types", () => {
    expect(getIamActionDefinition(action)).toMatchObject({
      accessLevel: "Read",
      authorizationBoundary: "platform",
      resourceTypes: ["platform/relay-configuration", "platform/model-pricing"],
    });
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-config.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find((route) => route.method === "getRelayConfig"),
    ).toMatchObject({ coverage: "explicit", actions: [action], issues: [] });
  });
});
