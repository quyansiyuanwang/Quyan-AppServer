import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { authenticatedSelfResourcePatterns, getIamActionDefinition } from "@quyan/shared";
import type { BalanceTransferStore } from "@/store/billing/balance-transfer.store";
import type { IamAuthorizationService } from "@/iam/iam-authorization.service";
import type { TypedRequest } from "@/types/express";

const { findTarget, audit } = vi.hoisted(() => ({ findTarget: vi.fn(), audit: vi.fn() }));
vi.mock("@/store/billing/balance-transfer.repository", () => ({
  BalanceTransferRepository: { getInstance: () => ({ findGiftCodeTarget: findTarget }) },
}));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: audit }));

import { balanceGiftCodeResourceResolver } from "@/iam/request/balance-resource-resolvers";
import { BalanceGiftCodeIamService } from "@/services/billing/balance-gift-code-iam.service";
import { balanceGiftCodeArn } from "@/iam/resources/balance-resources";

const principal = {
  subjectUserId: "child",
  principalUserId: "child",
  accountOwnerId: "owner",
  subjectType: "sub_user" as const,
};
const request = () =>
  ({
    user: { userId: "child" },
    authContext: { principalUserId: "child", accountOwnerId: "owner" },
    params: { id: "code-1" },
    body: { accountId: "foreign" },
    headers: { "x-action": "quyan:ram:DeleteUser" },
  }) as unknown as TypedRequest;
const target = (id: string) => ({
  id,
  createdBy: "child",
  createTime: new Date(Date.UTC(2026, 9, 11, 0, 0, 4 - Number(id.slice(-1)))),
  updateTime: new Date("2026-10-11T00:00:00Z"),
});
const result = (decision: "Allow" | "ExplicitDeny" | "ImplicitDeny") => ({
  decision,
  reason:
    decision === "Allow"
      ? ("matched-allow" as const)
      : decision === "ExplicitDeny"
        ? ("explicit-deny" as const)
        : ("no-matching-allow" as const),
  matchedStatements: [],
});
const repository = mockDeep<BalanceTransferStore>();
const iam = mockDeep<IamAuthorizationService>();
const Service = BalanceGiftCodeIamService as unknown as new (
  repository: BalanceTransferStore,
  iam: IamAuthorizationService,
) => BalanceGiftCodeIamService;
const service = new Service(repository, iam);

beforeEach(() => {
  vi.clearAllMocks();
  findTarget.mockResolvedValue(target("code-1"));
  iam.loadPolicies.mockResolvedValue([]);
  repository.scanGiftCodeTargets.mockResolvedValue([target("code-1"), target("code-2"), target("code-3")]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map((resource) => result(resource.endsWith("code-2") ? "ExplicitDeny" : "Allow")),
  );
  repository.readGiftCodeTargets.mockImplementation(async (_sender, _account, selected) =>
    selected.map((item) => ({ ...item, code: "ugc_fixture" }) as never),
  );
});

describe("balance gift code resource authorization", () => {
  it("uses the stored owner and trusted account without loading the secret code", async () => {
    await expect(balanceGiftCodeResourceResolver({ request: request(), principal })).resolves.toBe(
      "acs:balance:*:owner:gift-code/child/code-1",
    );
    expect(findTarget).toHaveBeenCalledWith("code-1", "child", "owner");
    findTarget.mockResolvedValueOnce({ ...target("code-1"), createdBy: "other" });
    await expect(balanceGiftCodeResourceResolver({ request: request(), principal })).resolves.toBeUndefined();
    findTarget.mockResolvedValueOnce(null);
    await expect(balanceGiftCodeResourceResolver({ request: request(), principal })).resolves.toBeUndefined();
  });

  it.each(["*", "a/b", "a:b", "..", "x?", "a".repeat(129)])("rejects malformed target %s before lookup", async (id) => {
    const req = request();
    req.params.id = id;
    await expect(balanceGiftCodeResourceResolver({ request: req, principal })).resolves.toBeUndefined();
    expect(findTarget).not.toHaveBeenCalled();
  });

  it("registers the concrete child resource and a narrowly user-parented baseline", () => {
    expect(getIamActionDefinition("quyan:balance:CancelGiftCode")?.resourceTypes).toEqual(["balance/gift-code"]);
    expect(authenticatedSelfResourcePatterns("owner", "child")).toContain("acs:balance:*:owner:gift-code/child/*");
    expect(balanceGiftCodeArn("owner", "child", "code-1")).toBe("acs:balance:*:owner:gift-code/child/code-1");
  });

  it("paginates only allowed records and loads secrets after per-record decisions", async () => {
    const req = request();
    const page = await service.list("child", 2, 1, req);
    expect(page).toMatchObject({ total: 2, page: 2, pageSize: 1, records: [{ id: "code-3" }] });
    expect(repository.readGiftCodeTargets).toHaveBeenCalledWith("child", "owner", [target("code-3")]);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:balance:ListGiftCodes",
        resources: [
          "acs:balance:*:owner:gift-code/child/code-1",
          "acs:balance:*:owner:gift-code/child/code-2",
          "acs:balance:*:owner:gift-code/child/code-3",
        ],
      }),
    );
    expect(repository.readGiftCodeTargets.mock.invocationCallOrder[0]).toBeGreaterThan(
      iam.authorizeMany.mock.invocationCallOrder.at(-1)!,
    );
    expect(JSON.stringify(audit.mock.calls)).not.toContain("ugc_fixture");
  });

  it("returns an empty authorized population under Deny without loading codes", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) => resources.map(() => result("ImplicitDeny")));
    repository.readGiftCodeTargets.mockResolvedValue([]);
    await expect(service.list("child", 1, 10, request())).resolves.toMatchObject({ total: 0, records: [] });
    expect(repository.readGiftCodeTargets).toHaveBeenCalledWith("child", "owner", []);
  });

  it("fails closed when a selected grant is revoked during a scan", async () => {
    iam.authorizeMany
      .mockResolvedValueOnce([result("Allow"), result("Allow"), result("Allow")])
      .mockResolvedValueOnce([result("ExplicitDeny")]);
    await expect(service.list("child", 1, 1, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.readGiftCodeTargets).not.toHaveBeenCalled();
  });

  it("rejects missing context, foreign rows, incomplete results and changed snapshots", async () => {
    await expect(service.list("child", 1, 10)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list("other", 1, 10, request())).rejects.toMatchObject({ statusCode: 403 });
    repository.scanGiftCodeTargets.mockResolvedValueOnce([{ ...target("code-1"), createdBy: "other" }]);
    await expect(service.list("child", 1, 10, request())).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeMany.mockResolvedValueOnce([]);
    await expect(service.list("child", 1, 10, request())).rejects.toMatchObject({ statusCode: 403 });
    repository.readGiftCodeTargets.mockResolvedValueOnce([
      { ...target("code-1"), updateTime: new Date(), code: "ugc_fixture" } as never,
    ]);
    await expect(service.list("child", 1, 1, request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
