import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { PlatformTicketReviewReadIamService } from "@/services/ticket/platform-ticket-review-read-iam.service";
import { platformTicketReviewArn } from "@/iam/resources/platform-ticket-review-resources";
import {
  sameTicketReviewTargets,
  sameTicketReviewComments,
} from "@/store/ticket/platform-ticket-review-read.repository";
import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = {
    where: vi.fn(),
    scan: vi.fn(),
    target: vi.fn(),
    recheck: vi.fn(),
    hydrate: vi.fn(),
    comments: vi.fn(),
    detail: vi.fn(),
  };
const service = new PlatformTicketReviewReadIamService(iam, snapshots, repository);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*", "x-account-id": "forged" },
    ip: "192.0.2.20",
    secure: true,
  }) as unknown as TypedRequest;
const target = (id = "ticket", lastReplyAt: Date | null = null) => ({
  id,
  userId: "submitter",
  status: 1,
  createTime: new Date(100),
  updateTime: new Date(100),
  lastReplyAt,
  revision: "a".repeat(64),
});
const view = (id: string) => ({ id, userId: "submitter", status: 1, user: { id: "submitter", username: "fixture" } });
beforeEach(() => {
  vi.resetAllMocks();
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }: { resources: string[] }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  snapshots.recheck.mockResolvedValue(undefined);
  repository.where.mockResolvedValue({ status: 1 });
  repository.scan.mockResolvedValue([target("z"), target("a", new Date(500))]);
  repository.hydrate.mockImplementation(async (_principal, targets: { id: string }[]) =>
    targets.map((row) => view(row.id)),
  );
  repository.target.mockResolvedValue(target());
  repository.recheck.mockResolvedValue(undefined);
  repository.comments.mockResolvedValue([{ id: "comment", revision: "b".repeat(64) }]);
  repository.detail.mockResolvedValue({ ticket: view("ticket"), comments: [] });
});
describe("resource filtered ticket review reads", () => {
  it("paginates only authorized tickets in the existing reply order", async () => {
    const result = await service.list({ page: 1, pageSize: 1 }, request());
    expect(result).toMatchObject({ total: 2, page: 1, pageSize: 1, hasMore: true, items: [{ id: "a" }] });
    expect(repository.hydrate.mock.calls[0]![1].map((row: { id: string }) => row.id)).toEqual(["a"]);
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === "quyan:ticket:ListReviewTickets")).toBe(
      true,
    );
  });
  it("does not hydrate denied rows and counts only allowed rows", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: { resources: string[] }) =>
      resources.map((resource) => ({
        decision: resource.endsWith("/z") ? "ExplicitDeny" : "Allow",
        reason: "fixture",
        matchedStatements: [],
      })),
    );
    expect(await service.list({}, request())).toMatchObject({ total: 1, items: [{ id: "a" }] });
    expect(repository.hydrate.mock.calls[0]![1]).toHaveLength(1);
  });
  it("returns an empty authorized page without hydrating content", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: { resources: string[] }) =>
      resources.map(() => ({ decision: "ImplicitDeny", reason: "fixture", matchedStatements: [] })),
    );
    expect(await service.list({}, request())).toMatchObject({ total: 0, items: [] });
    expect(repository.hydrate.mock.calls[0]![1]).toEqual([]);
  });
  it("uses loaded owner metadata instead of client action or account headers", async () => {
    expect(await service.detail("ticket", request())).toMatchObject({ ticket: { id: "ticket" } });
    expect(
      iam.authorizeMany.mock.calls.every(
        ([input]) =>
          input.action === "quyan:ticket:GetReviewTicket" &&
          input.resources[0] === platformTicketReviewArn("submitter", "ticket"),
      ),
    ).toBe(true);
  });
  it("denies detail before comments or content hydration", async () => {
    iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] }]);
    await expect(service.detail("ticket", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.comments).not.toHaveBeenCalled();
    expect(repository.detail).not.toHaveBeenCalled();
  });
  it("requires a persisted management snapshot", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("qualification unavailable"));
    await expect(service.list({}, request())).rejects.toThrow("qualification unavailable");
    expect(repository.scan).not.toHaveBeenCalled();
  });
  it.each([{ page: 0 }, { pageSize: 101 }, { page: 10001 }, { startTime: "invalid" }, { priority: "unknown" }])(
    "rejects malformed queries %j",
    async (input) => {
      await expect(service.list(input as never, request())).rejects.toMatchObject({ statusCode: 400 });
      expect(repository.scan).not.toHaveBeenCalled();
    },
  );
  it("rejects duplicate or misordered metadata", async () => {
    repository.scan.mockResolvedValue([target(), target()]);
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("rejects changed authorized content even with the same update time", async () => {
    repository.scan.mockResolvedValueOnce([target()]).mockResolvedValue([{ ...target(), revision: "b".repeat(64) }]);
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects policy changes before returning a page", async () => {
    repository.hydrate.mockImplementation(async () => {
      iam.loadPolicies.mockResolvedValue([
        {
          policyId: "changed",
          document: {
            Version: "1",
            Statement: [{ Effect: "Deny", Action: ["quyan:ticket:ListReviewTickets"], Resource: ["*"] }],
          },
        },
      ]);
      return [view("a"), view("z")];
    });
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects incomplete hydration", async () => {
    repository.hydrate.mockResolvedValue([]);
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects comments edited after hydration", async () => {
    repository.detail.mockImplementation(async () => {
      repository.comments.mockResolvedValue([{ id: "comment", revision: "c".repeat(64) }]);
      return { ticket: view("ticket"), comments: [] };
    });
    await expect(service.detail("ticket", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("runs shadow simulations without hydrating private fields", async () => {
    await service.list({}, request(), false);
    await service.detail("ticket", request(), false);
    expect(repository.hydrate).not.toHaveBeenCalled();
    expect(repository.detail).not.toHaveBeenCalled();
    expect(repository.comments).not.toHaveBeenCalled();
  });
  it("rejects anonymous and OAuth requests", async () => {
    await expect(service.list({}, {} as TypedRequest)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.detail("ticket", { ...request(), oauthAccessToken: {} } as TypedRequest),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a missing or mismatched detail target", async () => {
    repository.target.mockResolvedValue(null);
    await expect(service.detail("ticket", request())).rejects.toMatchObject({ statusCode: 403 });
    repository.target.mockResolvedValue(target("other"));
    await expect(service.detail("ticket", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("treats owner changes and malformed revisions as source failures", () => {
    expect(() => sameTicketReviewTargets([{ ...target(), userId: "another" }], [target()])).toThrow();
    expect(() => sameTicketReviewComments([{ id: "comment", revision: "bad" }], [])).toThrow();
  });
  it("declares fixed server actions for both review endpoints", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const file = project.addSourceFileAtPath("src/api/controllers/v1/ticket/ticket.controller.ts");
    const routes = collectIamRoutes([file], process.cwd());
    expect(routes.find((row) => row.method === "listReviewTickets")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:ticket:ListReviewTickets"],
      resourceKind: "collection",
    });
    expect(routes.find((row) => row.method === "getReviewTicketDetail")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:ticket:GetReviewTicket"],
      resourceKind: "single-resource",
    });
  });
});
