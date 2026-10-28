import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/relay/platform-model-pricing-write.repository", () => ({
  PlatformModelPricingWriteRepository: { getInstance: vi.fn() },
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
import { Permission, getIamActionDefinition } from "@quyan/shared";
import { PlatformModelPricingWriteIamService } from "@/services/relay/platform-model-pricing-write-iam.service";
import {
  platformModelPricingArn,
  platformModelPricingCollectionArn,
} from "@/iam/resources/platform-model-pricing-resources";

import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
let service: PlatformModelPricingWriteIamService, iam: any, repo: any, identities: any, request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  iam = { authorize: vi.fn().mockResolvedValue(allow) };
  repo = {
    create: vi.fn().mockResolvedValue({ id: "entry" }),
    update: vi.fn().mockResolvedValue({ id: "entry" }),
    remove: vi.fn().mockResolvedValue(true),
    target: vi.fn().mockResolvedValue({ id: "entry", model: "provider/model:v1", status: 1, updateTime: new Date(0) }),
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
  service = new (PlatformModelPricingWriteIamService as unknown as new (
    ...args: any[]
  ) => PlatformModelPricingWriteIamService)(iam, repo, identities);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "quyan:model_pricing:DeletePricing" },
  } as unknown as TypedRequest;
});
import { importModelPricingBodySchema, MODEL_PRICING_IMPORT_MAX_ITEMS } from "@/api/schema/relay/model-pricing.schema";
const models = [
  { model: "a", inputPrice: 1, outputPrice: 2 },
  { model: "b", inputPrice: 3, outputPrice: 4 },
];
describe("platform model pricing import authorization", () => {
  beforeEach(() => {
    iam.authorizeMany = vi.fn().mockImplementation(async ({ resources }: any) => resources.map(() => allow));
    repo.prepareImport = vi
      .fn()
      .mockResolvedValue([{ id: "existing", model: "a", status: 1, updateTime: new Date(0) }, null]);
    repo.importModels = vi.fn().mockResolvedValue({ created: 1, updated: 1, total: 2, recordIds: ["existing", "new"] });
  });
  it("uses a fixed batch action and validates both control and existing resource IDs", async () => {
    const receipt = await service.importModels(models, "actor", request);
    expect(receipt).toMatchObject({ total: 2 });
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:model_pricing:ImportPricing",
        resource: platformModelPricingCollectionArn(),
      }),
    );
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:model_pricing:ImportPricing",
        resources: [platformModelPricingArn("existing")],
      }),
    );
    const guard = repo.importModels.mock.calls[0][2];
    await guard.recheckEntries(["existing", "new"]);
    expect(iam.authorizeMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ resources: [platformModelPricingArn("existing"), platformModelPricingArn("new")] }),
    );
  });
  it("rejects any denied resource and never drops it from the batch", async () => {
    iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny" }]);
    await expect(service.importModels(models, "actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.importModels).not.toHaveBeenCalled();
  });
  it("rejects a denied control boundary before a write", async () => {
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
    await expect(service.importModels(models, "actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.importModels).not.toHaveBeenCalled();
  });
  it("fails closed on incomplete target projections or IAM decisions", async () => {
    repo.prepareImport.mockResolvedValue([]);
    await expect(service.importModels(models, "actor", request)).rejects.toMatchObject({ statusCode: 403 });
    repo.prepareImport.mockResolvedValue([{ id: "existing", model: "a", updateTime: new Date(0) }, null]);
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.importModels(models, "actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.importModels).not.toHaveBeenCalled();
  });
  it("rejects empty, oversized, duplicate and unknown-field input before lookup", async () => {
    const invalid = [
      [],
      [...models, models[0]],
      [{ ...models[0], accountOwnerId: "other" }],
      Array.from({ length: MODEL_PRICING_IMPORT_MAX_ITEMS + 1 }, (_, i) => ({ ...models[0], model: String(i) })),
    ];
    for (const input of invalid)
      await expect(service.importModels(input, "actor", request)).rejects.toMatchObject({ statusCode: 400 });
    expect(repo.prepareImport).not.toHaveBeenCalled();
    expect(repo.importModels).not.toHaveBeenCalled();
    expect(
      importModelPricingBodySchema.safeParse({ models: [{ ...models[0], model: " a " }, models[0]] }).success,
    ).toBe(false);
    expect(importModelPricingBodySchema.safeParse({ models, extra: true }).success).toBe(false);
  });
  it("checks identity and forbids actor spoofing and OAuth tokens", async () => {
    await expect(service.importModels(models, "other", request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.importModels(models, "actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.importModels(models, "actor", { ...request, oauthAccessToken: {} } as TypedRequest),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.prepareImport).not.toHaveBeenCalled();
  });
  it("shadow evaluates all existing resources without invoking a write", async () => {
    await service.importModels(models, "actor", request, false);
    expect(iam.authorizeMany).toHaveBeenCalled();
    expect(identities.recheck).toHaveBeenCalled();
    expect(repo.importModels).not.toHaveBeenCalled();
  });
  it("rejects a model rebind in the prepared projection", async () => {
    repo.prepareImport.mockResolvedValue([{ id: "existing", model: "other", updateTime: new Date(0) }, null]);
    await expect(service.importModels(models, "actor", request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("registers an explicit batch route and platform action", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/model-pricing.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    expect(routes.find((r) => r.method === "importModelPricing")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:model_pricing:ImportPricing"],
      resourceKind: "batch",
      issues: [],
    });
    expect(getIamActionDefinition("quyan:model_pricing:ImportPricing")).toMatchObject({
      authorizationBoundary: "platform",
      legacyPermission: Permission.MODEL_PRICING_UPDATE,
    });
  });
});
