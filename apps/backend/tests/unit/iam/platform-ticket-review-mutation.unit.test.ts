import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { PlatformTicketReviewMutationIamService } from "@/services/ticket/platform-ticket-review-mutation-iam.service";
import { normalizeTicketReviewMutation } from "@/store/ticket/platform-ticket-review-mutation.repository";
import { platformTicketReviewArn } from "@/iam/resources/platform-ticket-review-resources";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { target: vi.fn(), comments: vi.fn(), authorizationRevision: vi.fn(), mutate: vi.fn() };
const service = new PlatformTicketReviewMutationIamService(iam, snapshots, repository);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const target = () => ({
  id: "ticket",
  userId: "submitter",
  status: 1,
  createTime: new Date(0),
  updateTime: new Date(0),
  lastReplyAt: null,
  revision: "a".repeat(64),
});
beforeEach(() => {
  vi.resetAllMocks();
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }: { resources: string[] }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  snapshots.snapshot.mockResolvedValue({
    group: { id: "global", updateTime: new Date(0) },
    users: [
      { id: "actor", updateTime: new Date(0) },
      { id: "owner", updateTime: new Date(0) },
    ],
  });
  snapshots.recheck.mockResolvedValue(undefined);
  repository.target.mockResolvedValue(target());
  repository.comments.mockResolvedValue([]);
  repository.authorizationRevision.mockResolvedValue("b".repeat(64));
  repository.mutate.mockImplementation(async (guard) => {
    await guard.users.recheck();
    return { before: { id: "ticket" } };
  });
});
describe("ticket review mutation preparation", () => {
  it.each([
    [{ kind: "update", data: { priority: "high" } }, "quyan:ticket:UpdateReviewTicket"],
    [{ kind: "comment", data: { content: " fixture ", visibility: "internal" } }, "quyan:ticket:AddReviewComment"],
    [{ kind: "delete" }, "quyan:ticket:DeleteReviewTicket"],
  ] as const)("uses fixed resource actions for %j", async (input, action) => {
    await service.execute("ticket", "actor", input, request());
    expect(
      iam.authorizeMany.mock.calls.every(
        ([args]) => args.action === action && args.resources[0] === platformTicketReviewArn("submitter", "ticket"),
      ),
    ).toBe(true);
    expect(repository.mutate.mock.calls[0]![0]).toMatchObject({
      action,
      target: { id: "ticket", userId: "submitter" },
      authorizationRevision: "b".repeat(64),
    });
    expect(repository.mutate).toHaveBeenCalledOnce();
  });
  it("normalizes explicit unassignment and comment content", () => {
    expect(normalizeTicketReviewMutation({ kind: "update", data: { assigneeUserId: "" } })).toEqual({
      kind: "update",
      data: { assigneeUserId: null },
    });
    expect(
      normalizeTicketReviewMutation({ kind: "comment", data: { content: " fixture ", visibility: "public" } }),
    ).toEqual({ kind: "comment", data: { content: "fixture", visibility: "public" } });
  });
  it("preserves an omitted assignee when another field is updated", () => {
    expect(
      normalizeTicketReviewMutation({ kind: "update", data: { priority: "high", assigneeUserId: undefined } }),
    ).toEqual({ kind: "update", data: { priority: "high", assigneeUserId: undefined } });
  });
  it.each([
    { kind: "update", data: {} },
    { kind: "update", data: { priority: undefined } },
    { kind: "update", data: { priority: "invalid" } },
    { kind: "update", data: { userId: "forged" } },
    { kind: "comment", data: { content: "", visibility: "public" } },
    { kind: "comment", data: { content: "ok", visibility: "unknown" } },
    { kind: "comment", data: { content: "ok", visibility: "public", authorUserId: "forged" } },
  ])("rejects invalid or ownership-changing payloads %j", async (input) => {
    await expect(service.execute("ticket", "actor", input as never, request())).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(repository.mutate).not.toHaveBeenCalled();
    expect(repository.target).not.toHaveBeenCalled();
  });
  it("rejects Deny before comments or any write", async () => {
    iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] }]);
    await expect(
      service.execute("ticket", "actor", { kind: "update", data: { priority: "high" } }, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.comments).not.toHaveBeenCalled();
    expect(repository.mutate).not.toHaveBeenCalled();
  });
  it("checks only the write action instead of requiring a detail read grant", async () => {
    await service.execute("ticket", "actor", { kind: "update", data: { priority: "high" } }, request());
    expect(iam.authorizeMany.mock.calls.every(([args]) => args.action === "quyan:ticket:UpdateReviewTicket")).toBe(
      true,
    );
  });
  it("rechecks authorization revisions through the transaction guard", async () => {
    repository.mutate.mockImplementation(async (guard) => {
      repository.authorizationRevision.mockResolvedValue("c".repeat(64));
      await guard.users.recheck();
    });
    await expect(service.execute("ticket", "actor", { kind: "delete" }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("denies a revoked contributing grant during the final guard", async () => {
    repository.mutate.mockImplementation(async (guard) => {
      iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] }]);
      await guard.users.recheck();
    });
    await expect(service.execute("ticket", "actor", { kind: "delete" }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("runs shadow evaluation without a second write", async () => {
    await service.execute("ticket", "actor", { kind: "update", data: { priority: "high" } }, request(), false);
    expect(repository.mutate).not.toHaveBeenCalled();
  });
  it("detects source owner changes during shadow preparation", async () => {
    repository.target.mockResolvedValueOnce(target()).mockResolvedValue({ ...target(), userId: "changed" });
    await expect(service.execute("ticket", "actor", { kind: "delete" }, request(), false)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rejects wrong reviewer identities, missing context and OAuth", async () => {
    await expect(service.execute("ticket", "other", { kind: "delete" }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.execute("ticket", "actor", { kind: "delete" })).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.execute("ticket", "actor", { kind: "delete" }, { ...request(), oauthAccessToken: {} } as TypedRequest),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.mutate).not.toHaveBeenCalled();
  });
  it("declares all write endpoints with server actions and loaded resource resolvers", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const file = project.addSourceFileAtPath("src/api/controllers/v1/ticket/ticket.controller.ts");
    const routes = collectIamRoutes([file], process.cwd());
    for (const [method, action] of [
      ["reviewTicket", "UpdateReviewTicket"],
      ["addReviewComment", "AddReviewComment"],
      ["deleteTicket", "DeleteReviewTicket"],
    ])
      expect(routes.find((row) => row.method === method)).toMatchObject({
        coverage: "explicit",
        actions: ["quyan:ticket:" + action],
        resourceKind: "single-resource",
      });
  });
});
