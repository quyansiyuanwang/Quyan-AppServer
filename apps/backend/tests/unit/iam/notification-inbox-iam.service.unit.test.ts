import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedSelfResourcePatterns,
  IAM_AUTHENTICATED_SELF_ACTIONS,
  getIamActionDefinition,
  type IamPrincipal,
} from "@quyan/shared";
import { notificationInboxQuerySchema } from "@/api/schema/notification/notification.schema";
import { NotificationInboxIamService } from "@/services/notification/notification-inbox-iam.service";
import { notificationInboxItemArn } from "@/iam/resources/notification-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import type { TypedRequest } from "@/types/express";
vi.mock("@/iam/iam-authorization.service");
vi.mock("@/store/notification/notification-inbox-management.repository");
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
    body: { userId: "peer" },
    headers: { "x-action": "forged" },
  }) as unknown as TypedRequest;
const row = (id: string, other = {}) => ({
  id,
  userId: "actor",
  status: 1,
  isRead: false,
  pixelOpened: false,
  createTime: new Date(1),
  updateTime: new Date(1),
  ...other,
});
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
const deny = { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() };
const repository = { scan: vi.fn(), selected: vi.fn(), validate: vi.fn(), hydrate: vi.fn(), markRead: vi.fn() };
let service: NotificationInboxIamService;
beforeEach(() => {
  vi.resetAllMocks();
  service = new (NotificationInboxIamService as any)(iam, repository);
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) => resources.map(() => allow));
  repository.scan.mockResolvedValue([]);
  repository.validate.mockImplementation(async (_, rows) => rows);
  repository.hydrate.mockImplementation(async (_, rows) => rows);
  repository.markRead.mockResolvedValue(1);
});
describe("notification inbox service and self resource contract", () => {
  it("parses literal query booleans without treating false strings as true", () => {
    expect(notificationInboxQuerySchema.parse({ unreadOnly: "false" }).unreadOnly).toBe(false);
    expect(notificationInboxQuerySchema.parse({ unreadOnly: "true" }).unreadOnly).toBe(true);
    expect(notificationInboxQuerySchema.parse({}).unreadOnly).toBe(false);
    for (const value of ["0", "no", "", [], {}])
      expect(notificationInboxQuerySchema.safeParse({ unreadOnly: value }).success).toBe(false);
  });
  it("grants only registered own inbox children and no peer/account resource", () => {
    const document = parseIamPolicy({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: IAM_AUTHENTICATED_SELF_ACTIONS,
        Resource: authenticatedSelfResourcePatterns("account", "actor"),
      },
    }).document;
    for (const operation of ["ListInbox", "MarkInboxRead", "ConfirmPixelOpenedInboxRead"]) {
      const action = "quyan:notification:" + operation;
      expect(getIamActionDefinition(action)).toMatchObject({
        resourceTypes: ["notification/inbox-item"],
        defaultAuthorizationScope: "self",
      });
      expect(
        evaluatePolicies([{ policyId: "self", document }], {
          action,
          resource: notificationInboxItemArn("account", "actor", "one"),
        }).decision,
      ).toBe("Allow");
      expect(
        evaluatePolicies([{ policyId: "self", document }], {
          action,
          resource: notificationInboxItemArn("account", "peer", "one"),
        }).decision,
      ).toBe("ImplicitDeny");
      expect(
        evaluatePolicies([{ policyId: "self", document }], { action, resource: "acs:quyan:*:account:account" })
          .decision,
      ).toBe("ImplicitDeny");
    }
    expect(() => authenticatedSelfResourcePatterns("account", "bad/id")).toThrow();
  });
  it("uses normalized query values for internal calls as well as HTTP validation", async () => {
    repository.scan.mockResolvedValueOnce([row("one"), row("two", { isRead: true })]);
    const result = await service.list("actor", "1" as any, "20" as any, "false" as any, req());
    expect(result).toMatchObject({ total: 2, page: 1, pageSize: 20 });
  });
  it("filters before pagination and excludes denied rows from every counter and hydration", async () => {
    repository.scan.mockResolvedValueOnce([
      row("one", { pixelOpened: true }),
      row("two"),
      row("three", { isRead: true }),
    ]);
    iam.authorizeMany.mockResolvedValueOnce([deny, allow, allow]);
    const result = await service.list("actor", 2, 1, false, req());
    expect(result).toMatchObject({ total: 2, unreadCount: 1, pixelOpenedUnreadCount: 0, items: [{ id: "three" }] });
    expect(repository.hydrate).toHaveBeenCalledWith(principal, [expect.objectContaining({ id: "three" })]);
  });
  it("requires every selected target Allow before one atomic write", async () => {
    repository.selected.mockResolvedValue([row("one"), row("two")]);
    iam.authorizeMany.mockResolvedValueOnce([allow, deny]);
    await expect(service.markRead("actor", { ids: ["one", "two"] }, req())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.markRead).not.toHaveBeenCalled();
  });
  it("uses server Action and deduplicated IDs for requested targets", async () => {
    repository.selected.mockResolvedValue([row("one")]);
    await service.markRead("actor", { ids: ["one", "one"], userId: "peer", action: "forged" }, req());
    expect(repository.selected).toHaveBeenCalledWith(principal, ["one"]);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:notification:MarkInboxRead",
        resources: ["acs:notification:*:account:inbox-item/actor/one"],
      }),
    );
  });
  it("updates only authorized targets for markAll and reevaluates selected grants before mutation", async () => {
    repository.scan.mockResolvedValueOnce([row("one"), row("two")]);
    iam.authorizeMany.mockResolvedValueOnce([deny, allow]);
    await service.markRead("actor", { markAll: true }, req());
    expect(repository.markRead).toHaveBeenCalledWith(principal, [expect.objectContaining({ id: "two" })], "manual");
    expect(iam.authorizeMany).toHaveBeenCalledTimes(2);
  });
  it("fails closed if a grant is revoked between collection selection and final write", async () => {
    repository.scan.mockResolvedValueOnce([row("one")]);
    iam.authorizeMany.mockResolvedValueOnce([allow]).mockResolvedValueOnce([deny]);
    await expect(service.confirmPixelOpened("actor", req())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.markRead).not.toHaveBeenCalled();
  });
  it.each([{ results: [] }, { results: [allow, allow] }])(
    "rejects incomplete or surplus decision batches",
    async ({ results }) => {
      repository.scan.mockResolvedValueOnce([row("one")]);
      iam.authorizeMany.mockResolvedValueOnce(results);
      await expect(service.list("actor", 1, 20, false, req())).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.hydrate).not.toHaveBeenCalled();
    },
  );
  it("rejects missing and mismatched actor context independently of middleware", async () => {
    await expect(service.list("actor", 1, 20, false)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.markRead("peer", { ids: ["one"] }, req())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scan).not.toHaveBeenCalled();
    expect(repository.markRead).not.toHaveBeenCalled();
  });
  it.each([{ ids: [] }, { ids: ["bad/id"] }, { ids: Array(201).fill("one") }, null])(
    "rejects invalid internal batch inputs",
    async (input) => {
      await expect(service.markRead("actor", input, req())).rejects.toMatchObject({
        statusCode: 400,
        messageKey: "errors.validationFailed",
      });
      expect(repository.selected).not.toHaveBeenCalled();
    },
  );
  it("validates pagination and empty collection identity without allowing missing policies", async () => {
    await expect(service.list("actor", 0, 20, false, req())).rejects.toMatchObject({ statusCode: 400 });
    iam.loadPolicies.mockRejectedValue(new Error("fixture policy unavailable"));
    await expect(service.list("actor", 1, 20, false, req())).rejects.toThrow("fixture policy unavailable");
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
});
