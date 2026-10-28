import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/relay/platform-model-pricing-read.repository", () => ({
  PlatformModelPricingReadRepository: { getInstance: vi.fn() },
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
import { PlatformModelPricingReadIamService } from "@/services/relay/platform-model-pricing-read-iam.service";
import { platformModelPricingArn } from "@/iam/resources/platform-model-pricing-resources";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { ...allow, decision: "ExplicitDeny" };
const target = (id: string) => ({
  id,
  status: 1,
  model: "provider/" + id,
  createTime: new Date(0),
  updateTime: new Date(0),
});
let service: PlatformModelPricingReadIamService, iam: any, repo: any, identities: any, request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  iam = {
    loadPolicies: vi.fn(),
    authorizeMany: vi.fn().mockImplementation(async ({ resources }) => resources.map(() => allow)),
  };
  repo = {
    scan: vi.fn().mockResolvedValue([target("a"), target("b")]),
    target: vi.fn().mockResolvedValue(target("a")),
    hydrate: vi
      .fn()
      .mockImplementation(async (_p, targets) => targets.map((t: any) => ({ ...t, inputPrice: 1, outputPrice: 2 }))),
    recheck: vi.fn().mockImplementation(async (_p, targets) => targets),
  };
  identities = {
    snapshot: vi.fn().mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] }),
    recheck: vi.fn(),
  };
  service = new (PlatformModelPricingReadIamService as unknown as new (
    ...args: any[]
  ) => PlatformModelPricingReadIamService)(iam, repo, identities);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { model: "provider/a" },
    headers: { "x-action": "*" },
  } as unknown as TypedRequest;
});
describe("platform model pricing export", () => {
  it("authorizes each actual ID and only hydrates visible prices", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((resource: string) => (resource === platformModelPricingArn("b") ? deny : allow)),
    );
    const result = await service.list(request, (rows) => rows.map((r) => r.id));
    expect(result).toEqual(["a"]);
    expect(repo.hydrate.mock.calls.flatMap((call: any) => call[1].map((t: any) => t.id))).toEqual(["a"]);
    expect(iam.authorizeMany.mock.calls.every((c: any) => c[0].action === "quyan:model_pricing:ExportModels")).toBe(
      true,
    );
  });
  it("requires a principal and rejects OAuth or impersonation", async () => {
    for (const req of [
      {},
      { ...request, oauthAccessToken: {} },
      { ...request, authContext: { principalUserId: "other", accountOwnerId: "owner" } },
    ])
      await expect(service.list(req as TypedRequest, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.scan).not.toHaveBeenCalled();
  });
  it("rejects incomplete decisions and duplicate hydrated records", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.list(request, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeMany.mockImplementation(async ({ resources }: any) => resources.map(() => allow));
    repo.hydrate.mockResolvedValue([target("a"), target("a")]);
    await expect(service.list(request, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("withholds prices if a decision is revoked after projection", async () => {
    await expect(
      service.list(request, (rows) => {
        iam.authorizeMany.mockImplementation(async ({ resources }: any) => resources.map(() => deny));
        return rows;
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("withholds changed or removed records after hydration", async () => {
    repo.recheck.mockResolvedValue([target("a")]);
    await expect(service.list(request, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
    repo.recheck.mockResolvedValue([{ ...target("a"), model: "changed" }, target("b")]);
    await expect(service.list(request, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("evaluates more than one batch and sorts exports by model", async () => {
    const targets = Array.from({ length: 501 }, (_, i) => target("id-" + String(i).padStart(4, "0")));
    repo.scan.mockResolvedValueOnce(targets.slice(0, 500)).mockResolvedValueOnce(targets.slice(500));
    const result = await service.list(request, (rows) => rows.map((r) => r.id));
    expect(result).toHaveLength(501);
    expect(result![0]).toBe("id-0000");
    expect(result![500]).toBe("id-0500");
  });
  it("rejects unordered scan results rather than silently skipping resources", async () => {
    repo.scan.mockResolvedValue([target("b"), target("a")]);
    await expect(service.list(request, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shadow scans and evaluates without hydrating or projecting the export", async () => {
    const project = vi.fn();
    await service.list(request, project, false);
    expect(repo.hydrate).not.toHaveBeenCalled();
    expect(project).not.toHaveBeenCalled();
    expect(identities.recheck).toHaveBeenCalled();
  });
  it("keeps the public list public and declares a fixed export action", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/model-pricing.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    expect(routes.find((r) => r.method === "exportModelPricing")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:model_pricing:ExportModels"],
      issues: [],
    });
    expect(routes.find((r) => r.method === "getModelPricing")?.security).toEqual([]);
  });
});
