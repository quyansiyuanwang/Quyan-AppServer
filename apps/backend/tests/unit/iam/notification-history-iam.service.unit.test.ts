import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Permission,
  IAM_AUTHENTICATED_SELF_ACTIONS,
  authenticatedSelfResourcePatterns,
  iamActionsForLegacyPermission,
  type IamPrincipal,
} from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { NotificationHistoryIamService } from "@/services/notification/notification-history-iam.service";
import { notificationDeliveryLogArn } from "@/iam/resources/notification-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
vi.mock("@/iam/iam-authorization.service");
vi.mock("@/store/notification/notification-history-management.repository");
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
const principal: IamPrincipal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "account",
  subjectType: "sub_user",
};
const req = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "account" },
    secure: true,
    headers: { "x-action": "forged" },
    body: { userId: "peer" },
  }) as unknown as TypedRequest;
const row = (id: string) => ({
  id,
  userId: "actor",
  createTime: new Date(1),
  eventType: "fixture",
  channel: "email",
  webhookId: null,
  deliveryStatus: "sent",
});
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
const deny = { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
const iam = { loadPolicies: vi.fn(), authorize: vi.fn(), authorizeMany: vi.fn() };
const repository = { assertPrincipal: vi.fn(), scan: vi.fn(), validate: vi.fn(), hydrate: vi.fn() };
let service: NotificationHistoryIamService;
beforeEach(() => {
  vi.resetAllMocks();
  service = new (NotificationHistoryIamService as any)(iam, repository);
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorize.mockResolvedValue(allow);
  iam.authorizeMany.mockImplementation(async ({ resources }) => resources.map(() => allow));
  repository.assertPrincipal.mockResolvedValue(undefined);
  repository.scan.mockResolvedValue([]);
  repository.validate.mockImplementation(async (_, rows) => rows);
  repository.hydrate.mockImplementation(async (_, rows) => rows);
});
describe("notification history authorization and compatibility", () => {
  it("grants event catalog on own identity but does not default grant sensitive log resources", () => {
    const document = parseIamPolicy({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: IAM_AUTHENTICATED_SELF_ACTIONS,
        Resource: authenticatedSelfResourcePatterns("account", "actor"),
      },
    }).document;
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).toContain("quyan:notification:ListEvents");
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).not.toContain("quyan:notification:ListDeliveryLogs");
    expect(
      evaluatePolicies([{ policyId: "self", document }], {
        action: "quyan:notification:ListEvents",
        resource: "acs:quyan:*:account:user/actor",
      }).decision,
    ).toBe("Allow");
    expect(
      evaluatePolicies([{ policyId: "self", document }], {
        action: "quyan:notification:ListEvents",
        resource: "acs:quyan:*:account:user/peer",
      }).decision,
    ).toBe("ImplicitDeny");
    expect(
      evaluatePolicies([{ policyId: "self", document }], {
        action: "quyan:notification:ListDeliveryLogs",
        resource: notificationDeliveryLogArn("account", "actor", "one"),
      }).decision,
    ).toBe("ImplicitDeny");
  });
  it("preserves explicit legacy conversion Allow and remove Deny without widening canonical JSON Manage", () => {
    expect(iamActionsForLegacyPermission(Permission.NOTIFICATION_MANAGE)).toContain(
      "quyan:notification:ListDeliveryLogs",
    );
    for (const Effect of ["Allow", "Deny"] as const) {
      const document = parseIamPolicy(
        legacyPermissionsToPrincipalPolicy([Permission.NOTIFICATION_MANAGE], "account", "actor", Effect),
      ).document;
      expect(
        evaluatePolicies([{ policyId: "legacy", document }], {
          action: "quyan:notification:ListDeliveryLogs",
          resource: notificationDeliveryLogArn("account", "actor", "one"),
        }).decision,
      ).toBe(Effect === "Allow" ? "Allow" : "ExplicitDeny");
    }
    const document = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:notification:Manage", Resource: "*" },
    }).document;
    expect(
      evaluatePolicies([{ policyId: "json", document }], {
        action: "quyan:notification:ListDeliveryLogs",
        resource: notificationDeliveryLogArn("account", "actor", "one"),
      }).decision,
    ).toBe("ImplicitDeny");
  });
  it("filters before pagination, totals and hydration using a fixed Action", async () => {
    repository.scan.mockResolvedValueOnce([row("one"), row("two"), row("three")]);
    iam.authorizeMany.mockResolvedValueOnce([deny, allow, allow]);
    const request = req();
    const result = await service.list("actor", 2, 1, request);
    expect(result).toMatchObject({ total: 2, logs: [{ id: "three" }], page: 2, pageSize: 1 });
    expect(repository.hydrate).toHaveBeenCalledWith(principal, [row("three")]);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:notification:ListDeliveryLogs",
        resources: [
          "acs:notification:*:account:delivery-log/actor/one",
          "acs:notification:*:account:delivery-log/actor/two",
          "acs:notification:*:account:delivery-log/actor/three",
        ],
      }),
    );
    expect(request.iamDecisions?.some((result) => result.decision === "ExplicitDeny")).toBe(true);
  });
  it("fails closed if selected-page authorization is revoked before content loading", async () => {
    repository.scan.mockResolvedValueOnce([row("one")]);
    iam.authorizeMany.mockResolvedValueOnce([allow]).mockResolvedValueOnce([deny]);
    await expect(service.list("actor", 1, 20, req())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it.each([{ results: [] }, { results: [allow, allow] }])(
    "rejects incomplete or surplus decisions",
    async ({ results }) => {
      repository.scan.mockResolvedValueOnce([row("one")]);
      iam.authorizeMany.mockResolvedValueOnce(results);
      await expect(service.list("actor", 1, 20, req())).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.hydrate).not.toHaveBeenCalled();
    },
  );
  it("authorizes events against actual self resource with no client Action influence", async () => {
    await service.authorizeEvents("actor", req());
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:notification:ListEvents", resource: "acs:quyan:*:account:user/actor" }),
    );
    expect(repository.assertPrincipal).toHaveBeenCalledTimes(2);
  });
  it("denies event catalog after explicit Deny", async () => {
    iam.authorize.mockResolvedValue(deny);
    await expect(service.authorizeEvents("actor", req())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires live identity on empty pages and rejects missing/mismatched context", async () => {
    await expect(service.list("actor", 1, 20)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.authorizeEvents("peer", req())).rejects.toMatchObject({ statusCode: 403 });
    repository.assertPrincipal.mockRejectedValue(new Error("fixture identity unavailable"));
    await expect(service.list("actor", 1, 20, req())).rejects.toThrow("fixture identity unavailable");
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("normalizes internal query values and rejects invalid offsets", async () => {
    expect(await service.list("actor", "1" as any, "20" as any, req())).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 0,
    });
    await expect(service.list("actor", 0, 20, req())).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.list("actor", Number.MAX_SAFE_INTEGER, 100, req())).rejects.toMatchObject({ statusCode: 400 });
  });
});
