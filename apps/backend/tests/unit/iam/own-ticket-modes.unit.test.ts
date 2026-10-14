vi.mock("@/config/database", () => ({ prisma: {} }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { mockDeep } from "vitest-mock-extended";
import type { TicketStore, OwnTicketTarget } from "@/store/ticket/ticket.store";
import type { UserRepository } from "@/store/users/user.repository";
import type BusinessLogService from "@/services/system/businesslog.service";
import type { NotificationService } from "@/services/notification/notification.service";
import type { ConfigService } from "@/services/system/config.service";
import type { PermissionService } from "@/services/users/permission.service";
import type { RedisService } from "@/services/infrastructure/redis.service";
import type { TypedRequest } from "@/types/express";
const mocks = vi.hoisted(() => ({
  mode: "enforce",
  target: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  createdDetail: vi.fn(),
  reviewList: vi.fn(),
  reviewDetail: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  env: {
    security: {
      get iamAuthorizationMode() {
        return mocks.mode;
      },
    },
  },
}));
vi.mock("@/services/ticket/own-ticket-iam.service", () => ({
  OwnTicketIamService: {
    getInstance: () => ({
      authorizeTarget: mocks.target,
      list: mocks.list,
      detail: mocks.detail,
      authorizeCreate: mocks.create,
      createdDetail: mocks.createdDetail,
    }),
  },
}));
vi.mock("@/services/ticket/platform-ticket-review-read-iam.service", () => ({
  PlatformTicketReviewReadIamService: { getInstance: () => ({ list: mocks.reviewList, detail: mocks.reviewDetail }) },
}));
vi.mock("@/store/ticket/ticket.repository", () => ({ TicketRepository: { getInstance: vi.fn() } }));
vi.mock("@/store/users/user.repository", () => ({ UserRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/system/businesslog.service", () => ({ default: { getInstance: vi.fn() } }));
vi.mock("@/services/notification/notification.service", () => ({ NotificationService: { getInstance: vi.fn() } }));
vi.mock("@/services/system/config.service", () => ({ ConfigService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/services/infrastructure/redis.service", () => ({ RedisService: { getInstance: vi.fn() } }));
vi.mock("@/util/logger", () => ({ getLogger: () => ({ warn: vi.fn() }), LogCategory: { SECURITY: "security" } }));
import { TicketService } from "@/services/ticket/ticket.service";
const repository = mockDeep<TicketStore>(),
  users = mockDeep<UserRepository>(),
  log = mockDeep<BusinessLogService>(),
  notifications = mockDeep<NotificationService>(),
  config = mockDeep<ConfigService>(),
  permissions = mockDeep<PermissionService>(),
  redis = mockDeep<RedisService>();
const Service = TicketService as unknown as new (
  repository: TicketStore,
  users: UserRepository,
  log: BusinessLogService,
  notifications: NotificationService,
  config: ConfigService,
  permissions: PermissionService,
  redis: RedisService,
) => TicketService;
const service = new Service(repository, users, log, notifications, config, permissions, redis);
const target: OwnTicketTarget = {
  id: "ticket",
  userId: "actor",
  createTime: new Date(),
  updateTime: new Date(),
  lastReplyAt: null,
  workflowStatus: "pending",
};
const ticket = {
  ...target,
  status: 1,
  type: "bug",
  title: "fixture",
  description: "private",
  sourcePage: null,
  reproduceSteps: null,
  contactInfo: null,
  priority: "medium",
  assigneeUserId: null,
  user: { id: "actor", username: "fixture" },
  assignee: null,
};
const request = {
  headers: {},
  socket: {},
  user: { userId: "actor", roleSessionId: "session" },
} as unknown as TypedRequest;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.mode = "enforce";
  mocks.target.mockResolvedValue({ target, principal: { accountOwnerId: "owner" } });
  repository.readOwnDetail.mockResolvedValue({ ticket, comments: [] });
  mocks.detail.mockResolvedValue({ ticket, comments: [] });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true, checkedPermissions: [] });
  repository.findMyList.mockResolvedValue({ items: [], total: 0 });
  repository.findReviewList.mockResolvedValue({ items: [], total: 0 });
  repository.findByIdWithRelations.mockResolvedValue(ticket);
  repository.findCommentsByTicketId.mockResolvedValue([]);
  mocks.reviewList.mockResolvedValue({ items: [ticket], total: 1, page: 1, pageSize: 20, hasMore: false });
  mocks.reviewDetail.mockResolvedValue({ ticket, comments: [] });
});
describe("own ticket rollout and service mutation guards", () => {
  it("declares five self-service routes with server-owned actions and resource resolvers", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const routes = collectIamRoutes(
      new Project({ skipAddingFilesFromTsConfig: true }).addSourceFilesAtPaths(
        root + "src/api/controllers/v1/ticket/ticket.controller.ts",
      ),
      root,
    );
    const own = routes.filter((route) => !route.key.includes("/review"));
    expect(own).toHaveLength(5);
    expect(own.every((route) => route.coverage === "explicit" && !route.issues.length)).toBe(true);
  });
  it("does not fall back to old lists or writes after an enforce denial", async () => {
    mocks.list.mockRejectedValue(new Error("denied"));
    await expect(service.listMyTickets("actor", { page: 1, pageSize: 10 }, request)).rejects.toThrow("denied");
    expect(repository.findMyList).not.toHaveBeenCalled();
    mocks.target.mockRejectedValue(new Error("denied"));
    await expect(service.updateMyTicket("ticket", "actor", { title: "next" }, request)).rejects.toThrow("denied");
    await expect(service.addMyComment("ticket", "actor", { content: "next" }, request)).rejects.toThrow("denied");
    expect(repository.updateOwnTarget).not.toHaveBeenCalled();
    expect(repository.commentOwnTarget).not.toHaveBeenCalled();
  });
  it("preserves old read checks including role sessions in legacy and shadow", async () => {
    for (const mode of ["legacy", "shadow"]) {
      mocks.mode = mode;
      mocks.list.mockRejectedValue(new Error("IAM unavailable"));
      expect((await service.listMyTickets("actor", {}, request)).total).toBe(0);
      expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", expect.any(Array), {
        assumedRoleSessionId: "session",
      });
      permissions.checkUserPermissions.mockResolvedValueOnce({ hasPermission: false, checkedPermissions: [] });
      await expect(service.listMyTickets("actor", {}, request)).rejects.toMatchObject({ statusCode: 403 });
    }
  });
  it("retains closed-ticket business guards before writes", async () => {
    repository.readOwnDetail.mockResolvedValue({ ticket: { ...ticket, workflowStatus: "completed" }, comments: [] });
    await expect(service.updateMyTicket("ticket", "actor", { title: "next" }, request)).rejects.toMatchObject({
      statusCode: 400,
    });
    mocks.target.mockResolvedValue({
      target: { ...target, workflowStatus: "completed" },
      principal: { accountOwnerId: "owner" },
    });
    await expect(service.addMyComment("ticket", "actor", { content: "next" }, request)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(repository.updateOwnTarget).not.toHaveBeenCalled();
    expect(repository.commentOwnTarget).not.toHaveBeenCalled();
  });
  it("uses the write action for update responses rather than requiring an unrelated read grant", async () => {
    repository.updateOwnTarget.mockResolvedValue(ticket);
    await service.updateMyTicket("ticket", "actor", { title: "next" }, request);
    expect(repository.updateOwnTarget).toHaveBeenCalledWith(target, "owner", { title: "next" });
    expect(mocks.detail).toHaveBeenCalledWith("ticket", "actor", "quyan:ticket:UpdateOwnTicket", request);
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("rejects a policy revocation just before a comment transaction", async () => {
    mocks.target
      .mockResolvedValueOnce({ target, principal: { accountOwnerId: "owner" } })
      .mockRejectedValueOnce(new Error("revoked"));
    await expect(service.addMyComment("ticket", "actor", { content: "next" }, request)).rejects.toThrow("revoked");
    expect(repository.commentOwnTarget).not.toHaveBeenCalled();
  });
});

describe("review ticket read rollout", () => {
  it("dispatches enforce reads through the resource service without legacy queries", async () => {
    expect((await service.listReviewTickets({}, request)).items[0]!.id).toBe("ticket");
    expect((await service.getReviewTicketDetail("ticket", request)).id).toBe("ticket");
    expect(repository.findReviewList).not.toHaveBeenCalled();
    expect(repository.findByIdWithRelations).not.toHaveBeenCalled();
    expect(repository.findCommentsByTicketId).not.toHaveBeenCalled();
  });
  it("does not fall back after native denial", async () => {
    mocks.reviewList.mockRejectedValue(new Error("denied"));
    mocks.reviewDetail.mockRejectedValue(new Error("denied"));
    await expect(service.listReviewTickets({}, request)).rejects.toThrow("denied");
    await expect(service.getReviewTicketDetail("ticket", request)).rejects.toThrow("denied");
    expect(repository.findReviewList).not.toHaveBeenCalled();
    expect(repository.findByIdWithRelations).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"])("retains legacy session-aware checks in %s", async (mode) => {
    mocks.mode = mode;
    mocks.reviewList.mockRejectedValue(new Error("IAM unavailable"));
    mocks.reviewDetail.mockRejectedValue(new Error("IAM unavailable"));
    expect((await service.listReviewTickets({}, request)).total).toBe(0);
    expect((await service.getReviewTicketDetail("ticket", request)).id).toBe("ticket");
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", ["ticket:review:read"], {
      assumedRoleSessionId: "session",
    });
    if (mode === "shadow") {
      expect(mocks.reviewList).toHaveBeenCalledWith({}, request, false);
      expect(mocks.reviewDetail).toHaveBeenCalledWith("ticket", request, false);
    } else expect(mocks.reviewList).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false, checkedPermissions: [] });
    await expect(service.listReviewTickets({}, request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.getReviewTicketDetail("ticket", request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects missing request contexts and unsupported modes", async () => {
    await expect(service.listReviewTickets({})).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.getReviewTicketDetail("ticket")).rejects.toMatchObject({ statusCode: 403 });
    mocks.mode = "invalid";
    await expect(service.listReviewTickets({}, request)).rejects.toMatchObject({ statusCode: 403 });
  });
});
