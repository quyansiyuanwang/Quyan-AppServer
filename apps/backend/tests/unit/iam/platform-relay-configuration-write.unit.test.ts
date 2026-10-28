import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/relay/platform-relay-configuration-write.repository", () => ({
  PlatformRelayConfigurationWriteRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/relay/relay-config.service", () => ({ RelayConfigService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { env } from "@/config/env";
import { Permission, getIamActionDefinition } from "@quyan/shared";
import { PlatformRelayConfigurationWriteIamService } from "@/services/relay/platform-relay-configuration-write-iam.service";
import { platformRelayConfigurationArn } from "@/iam/resources/platform-relay-configuration-resources";
import {
  platformModelPricingArn,
  platformModelPricingCollectionArn,
} from "@/iam/resources/platform-model-pricing-resources";
import type { TypedRequest } from "@/types/express";
import type { RelayConfigurationWriteGuard } from "@/store/relay/platform-relay-configuration-write.store";
const action = "quyan:relay:UpdateConfiguration",
  iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { authorizationRevision: vi.fn(), prepare: vi.fn(), write: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = { updateRelayConfig: vi.fn(), logConfigurationUpdate: vi.fn() };
const service = new PlatformRelayConfigurationWriteIamService(iam, snapshots, repository, permissions, legacy);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    secure: true,
  }) as unknown as TypedRequest;
const metadata = (id: string) => ({
  id,
  status: 1,
  createTime: new Date(0),
  updateTime: new Date(0),
  revision: "a".repeat(64),
});
const rate = (model = "existing") => ({
  model,
  inputPrice: 1.25,
  outputPrice: 2.5,
  cacheCreationMultiplier: 1.25,
  cacheReadMultiplier: 0.1,
});
let target: any;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  target = {
    config: { ...metadata("config"), channelTopologyMode: "legacy" },
    prices: [
      { ...metadata("old"), model: "existing" },
      { ...metadata("omitted"), model: "deleted" },
    ],
  };
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", matchedStatements: [] })),
  );
  snapshots.snapshot.mockResolvedValue({
    group: { id: "global", updateTime: new Date(0) },
    users: [
      { id: "actor", updateTime: new Date(0) },
      { id: "owner", updateTime: new Date(0) },
    ],
  });
  snapshots.recheck.mockResolvedValue(undefined);
  repository.authorizationRevision.mockResolvedValue("b".repeat(64));
  repository.prepare.mockImplementation(async (models) => ({
    ...target,
    prices: models === undefined ? [] : target.prices,
  }));
  repository.write.mockResolvedValue({ id: "config", modelRates: [] });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.updateRelayConfig.mockResolvedValue({ id: "legacy", modelRates: [] });
  legacy.logConfigurationUpdate.mockResolvedValue(undefined);
});
describe("relay configuration write admission", () => {
  it("checks omitted records as well as incoming prices before persisting", async () => {
    await service.write({ maxConcurrency: 7, modelRates: [rate()] }, request());
    const resources = iam.authorizeMany.mock.calls.flatMap(([input]) => input.resources);
    expect(resources).toContain(platformRelayConfigurationArn());
    expect(resources).toContain(platformModelPricingArn("omitted"));
    expect(resources).toContain(platformModelPricingArn("old"));
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === action)).toBe(true);
    expect(snapshots.snapshot.mock.calls[0]![1]).toEqual([Permission.MODEL_PRICING_UPDATE]);
    expect(legacy.logConfigurationUpdate).toHaveBeenCalledOnce();
    expect(legacy.updateRelayConfig).not.toHaveBeenCalled();
  });
  it("refuses a denied omitted price before starting the transaction", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => ({
        decision: resource === platformModelPricingArn("omitted") ? "ExplicitDeny" : "Allow",
        matchedStatements: [],
      })),
    );
    await expect(service.write({ modelRates: [rate()] }, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.write).not.toHaveBeenCalled();
  });
  it("checks the creation boundary and allows a transaction to check generated IDs", async () => {
    await service.write({ modelRates: [rate("new")] }, request());
    const guard = repository.write.mock.calls[0]![3] as RelayConfigurationWriteGuard;
    await guard.requireResources([platformModelPricingArn("generated")]);
    expect(iam.authorizeMany.mock.calls.flatMap(([input]) => input.resources)).toContain(
      platformModelPricingCollectionArn(),
    );
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action, resources: [platformModelPricingArn("generated")] }),
    );
  });
  it("filters response prices using a separate read action", async () => {
    await service.write({}, request());
    const guard = repository.write.mock.calls[0]![3] as RelayConfigurationWriteGuard;
    iam.authorizeMany.mockImplementation(async ({ resources }) =>
      resources.map((resource: string) => ({
        decision: resource === platformModelPricingArn("old") ? "Allow" : "ExplicitDeny",
        matchedStatements: [],
      })),
    );
    expect([...(await guard.readablePricingIds(["old", "omitted"]))]).toEqual(["old"]);
    expect(iam.authorizeMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "quyan:relay:GetConfiguration" }),
    );
  });
  it("requires only the configuration resource when rates are omitted", async () => {
    await service.write({ maxConcurrency: 7 }, request());
    expect(iam.authorizeMany.mock.calls.flatMap(([input]) => input.resources)).toEqual([
      platformRelayConfigurationArn(),
      platformRelayConfigurationArn(),
    ]);
    expect(repository.write.mock.calls[0]![2]).toBeUndefined();
  });
  it("takes an immutable copy before awaiting authorization", async () => {
    const input = { maxConcurrency: 7, modelRates: [rate()] };
    snapshots.snapshot.mockImplementation(async () => {
      input.maxConcurrency = 99;
      input.modelRates[0]!.inputPrice = 99;
      return { group: { id: "global", updateTime: new Date(0) }, users: [] };
    });
    await service.write(input, request());
    expect(repository.write.mock.calls[0]![1].maxConcurrency).toBe(7);
    expect(repository.write.mock.calls[0]![2][0].inputPrice).toBe(1.25);
    expect(legacy.logConfigurationUpdate.mock.calls[0]![0].maxConcurrency).toBe(7);
  });
  it.each(["missing", "oauth", "impersonation"])("rejects %s before repository access", async (kind) => {
    const req = request();
    if (kind === "missing") req.authContext = undefined;
    if (kind === "oauth") req.oauthAccessToken = {} as never;
    if (kind === "impersonation") req.authContext!.principalUserId = "other";
    await expect(service.write({}, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.prepare).not.toHaveBeenCalled();
  });
  it.each(["duplicates", "formats", "fixed-price", "queue"])(
    "rejects invalid %s input before writing",
    async (kind) => {
      const input =
        kind === "duplicates"
          ? { modelRates: [rate("duplicate"), rate(" duplicate ")] }
          : kind === "formats"
            ? { modelRates: [{ ...rate(), supportedFormats: "invalid" }] }
            : kind === "fixed-price"
              ? { modelRates: [{ ...rate(), pricingType: "per-request" as const }] }
              : { maxConcurrency: 0 };
      await expect(service.write(input, request())).rejects.toMatchObject({ statusCode: 400 });
      expect(repository.write).not.toHaveBeenCalled();
    },
  );
  it("requires a qualified platform group before resolving targets", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("fixture unqualified"));
    await expect(service.write({}, request())).rejects.toThrow();
    expect(repository.prepare).not.toHaveBeenCalled();
  });
  it("refuses an invalid preparation result instead of falling back", async () => {
    repository.prepare.mockResolvedValue(null);
    await expect(service.write({}, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.write).not.toHaveBeenCalled();
  });
  it("rechecks authorization revisions through the transaction guard", async () => {
    await service.write({}, request());
    const guard = repository.write.mock.calls[0]![3] as RelayConfigurationWriteGuard;
    repository.authorizationRevision.mockResolvedValue("c".repeat(64));
    await expect(guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not emit a success audit for an unsuccessful transaction", async () => {
    repository.write.mockRejectedValue(new Error("fixture rollback"));
    await expect(service.write({}, request())).rejects.toThrow();
    expect(legacy.logConfigurationUpdate).not.toHaveBeenCalled();
  });
  it("rejects incomplete batches", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.write({}, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.write).not.toHaveBeenCalled();
  });
  it("admits more than 500 affected prices in bounded batches", async () => {
    target.prices = Array.from({ length: 501 }, (_, index) => ({
      ...metadata("price-" + index),
      model: "model-" + index,
    }));
    const req = request();
    await service.write({ modelRates: [] }, req);
    expect(repository.write).toHaveBeenCalledOnce();
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.resources.length <= 500)).toBe(true);
    expect(req.iamDecisions!.length).toBeLessThanOrEqual(500);
  });
  it.each(["legacy", "shadow"] as const)(
    "writes once through the legacy service in %s without a native transaction",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      expect(await service.write({}, request())).toEqual({ id: "legacy", modelRates: [] });
      expect(legacy.updateRelayConfig).toHaveBeenCalledOnce();
      expect(repository.write).not.toHaveBeenCalled();
    },
  );
  it("rejects an unknown mode instead of using legacy behavior", async () => {
    env.security.iamAuthorizationMode = "invalid" as never;
    await expect(service.write({}, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy.updateRelayConfig).not.toHaveBeenCalled();
  });
  it("declares the batch action while preserving code 2FA and replay protection", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      source = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-config.controller.ts");
    expect(
      collectIamRoutes([source], process.cwd()).find((route) => route.method === "updateRelayConfig"),
    ).toMatchObject({ coverage: "explicit", actions: [action], issues: [] });
    const method = source.getClassOrThrow("RelayConfigController").getMethodOrThrow("updateRelayConfig");
    expect(method.getDecorator("TwoFactorChallengeProtected")?.getText()).toContain('method: "code"');
    expect(
      method
        .getDecorators()
        .filter((decorator) => decorator.getName() === "Middlewares")
        .map((decorator) => decorator.getText())
        .join(),
    ).toContain("replayProtectionMiddleware");
    expect(getIamActionDefinition(action)).toMatchObject({
      accessLevel: "Write",
      authorizationBoundary: "platform",
      resourceTypes: ["platform/relay-configuration", "platform/model-pricing", "platform/model-pricing-control"],
    });
  });
});
