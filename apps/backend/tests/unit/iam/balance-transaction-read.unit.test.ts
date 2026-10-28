import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/billing/balance-transaction-management.repository", () => ({
  BalanceTransactionManagementRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { readFileSync } from "node:fs";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { BalanceTransactionIamService } from "@/services/billing/balance-transaction-iam.service";
import { balanceTransactionArn } from "@/iam/resources/balance-transaction-resources";
import { getIamActionDefinition } from "@quyan/shared";
import { BALANCE_TRANSACTION_POLICY } from "@/services/billing/balance-transaction-policy";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
let iam: any, repository: any, service: BalanceTransactionIamService, request: TypedRequest, rows: any[];
const emptyDisplay = () => ({ tokenNameMap: new Map(), usageDataMap: new Map(), transferDataMap: new Map() });
beforeEach(() => {
  rows = ["new", "middle", "old"].map((id, i) => ({
    id,
    userId: "peer",
    createTime: new Date(Date.now() - (i + 1) * 1000),
    updateTime: new Date(0),
    status: 1,
    relatedId: "usage-" + id,
    type: "api_usage",
    amount: -5,
  }));
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorizeMany: vi
      .fn()
      .mockImplementation(async ({ resources }: { resources: string[] }) => resources.map(() => allow)),
  };
  repository = {
    assertActor: vi.fn(),
    scan: vi.fn().mockResolvedValue(rows),
    hydrate: vi.fn().mockImplementation(async (_: unknown, selected: any[]) => selected),
    current: vi.fn().mockImplementation(async (_: unknown, selected: any[]) => selected),
    display: vi.fn().mockImplementation(async (_: unknown, selected: any[]) => ({
      ...emptyDisplay(),
      tokenNameMap: new Map(selected.map((row) => [row.relatedId, row.id === "middle" ? "different" : "selected"])),
    })),
  };
  service = new (BalanceTransactionIamService as unknown as new (...args: any[]) => BalanceTransactionIamService)(
    iam,
    repository,
  );
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
  } as unknown as TypedRequest;
});
describe("managed ledger resource filtering", () => {
  it("scans more than one authorization chunk without exposing a database page total", async () => {
    const large = Array.from({ length: 501 }, (_, i) => ({
      ...rows[0],
      id: "entry" + String(i).padStart(4, "0"),
      relatedId: "usage" + i,
      createTime: new Date(Date.now() - (i + 1) * 1000),
    }));
    repository.scan.mockResolvedValueOnce(large.slice(0, 500)).mockResolvedValueOnce(large.slice(500));
    const result = await service.list({ page: 6, pageSize: 100 }, request);
    expect(result.total).toBe(501);
    expect(result.records.map((row) => row.id)).toEqual(["entry0500"]);
    expect(repository.scan.mock.calls[1][2].id).toBe("entry0499");
    expect(repository.hydrate.mock.calls.every((call: any[]) => call[1].length <= 500)).toBe(true);
  });

  it("registers a sensitive List Action targeting exact ledger resources", () => {
    expect(getIamActionDefinition("quyan:balance:ListUserTransactions")).toMatchObject({
      accessLevel: "List",
      resourceTypes: ["balance/transaction"],
      sensitive: true,
    });
    expect(balanceTransactionArn("owner", "peer", "new")).toBe("acs:balance:*:owner:transaction/peer/new");
  });
  it("filters each resource before hydration, totals and pagination", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: { resources: string[] }) =>
      resources.map((r) => (r.endsWith("/middle") ? deny : allow)),
    );
    const result = await service.list({ page: 2, pageSize: 1 }, request);
    expect(result.total).toBe(2);
    expect(result.records.map((row) => row.id)).toEqual(["old"]);
    expect(repository.hydrate.mock.calls[0][1].map((row: any) => row.id)).toEqual(["new", "old"]);
    expect([...result.display.tokenNameMap.keys()]).toEqual(["usage-old"]);
  });
  it("applies token name filtering before totals and pagination", async () => {
    const result = await service.list({ page: 2, pageSize: 1, tokenName: "selected" }, request);
    expect(result.total).toBe(2);
    expect(result.records.map((row) => row.id)).toEqual(["old"]);
  });
  it("returns an empty authorized collection without hydrating denied resources", async () => {
    iam.authorizeMany.mockResolvedValue(rows.map(() => deny));
    const result = await service.list({ page: 1, pageSize: 20 }, request);
    expect(result.total).toBe(0);
    expect(result.records).toEqual([]);
    expect(repository.hydrate).not.toHaveBeenCalled();
    expect(repository.display).not.toHaveBeenCalled();
  });
  it("removes newly revoked grants and stale ledger versions before returning", async () => {
    iam.authorizeMany.mockResolvedValueOnce(rows.map(() => allow)).mockResolvedValueOnce([deny, allow, allow]);
    repository.current.mockResolvedValue([rows[0], rows[2]]);
    const result = await service.list({ page: 1, pageSize: 20 }, request);
    expect(result.total).toBe(1);
    expect(result.records.map((row) => row.id)).toEqual(["old"]);
    expect([...result.display.tokenNameMap.keys()]).toEqual(["usage-old"]);
  });
  it("shadow diagnostics do not hydrate transactions or ancillary metadata", async () => {
    await service.list({ page: 1, pageSize: 20 }, request, true);
    expect(repository.hydrate).not.toHaveBeenCalled();
    expect(repository.display).not.toHaveBeenCalled();
  });
  it("cannot fall back after authorization data becomes unavailable", async () => {
    iam.authorizeMany.mockRejectedValue(new Error("fixture unavailable"));
    await expect(service.list({ page: 1, pageSize: 20 }, request)).rejects.toThrow("fixture unavailable");
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("rejects a sparse decision array before reading money values", async () => {
    iam.authorizeMany.mockResolvedValue(new Array(3));
    await expect(service.list({ page: 1, pageSize: 20 }, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("rejects mismatched hydration and unexpected current ledger records", async () => {
    repository.hydrate.mockResolvedValue([{ ...rows[0], userId: "foreign" }]);
    await expect(service.list({ page: 1, pageSize: 20 }, request)).rejects.toMatchObject({ statusCode: 403 });
    repository.hydrate.mockImplementation(async (_: unknown, selected: any[]) => selected);
    repository.current.mockResolvedValue([{ ...rows[0], id: "foreign" }]);
    await expect(service.list({ page: 1, pageSize: 20 }, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("applies the shared retention policy before scanning", async () => {
    await service.list({ page: 1, pageSize: 20, startTime: new Date(0) }, request);
    const start = repository.scan.mock.calls[0][1].startTime.getTime();
    expect(Math.abs(start - (Date.now() - BALANCE_TRANSACTION_POLICY.retentionWindowMs))).toBeLessThan(1000);
  });
  it.each([
    { page: 0, pageSize: 20 },
    { page: 1, pageSize: 101 },
    { page: 1, pageSize: 20, userId: "*" },
    { page: 1, pageSize: 20, startTime: new Date(NaN) },
  ])("rejects invalid query %j", async (query) => {
    await expect(service.list(query, request)).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it("cannot return rows after the actor is disabled", async () => {
    repository.assertActor.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("fixture revoked"));
    await expect(service.list({ page: 1, pageSize: 20 }, request)).rejects.toThrow("fixture revoked");
  });
  it("declares collection enforcement and passes the trusted request to the service", () => {
    const file = "src/api/controllers/v1/billing/balance.controller.ts",
      project = new Project({ useInMemoryFileSystem: true }),
      source = project.createSourceFile("/backend/" + file, readFileSync(file, "utf8"));
    const route = collectIamRoutes([source], "/backend").find((r) => r.method === "getAllTransactions");
    expect(route).toMatchObject({
      coverage: "explicit",
      resourceKind: "collection",
      actions: ["quyan:balance:ListUserTransactions"],
      issues: [],
    });
    expect(source.getClassOrThrow("BalanceController").getMethodOrThrow("getAllTransactions").getText()).toContain(
      "getManagedTransactions",
    );
  });
});
