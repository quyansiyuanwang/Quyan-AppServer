import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/oj-submitter/platform-oj-pricing-write.repository", () => ({
  PlatformOjPricingWriteRepository: { getInstance: vi.fn() },
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
import { PlatformOjPricingWriteIamService } from "@/services/oj-submitter/platform-oj-pricing-write-iam.service";
import { platformOjPricingArn, platformOjPricingCollectionArn } from "@/iam/resources/platform-oj-pricing-resources";

import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
let service: PlatformOjPricingWriteIamService, iam: any, repo: any, identities: any, request: TypedRequest;
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
  service = new (PlatformOjPricingWriteIamService as unknown as new (
    ...args: any[]
  ) => PlatformOjPricingWriteIamService)(iam, repo, identities);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "quyan:oj:DeletePricing" },
  } as unknown as TypedRequest;
});
const input = { model: "provider/model:v1", inputPrice: 1.25, outputPrice: 2.5 };
describe("platform OJ pricing write authorization", () => {
  it("uses a fixed creation boundary and checks the actual new record ARN", async () => {
    await service.create(input, "actor", request);
    const guard = repo.create.mock.calls[0][1];
    expect(guard.permission).toBe(Permission.OJ_PRICING_UPDATE);
    await guard.recheckEntry("entry");
    await guard.users.recheck();
    expect(iam.authorize.mock.calls.map((c: any) => [c[0].action, c[0].resource])).toEqual([
      ["quyan:oj:CreatePricing", platformOjPricingCollectionArn()],
      ["quyan:oj:CreatePricing", platformOjPricingArn("entry")],
      ["quyan:oj:CreatePricing", platformOjPricingCollectionArn()],
    ]);
  });
  it.each(["update", "delete"] as const)(
    "authorizes %s through actual IDs instead of model names",
    async (operation) => {
      await service.mutate(operation, input.model, { inputPrice: 3 }, "actor", request);
      expect(iam.authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          action: operation === "update" ? "quyan:oj:UpdatePricing" : "quyan:oj:DeletePricing",
          resource: platformOjPricingArn("entry"),
        }),
      );
      expect(operation === "update" ? repo.update : repo.remove).toHaveBeenCalled();
    },
  );
  it("rejects missing identity, OAuth and actor spoofing before mutation", async () => {
    for (const [actor, req] of [
      ["other", request],
      ["actor", undefined],
      ["actor", { ...request, oauthAccessToken: {} }],
    ] as const) {
      await expect(service.create(input, actor, req as TypedRequest)).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(repo.create).not.toHaveBeenCalled();
  });
  it.each([undefined, { decision: "ExplicitDeny" }, { decision: "ImplicitDeny" }])(
    "fails closed on unavailable or denied decisions: %j",
    async (result) => {
      iam.authorize.mockResolvedValue(result);
      await expect(service.create(input, "actor", request)).rejects.toMatchObject({ statusCode: 403 });
      expect(repo.create).not.toHaveBeenCalled();
    },
  );
  it("rejects missing and invalid target records without a write", async () => {
    repo.target.mockResolvedValue(null);
    await expect(service.mutate("delete", input.model, {}, "actor", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    repo.target.mockResolvedValue({ id: "unsafe/id" });
    await expect(service.mutate("update", input.model, {}, "actor", request)).rejects.toThrow();
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
  });
  it("shadow evaluates without calling a mutation repository", async () => {
    await service.create(input, "actor", request, false);
    await service.mutate("update", input.model, { outputPrice: 4 }, "actor", request, false);
    await service.mutate("delete", input.model, {}, "actor", request, false);
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
    expect(identities.recheck).toHaveBeenCalled();
  });
  it("does not permit a revoked identity or newly denied resource at commit recheck", async () => {
    await service.create(input, "actor", request);
    const guard = repo.create.mock.calls[0][1];
    identities.recheck.mockRejectedValueOnce(new Error("revoked"));
    await expect(guard.users.recheck()).rejects.toThrow("revoked");
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
    await expect(guard.recheckEntry("entry")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects unknown fields, negative prices and invalid model input", async () => {
    for (const data of [
      { ...input, accountId: "other" },
      { ...input, inputPrice: -1 },
      { ...input, model: "" },
    ])
      await expect(service.create(data, "actor", request)).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.mutate("update", input.model, { model: "changed" } as any, "actor", request),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });
  it("registers all write routes with fixed server actions and platform resource types", () => {
    expect(getIamResourceType(platformOjPricingCollectionArn())?.accountScope).toBe("platform");
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/oj-submitter/oj-pricing.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const operation of ["create", "update", "delete"]) {
      const action = "quyan:oj:" + operation[0].toUpperCase() + operation.slice(1) + "Pricing";
      expect(routes.find((r) => r.method === operation + "Pricing")).toMatchObject({
        coverage: "explicit",
        actions: [action],
      });
      expect(getIamActionDefinition(action)).toMatchObject({
        authorizationBoundary: "platform",
        legacyPermission: Permission.OJ_PRICING_UPDATE,
      });
    }
  });
});
