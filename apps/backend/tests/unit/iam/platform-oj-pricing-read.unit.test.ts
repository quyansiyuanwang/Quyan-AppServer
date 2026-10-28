import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/oj-submitter/platform-oj-pricing-read.repository", () => ({
  PlatformOjPricingReadRepository: { getInstance: vi.fn() },
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
import { PlatformOjPricingReadIamService } from "@/services/oj-submitter/platform-oj-pricing-read-iam.service";
import { PlatformOjPricingReadRepository } from "@/store/oj-submitter/platform-oj-pricing-read.repository";
import { platformOjPricingArn } from "@/iam/resources/platform-oj-pricing-resources";
import { platformOjPricingDetailResource } from "@/iam/request/platform-oj-pricing-resource-resolvers";
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
let service: PlatformOjPricingReadIamService, iam: any, repo: any, identities: any, request: TypedRequest;
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
  service = new (PlatformOjPricingReadIamService as unknown as new (...args: any[]) => PlatformOjPricingReadIamService)(
    iam,
    repo,
    identities,
  );
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { model: "provider/a" },
    headers: { "x-action": "*" },
  } as unknown as TypedRequest;
});
describe("platform OJ pricing resource reads", () => {
  it("filters pricing metadata before hydration and preserves descending creation order", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((r: string) => (r.endsWith("/a") ? deny : allow)),
    );
    expect(await service.list(request, (rows) => rows.map((r) => r.id))).toEqual(["b"]);
    expect(repo.hydrate.mock.calls[0][1].map((t: any) => t.id)).toEqual(["b"]);
  });
  it("uses record IDs rather than model names in resources and denies unresolved details", async () => {
    expect(await service.detail("provider/a", request, (row) => row.id)).toBe("a");
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:oj:GetPricing", resources: [platformOjPricingArn("a")] }),
    );
    repo.target.mockResolvedValue(null);
    repo.hydrate.mockClear();
    await expect(service.detail("provider/missing", request, (row) => row)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("rejects incomplete decisions and corrupted or duplicate hydration", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.list(request, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeMany.mockImplementation(async ({ resources }: any) => resources.map(() => allow));
    repo.hydrate.mockResolvedValue([target("a"), target("a")]);
    await expect(service.list(request, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("withholds detail if the requested model is rebound or removed after authorization", async () => {
    repo.target.mockResolvedValueOnce(target("a")).mockResolvedValueOnce(null);
    await expect(service.detail("provider/a", request, (row) => row)).rejects.toMatchObject({ statusCode: 403 });
    repo.target.mockResolvedValueOnce(target("a")).mockResolvedValueOnce({ ...target("a"), model: "provider/other" });
    await expect(service.detail("provider/a", request, (row) => row)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("reevaluates grants after DTO projection and does not return stale rows", async () => {
    await expect(
      service.list(request, (rows) => {
        iam.authorizeMany.mockResolvedValue([deny, deny]);
        return rows;
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("handles more than one policy evaluation batch and rejects out-of-order metadata", async () => {
    const targets = Array.from({ length: 501 }, (_, i) => target("id-" + String(i).padStart(4, "0")));
    repo.scan.mockResolvedValueOnce(targets.slice(0, 500)).mockResolvedValueOnce(targets.slice(500));
    const result = await service.list(request, (rows) => rows.map((r) => r.id));
    expect(result).toHaveLength(501);
    expect(result![0]).toBe("id-0500");
    repo.scan.mockResolvedValue([target("b"), target("a")]);
    await expect(service.list(request, (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shadow never hydrates a second price list and rejects malformed model input", async () => {
    const project = vi.fn();
    await service.list(request, project, false);
    await service.detail("provider/a", request, project, false);
    expect(repo.hydrate).not.toHaveBeenCalled();
    expect(project).not.toHaveBeenCalled();
    await expect(service.detail("", request, project)).rejects.toMatchObject({ statusCode: 400 });
  });
  it("declares fixed Actions and resolves only the trusted database record", async () => {
    vi.mocked(PlatformOjPricingReadRepository.getInstance).mockReturnValue(repo);
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    expect(await platformOjPricingDetailResource({ request, principal })).toBe(platformOjPricingArn("a"));
    repo.target.mockResolvedValue(null);
    expect(await platformOjPricingDetailResource({ request, principal })).toBeUndefined();
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/oj-submitter/oj-pricing.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    expect(routes.find((r) => r.method === "listPricing")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:oj:ListPricing"],
      issues: [],
    });
    expect(routes.find((r) => r.method === "getPricing")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:oj:GetPricing"],
      issues: [],
    });
  });
});
