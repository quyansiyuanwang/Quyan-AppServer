vi.mock("@/store/content/platform-legal-policy-publication.repository", () => ({
  PlatformLegalPolicyPublicationRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/content/platform-legal-policy-write.repository", () => ({
  PlatformLegalPolicyWriteRepository: { getInstance: vi.fn() },
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/content/platform-legal-policy-read.repository", () => ({
  PlatformLegalPolicyReadRepository: { getInstance: vi.fn() },
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
import { PlatformLegalPolicyReadIamService } from "@/services/legal-policy/platform-legal-policy-read-iam.service";
import { PlatformLegalPolicyReadRepository } from "@/store/content/platform-legal-policy-read.repository";
import { platformLegalPolicyDetailResource } from "@/iam/request/platform-legal-policy-resource-resolvers";
import { platformLegalPolicyArn } from "@/iam/resources/platform-legal-policy-resources";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { ...allow, decision: "ExplicitDeny" };
const target = (id: string, version = 1) => ({
  id,
  policyType: "terms_of_service",
  version,
  status: 1,
  createTime: new Date(0),
  updateTime: new Date(0),
});
let service: PlatformLegalPolicyReadIamService, iam: any, repo: any, identities: any, request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  iam = {
    loadPolicies: vi.fn(),
    authorizeMany: vi.fn().mockImplementation(async ({ resources }) => resources.map(() => allow)),
  };
  repo = {
    scan: vi.fn().mockResolvedValue([target("a", 1), target("b", 2)]),
    target: vi.fn().mockResolvedValue(target("a")),
    summaries: vi.fn().mockImplementation(async (_p, targets) => targets.map((t: any) => ({ ...t, title: "fixture" }))),
    detail: vi.fn().mockResolvedValue({ ...target("a"), content: "fixture private draft" }),
    recheck: vi.fn().mockImplementation(async (_p, targets) => targets),
  };
  identities = {
    snapshot: vi.fn().mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] }),
    recheck: vi.fn(),
  };
  service = new (PlatformLegalPolicyReadIamService as unknown as new (
    ...args: any[]
  ) => PlatformLegalPolicyReadIamService)(iam, repo, identities);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { id: "a" },
    headers: { "x-action": "*", "x-account-id": "foreign" },
  } as unknown as TypedRequest;
});
describe("platform legal policy read authorization", () => {
  it("filters metadata before loading summaries and preserves policy type/version ordering", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((r: string) => (r.endsWith("/a") ? deny : allow)),
    );
    const project = vi.fn().mockImplementation(async (rows) => rows.map((r: any) => r.id));
    expect(await service.list(request, project)).toEqual(["b"]);
    expect(repo.summaries.mock.calls[0][1].map((t: any) => t.id)).toEqual(["b"]);
    expect(repo.detail).not.toHaveBeenCalled();
  });
  it("returns an empty filtered list without loading forbidden content", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: any) => resources.map(() => deny));
    expect(await service.list(request, async (rows) => rows)).toEqual([]);
    expect(repo.summaries).not.toHaveBeenCalled();
    expect(repo.detail).not.toHaveBeenCalled();
  });
  it("checks existing versions before loading content and projects only after Allow", async () => {
    expect(await service.detail("a", request, async (row) => row.content)).toBe("fixture private draft");
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:legal_policy:GetVersion", resources: [platformLegalPolicyArn("a")] }),
    );
    expect(repo.detail).toHaveBeenCalledOnce();
  });
  it("refuses unresolved and denied details before content hydration", async () => {
    repo.target.mockResolvedValueOnce(null);
    await expect(service.detail("missing", request, async (row) => row.content)).rejects.toMatchObject({
      statusCode: 403,
    });
    iam.authorizeMany.mockResolvedValue([deny]);
    await expect(service.detail("a", request, async (row) => row.content)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.detail).not.toHaveBeenCalled();
  });
  it("fails closed on incomplete decisions and duplicate or stale hydration", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.list(request, async (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeMany.mockImplementation(async ({ resources }: any) => resources.map(() => allow));
    repo.summaries.mockResolvedValue([target("a"), target("a")]);
    await expect(service.list(request, async (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
    repo.detail.mockResolvedValue({ ...target("a"), updateTime: new Date(1) });
    await expect(service.detail("a", request, async (row) => row)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks grants and records after DTO projection", async () => {
    await expect(
      service.list(request, async (rows) => {
        repo.recheck.mockResolvedValue([]);
        return rows;
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    repo.recheck.mockImplementation(async (_p: any, targets: any) => targets);
    await expect(
      service.detail("a", request, async (row) => {
        iam.authorizeMany.mockResolvedValue([deny]);
        return row;
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("scans later batches and rejects a corrupt cursor instead of silently returning partial data", async () => {
    const targets = Array.from({ length: 501 }, (_, i) => target("v-" + String(i).padStart(4, "0"), i + 1));
    repo.scan.mockResolvedValueOnce(targets.slice(0, 500)).mockResolvedValueOnce(targets.slice(500));
    const rows = await service.list(request, async (rows) => rows.map((r) => r.id));
    expect(rows).toHaveLength(501);
    expect(rows![0]).toBe("v-0500");
    expect(repo.scan.mock.calls[1][1]).toBe("v-0499");
    repo.scan.mockResolvedValue([target("b"), target("a")]);
    await expect(service.list(request, async (rows) => rows)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shadow checks never load a second set of content or invoke DTO projections", async () => {
    const project = vi.fn();
    await service.list(request, project, false);
    await service.detail("a", request, project, false);
    expect(repo.summaries).not.toHaveBeenCalled();
    expect(repo.detail).not.toHaveBeenCalled();
    expect(project).not.toHaveBeenCalled();
  });
  it("resolves resources using trusted records and declares both fixed native routes", async () => {
    vi.mocked(PlatformLegalPolicyReadRepository.getInstance).mockReturnValue(repo);
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    expect(await platformLegalPolicyDetailResource({ request, principal })).toBe(platformLegalPolicyArn("a"));
    repo.target.mockResolvedValue(null);
    expect(await platformLegalPolicyDetailResource({ request, principal })).toBeUndefined();
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/legal-policy/legal-policy.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    expect(routes.find((r) => r.method === "listPolicies")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:legal_policy:ListVersions"],
      issues: [],
    });
    expect(routes.find((r) => r.method === "getPolicy")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:legal_policy:GetVersion"],
      issues: [],
    });
  });
});
