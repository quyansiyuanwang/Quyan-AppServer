import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/developer/platform-developer-usage-read.repository", () => ({
  PlatformDeveloperUsageReadRepository: { getInstance: vi.fn() },
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
import { PlatformDeveloperUsageReadIamService } from "@/services/developer/platform-developer-usage-read-iam.service";
import { platformDeveloperAccountArn } from "@/iam/resources/platform-developer-account-resources";
import { toDatabaseDate } from "@/util/database-date";
import { getIamActionDefinition } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
const target = {
  id: "entry",
  productCode: "kv",
  status: 1,
  accountOwnerId: "target-owner",
  createTime: new Date(0),
  updateTime: new Date(0),
  accountOwner: { id: "target-owner", status: 1, userType: "root", accountOwnerId: null, updateTime: new Date(0) },
};
const data = () => ({
  account: { ...target, dailyFreeQuota: null, instanceLimit: 2, overageEnabled: true },
  config: {
    id: "config",
    productCode: "kv",
    status: 1,
    defaultDailyQuota: 100,
    overagePrice: 1,
    updateTime: new Date(0),
  },
  usages: [
    {
      id: "counter",
      status: 1,
      entitlementId: "entry",
      usageDate: toDatabaseDate(),
      requestCount: 30,
      updateTime: new Date(0),
    },
  ],
});
let service: PlatformDeveloperUsageReadIamService, iam: any, repo: any, identities: any, request: TypedRequest;
beforeEach(() => {
  vi.clearAllMocks();
  iam = { authorize: vi.fn().mockResolvedValue(allow) };
  repo = { target: vi.fn().mockResolvedValue(target), read: vi.fn().mockImplementation(async () => data()) };
  identities = {
    snapshot: vi.fn().mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] }),
    recheck: vi.fn(),
  };
  service = new (PlatformDeveloperUsageReadIamService as unknown as new (
    ...args: any[]
  ) => PlatformDeveloperUsageReadIamService)(iam, repo, identities);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
  } as unknown as TypedRequest;
});
describe("platform product account usage authorization", () => {
  it("authorizes the actual record before and after reading daily usage", async () => {
    expect(await service.get(request, "kv", { accountId: "entry" })).toEqual({
      entitlementId: "entry",
      productCode: "kv",
      requestCount: 30,
      dailyFreeQuota: 100,
      remainingFree: 70,
      unlimited: false,
      overageEnabled: true,
    });
    expect(iam.authorize).toHaveBeenCalledTimes(3);
    expect(
      iam.authorize.mock.calls.every(
        (c: any) =>
          c[0].action === "quyan:developer:GetProductAccountUsage" &&
          c[0].resource === platformDeveloperAccountArn("entry"),
      ),
    ).toBe(true);
  });
  it("resolves the user path to the same record and rejects rebound identifiers", async () => {
    await service.get(request, "kv", { userId: "target-owner" });
    await expect(service.get(request, "kv", { userId: "other" })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.get(request, "kv", { accountId: "other" })).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("does not load usage on %s", async (decision) => {
    iam.authorize.mockResolvedValue({ ...allow, decision });
    await expect(service.get(request, "kv", { accountId: "entry" })).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.read).not.toHaveBeenCalled();
  });
  it("rejects missing contexts, OAuth and ambiguous locators", async () => {
    for (const req of [
      {},
      { ...request, oauthAccessToken: {} },
      { ...request, authContext: { principalUserId: "other", accountOwnerId: "owner" } },
    ])
      await expect(service.get(req as TypedRequest, "kv", { accountId: "entry" })).rejects.toMatchObject({
        statusCode: 403,
      });
    await expect(
      service.get(request, "kv", { accountId: "entry", userId: "target-owner" } as any),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.read).not.toHaveBeenCalled();
  });
  it("withholds usage when counters or configuration change during the read", async () => {
    for (const changed of [
      { ...data(), config: { ...data().config, defaultDailyQuota: 77 } },
      { ...data(), usages: [{ ...data().usages[0], requestCount: 31 }] },
    ]) {
      repo.read.mockResolvedValueOnce(data()).mockResolvedValueOnce(changed);
      await expect(service.get(request, "kv", { accountId: "entry" })).rejects.toMatchObject({ statusCode: 403 });
    }
  });
  it("rejects invalid counter values, quotas and rebound owners", async () => {
    for (const invalid of [
      { ...data(), usages: [{ ...data().usages[0], requestCount: -1 }] },
      { ...data(), config: { ...data().config, overagePrice: -1 } },
      { ...data(), account: { ...data().account, accountOwnerId: "other" } },
    ]) {
      repo.read.mockResolvedValueOnce(invalid);
      await expect(service.get(request, "kv", { accountId: "entry" })).rejects.toMatchObject({ statusCode: 403 });
    }
  });
  it("retains unlimited and explicit account quota semantics", async () => {
    repo.read.mockResolvedValue({
      ...data(),
      account: { ...data().account, dailyFreeQuota: 15 },
      config: { ...data().config, overagePrice: 0 },
    });
    expect(await service.get(request, "kv", { accountId: "entry" })).toMatchObject({
      dailyFreeQuota: 15,
      remainingFree: 0,
      unlimited: true,
    });
  });
  it("shadow evaluates without reading counters or pricing", async () => {
    expect(await service.get(request, "kv", { accountId: "entry" }, false)).toBeUndefined();
    expect(repo.read).not.toHaveBeenCalled();
    expect(identities.recheck).toHaveBeenCalled();
  });
  it("rechecks policy after the final data snapshot", async () => {
    iam.authorize
      .mockResolvedValueOnce(allow)
      .mockResolvedValueOnce(allow)
      .mockResolvedValueOnce({ ...allow, decision: "ExplicitDeny" });
    await expect(service.get(request, "kv", { accountId: "entry" })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("declares fixed resource-level actions on both usage paths", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/developer/developer-product-admin.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const method of ["getUsage", "getManagedUsage"])
      expect(routes.find((r) => r.method === method)).toMatchObject({
        coverage: "explicit",
        actions: ["quyan:developer:GetProductAccountUsage"],
        resourceKind: "single-resource",
        issues: [],
      });
    expect(getIamActionDefinition("quyan:developer:GetProductAccountUsage")?.authorizationBoundary).toBe("platform");
  });
});
