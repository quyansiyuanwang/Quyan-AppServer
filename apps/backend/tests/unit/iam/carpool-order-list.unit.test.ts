import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { IamEvaluationResult } from "@quyan/shared";
import type { IamAuthorizationService } from "@/iam/iam-authorization.service";
import type { CarpoolRepository } from "@/store/billing/carpool.repository";
import type { TypedRequest } from "@/types/express";

vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/billing/carpool.repository", () => ({ CarpoolRepository: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { CarpoolOrderIamService } from "@/services/billing/carpool-order-iam.service";

const repository = mockDeep<CarpoolRepository>(),
  iam = mockDeep<IamAuthorizationService>();
const Service = CarpoolOrderIamService as unknown as new (
  repository: CarpoolRepository,
  iam: IamAuthorizationService,
) => CarpoolOrderIamService;
const service = new Service(repository, iam);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: {},
    query: { accountId: "foreign", userId: "other" },
  }) as unknown as TypedRequest;
const target = (id: string) => ({
  id,
  members: [{ userId: "actor" }],
  createTime: new Date(Date.UTC(2026, 9, 11, 0, 0, 4 - Number(id.slice(-1)))),
  updateTime: new Date("2026-10-11T00:00:00Z"),
});
const allow: IamEvaluationResult = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
const deny: IamEvaluationResult = { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };

beforeEach(() => {
  vi.clearAllMocks();
  iam.loadPolicies.mockResolvedValue([]);
  repository.scanMemberOrderTargets.mockResolvedValue([target("order-1"), target("order-2"), target("order-3")]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map((resource) => (resource.endsWith("order-2") ? deny : allow)),
  );
  repository.readMemberOrderTargets.mockImplementation(async (_actor, _owner, targets) =>
    targets.map((row) => ({ ...row, packageName: "fixture" }) as never),
  );
});

describe("carpool member list resource filtering", () => {
  it("filters before pagination and counts only allowed membership targets", async () => {
    const result = await service.list("actor", 2, 1, "open", "fixture", request());
    expect(result).toMatchObject({ total: 2, records: [{ id: "order-3" }] });
    expect(repository.scanMemberOrderTargets).toHaveBeenCalledWith("actor", "owner", "open", "fixture", undefined);
    expect(repository.readMemberOrderTargets).toHaveBeenCalledWith("actor", "owner", [target("order-3")]);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:carpool:ListMyOrders",
        resources: [
          "acs:carpool:*:owner:order/order-1",
          "acs:carpool:*:owner:order/order-2",
          "acs:carpool:*:owner:order/order-3",
        ],
      }),
    );
  });

  it("returns an empty population with no Allow rather than exposing membership totals", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) => resources.map(() => deny));
    await expect(service.list("actor", 1, 20, undefined, undefined, request())).resolves.toEqual({
      total: 0,
      records: [],
    });
    expect(repository.readMemberOrderTargets).toHaveBeenCalledWith("actor", "owner", []);
  });

  it("does not hydrate after a revoked grant or incomplete evaluation", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow, allow, allow]).mockResolvedValueOnce([deny]);
    await expect(service.list("actor", 1, 1, undefined, undefined, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.readMemberOrderTargets).not.toHaveBeenCalled();
    iam.authorizeMany.mockResolvedValueOnce([]);
    await expect(service.list("actor", 1, 1, undefined, undefined, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("rejects mismatched subjects, nonmember rows and changed snapshots", async () => {
    await expect(service.list("actor", 1, 20)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list("other", 1, 20, undefined, undefined, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    repository.scanMemberOrderTargets.mockResolvedValueOnce([{ ...target("order-1"), members: [{ userId: "other" }] }]);
    await expect(service.list("actor", 1, 20, undefined, undefined, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    repository.readMemberOrderTargets.mockResolvedValueOnce([
      { ...target("order-1"), updateTime: new Date() } as never,
    ]);
    await expect(service.list("actor", 1, 1, undefined, undefined, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("does not widen account scope when policy loading fails", async () => {
    iam.loadPolicies.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(service.list("actor", 1, 20, undefined, undefined, request())).rejects.toThrow("provider unavailable");
    expect(repository.scanMemberOrderTargets).not.toHaveBeenCalled();
  });
});
