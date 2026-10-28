import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/services/billing/redemption-code.service", () => ({ RedemptionCodeService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformRedemptionCodeReadIamService } from "@/services/billing/platform-redemption-code-read-iam.service";
import {
  platformRedemptionCodeArn,
  platformRedemptionCodeCollectionArn,
  isRedemptionCodeResourceId,
} from "@/iam/resources/platform-redemption-code-resources";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { scan: vi.fn(), recheck: vi.fn(), hydrate: vi.fn() },
  legacy = { listCodes: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformRedemptionCodeReadIamService(iam, snapshots, repository, legacy, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    secure: true,
    ip: "192.0.2.1",
  }) as unknown as TypedRequest;
const target = (id: string) => ({
  id,
  status: 1,
  createTime: new Date(0),
  updateTime: new Date(0),
  revision: "a".repeat(64),
});
const payload = (id: string) => ({
  ...target(id),
  code: "fixture-secret-" + id,
  amount: 10,
  createdBy: "owner",
  usedBy: null,
  usedAt: null,
  expiresAt: null,
  createdByUser: { username: "fixture" },
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
  repository.scan.mockResolvedValue([target("code-a"), target("code-b")]);
  repository.recheck.mockImplementation(async (_p, rows) => rows);
  repository.hydrate.mockImplementation(async (_p, rows) => rows.map((row: { id: string }) => payload(row.id)));
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.listCodes.mockResolvedValue({ total: 0, page: 1, pageSize: 20, records: [] });
});
describe("platform redemption resource reads", () => {
  it("hydrates only authorized page and returns authorized count", async () => {
    denied.add(platformRedemptionCodeArn("code-a"));
    expect(await service.list(request(), { pageSize: 1 })).toMatchObject({
      total: 1,
      records: [{ id: "code-b", code: "fixture-secret-code-b" }],
    });
    expect(repository.hydrate.mock.calls[0]![1].map((row: { id: string }) => row.id)).toEqual(["code-b"]);
  });
  it("checks the collection before scanning or hydrating secrets", async () => {
    denied.add(platformRedemptionCodeCollectionArn());
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scan).not.toHaveBeenCalled();
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("can return an authorized empty collection", async () => {
    denied.add(platformRedemptionCodeArn("code-a"));
    denied.add(platformRedemptionCodeArn("code-b"));
    expect(await service.list(request())).toMatchObject({ total: 0, records: [] });
  });
  it("does not let a forged header change the server action", async () => {
    await service.list(request());
    expect(iam.authorizeMany.mock.calls.every(([args]) => args.action === "quyan:redemption_code:ListCodes")).toBe(
      true,
    );
  });
  it.each([{ page: 0 }, { page: 10001 }, { pageSize: 101 }, { pageSize: 1.1 }])(
    "rejects invalid pagination %j",
    async (params) => {
      await expect(service.list(request(), params)).rejects.toMatchObject({ statusCode: 400 });
      expect(repository.scan).not.toHaveBeenCalled();
    },
  );
  it("fails closed on missing principal", async () => {
    await expect(service.list({} as TypedRequest)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed on OAuth identity or impersonation mismatch", async () => {
    const req = request();
    req.oauthAccessToken = {} as never;
    await expect(service.list(req)).rejects.toMatchObject({ statusCode: 403 });
    const mismatched = request();
    mismatched.authContext!.principalUserId = "another";
    await expect(service.list(mismatched)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks final contributing grants for date or policy changes", async () => {
    repository.hydrate.mockImplementation(async (_p, rows) => {
      denied.add(platformRedemptionCodeArn(rows[0].id));
      return rows.map((row: { id: string }) => payload(row.id));
    });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a content revision change even when timestamps are unchanged", async () => {
    repository.recheck.mockImplementation(async (_p, rows) =>
      rows.map((row: { revision: string }) => ({ ...row, revision: "b".repeat(64) })),
    );
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("does not disguise metadata/backend failure as an empty success", async () => {
    repository.scan.mockRejectedValue(new Error("fixture-unavailable"));
    await expect(service.list(request())).rejects.toThrow("fixture-unavailable");
  });
  it.each([
    [[target("code-b"), target("code-a")]],
    [[target("code-a"), target("code-a")]],
    [[{ ...target("code-a"), status: 0 }]],
    [[{ ...target("code-a"), revision: "bad" }]],
  ])("rejects malformed or non-progressing scans %#", async (rows) => {
    repository.scan.mockResolvedValue(rows);
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects hydration of an unapproved or duplicate row", async () => {
    repository.hydrate.mockResolvedValue([payload("extra"), payload("extra")]);
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("handles multiple bounded scan pages and hydrates only the selected page", async () => {
    const first = Array.from({ length: 500 }, (_, i) => target("code-" + String(i).padStart(4, "0")));
    repository.scan.mockResolvedValueOnce(first).mockResolvedValueOnce([target("code-0500")]);
    expect(await service.list(request(), { page: 2, pageSize: 100 })).toMatchObject({
      total: 501,
      records: expect.any(Array),
    });
    expect(repository.hydrate.mock.calls[0]![1]).toHaveLength(100);
    expect(repository.scan.mock.calls[1]![1]).toBe("code-0499");
    expect(iam.authorizeMany.mock.calls.every(([args]) => args.resources.length <= 500)).toBe(true);
  });
  it.each(["legacy", "shadow"] as const)("preserves %s legacy response and calls it once", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    denied.add(platformRedemptionCodeCollectionArn());
    expect(await service.list(request())).toMatchObject({ pageSize: 20, total: 0 });
    expect(legacy.listCodes).toHaveBeenCalledTimes(1);
  });
  it("requires legacy permission in legacy mode", async () => {
    env.security.iamAuthorizationMode = "legacy";
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.list(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy.listCodes).not.toHaveBeenCalled();
  });
  it.each(["bad/id", "bad\n", "*", "", " spaced"])("rejects unsafe resource identifiers %j", (id) => {
    expect(isRedemptionCodeResourceId(id)).toBe(false);
    expect(() => platformRedemptionCodeArn(id)).toThrow();
  });
  it("declares a server-side collection action on the route", () => {
    const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/billing/redemption-code.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.controller === "RedemptionCodeController" && row.method === "listCodes",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:redemption_code:ListCodes"], resourceKind: "collection" });
  });
});
