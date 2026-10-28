import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import {
  getIamActionDefinition,
  IAM_AUTHENTICATED_SELF_ACTIONS,
  Permission,
  iamActionsForLegacyPermission,
} from "@quyan/shared";
import type { IamEvaluationResult } from "@quyan/shared";
import type { IamAuthorizationService } from "@/iam/iam-authorization.service";
import type { TicketStore, OwnTicketTarget } from "@/store/ticket/ticket.store";
import type { TypedRequest } from "@/types/express";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/ticket/ticket.repository", () => ({ TicketRepository: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
import { OwnTicketIamService, ownTicketFollows } from "@/services/ticket/own-ticket-iam.service";
import { ownTicketResourceResolver } from "@/iam/request/ticket-resource-resolvers";
import { TicketRepository } from "@/store/ticket/ticket.repository";
const repository = mockDeep<TicketStore>(),
  iam = mockDeep<IamAuthorizationService>();
const Service = OwnTicketIamService as unknown as new (
  repository: TicketStore,
  iam: IamAuthorizationService,
) => OwnTicketIamService;
const service = new Service(repository, iam);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: {},
    params: { id: "ticket-2" },
    query: { accountId: "foreign" },
  }) as unknown as TypedRequest;
const target = (id: string): OwnTicketTarget => ({
  id,
  userId: "actor",
  workflowStatus: "pending",
  createTime: new Date("2026-10-12T00:00:00Z"),
  updateTime: new Date("2026-10-12T00:00:00Z"),
  lastReplyAt: null,
});
const row = (value: OwnTicketTarget) => ({
  ...value,
  status: 1,
  type: "bug",
  title: "fixture",
  description: "private-body",
  sourcePage: null,
  reproduceSteps: null,
  contactInfo: "private-contact",
  priority: "medium",
  assigneeUserId: null,
  user: { id: "actor", username: "fixture" },
  assignee: null,
});
const allow: IamEvaluationResult = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny: IamEvaluationResult = { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(TicketRepository.getInstance).mockReturnValue(repository as never);
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map((resource) => (resource.endsWith("ticket-2") ? deny : allow)),
  );
  repository.scanOwnTargets.mockResolvedValue([target("ticket-3"), target("ticket-2"), target("ticket-1")]);
  repository.readOwnTargets.mockImplementation(async (_user, _owner, targets) => targets.map(row));
  repository.findOwnTarget.mockResolvedValue(target("ticket-2"));
});
describe("own ticket resource authorization", () => {
  it("registers catalog migration aliases without default self grants", () => {
    expect(iamActionsForLegacyPermission(Permission.TICKET_SELF_READ)).toContain("quyan:ticket:ListOwnTickets");
    expect(getIamActionDefinition("quyan:ticket:UpdateOwnTicket")?.resourceTypes).toEqual(["ticket/ticket"]);
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).not.toContain("quyan:ticket:CreateTicket");
  });
  it("filters before pagination and counts without loading rejected bodies or contacts", async () => {
    const result = await service.list("actor", { page: 2, pageSize: 1 }, request());
    expect(result.total).toBe(2);
    expect(result.items.map((row) => row.id)).toEqual(["ticket-1"]);
    expect(repository.readOwnTargets).toHaveBeenCalledWith("actor", "owner", [target("ticket-1")]);
  });
  it("does not expose a count or hydrate data when no resource is allowed", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) => resources.map(() => deny));
    await expect(service.list("actor", { page: 1, pageSize: 10 }, request())).resolves.toEqual({ total: 0, items: [] });
    expect(repository.readOwnTargets).toHaveBeenCalledWith("actor", "owner", []);
  });
  it("rejects malformed pagination and mismatched identity before storage", async () => {
    await expect(service.list("actor", { page: 0, pageSize: 10 }, request())).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(service.list("other", { page: 1, pageSize: 10 }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.list("actor", { page: 1, pageSize: 10 })).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scanOwnTargets).not.toHaveBeenCalled();
  });
  it("fails closed on incomplete decisions foreign metadata and stale hydration", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow]);
    await expect(service.list("actor", { page: 1, pageSize: 10 }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    repository.scanOwnTargets.mockResolvedValueOnce([{ ...target("ticket-3"), userId: "other" }]);
    await expect(service.list("actor", { page: 1, pageSize: 10 }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    repository.readOwnTargets.mockResolvedValueOnce([row(target("ticket-2"))]);
    await expect(service.list("actor", { page: 1, pageSize: 10 }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rechecks policy revocation after the scan and after hydration", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow, deny, allow]).mockResolvedValueOnce([deny, deny]);
    await expect(service.list("actor", { page: 1, pageSize: 10 }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.readOwnTargets).not.toHaveBeenCalled();
    iam.authorizeMany.mockReset();
    iam.authorizeMany
      .mockResolvedValueOnce([allow, deny, allow])
      .mockResolvedValueOnce([allow, allow])
      .mockResolvedValueOnce([deny, deny]);
    await expect(service.list("actor", { page: 1, pageSize: 10 }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("validates deterministic reply/time/id cursor order including nullable reply dates", () => {
    const a = { ...target("ticket-3"), lastReplyAt: new Date("2026-10-12T01:00:00Z") },
      b = target("ticket-2");
    expect(ownTicketFollows(a, b)).toBe(true);
    expect(ownTicketFollows(b, a)).toBe(false);
    expect(ownTicketFollows(b, target("ticket-1"))).toBe(true);
    expect(ownTicketFollows(b, b)).toBe(false);
    expect(ownTicketFollows(a, { ...a, id: "ticket-2" })).toBe(true);
  });
  it("resolves only exact stored ownership and never trusts client account IDs", async () => {
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    await expect(ownTicketResourceResolver({ request: request(), principal })).resolves.toBe(
      "acs:ticket:*:owner:ticket/actor/ticket-2",
    );
    repository.findOwnTarget.mockResolvedValue({ ...target("ticket-2"), userId: "other" });
    await expect(ownTicketResourceResolver({ request: request(), principal })).resolves.toBeUndefined();
    repository.findOwnTarget.mockResolvedValue(target("TICKET-2"));
    await expect(ownTicketResourceResolver({ request: request(), principal })).resolves.toBeUndefined();
  });
  it("rejects internal comments or a changed ticket snapshot from detail hydration", async () => {
    repository.findOwnTarget.mockResolvedValue(target("ticket-3"));
    repository.readOwnDetail.mockResolvedValue({
      ticket: row(target("ticket-3")),
      comments: [
        {
          id: "comment",
          ticketId: "ticket-3",
          authorUserId: "actor",
          status: 1,
          visibility: "internal",
          content: "private",
          createTime: new Date(),
          updateTime: new Date(),
          author: { id: "actor", username: "fixture" },
        },
      ],
    });
    await expect(service.detail("ticket-3", "actor", "quyan:ticket:GetOwnTicket", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    repository.readOwnDetail.mockResolvedValue({
      ticket: { ...row(target("ticket-3")), updateTime: new Date("2026-10-12T01:00:00Z") },
      comments: [],
    });
    await expect(service.detail("ticket-3", "actor", "quyan:ticket:GetOwnTicket", request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("does not load details or allow mutations when the target is denied", async () => {
    await expect(service.detail("ticket-2", "actor", "quyan:ticket:GetOwnTicket", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.readOwnDetail).not.toHaveBeenCalled();
    await expect(
      service.authorizeTarget("ticket-2", "actor", "quyan:ticket:UpdateOwnTicket", request()),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
