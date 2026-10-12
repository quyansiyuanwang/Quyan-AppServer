import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { UserScriptRepository } from "@/store/user-script.repository";
import type { TypedRequest } from "@/types/express";
const mocks = vi.hoisted(() => ({ mode: "enforce", check: vi.fn(), list: vi.fn(), create: vi.fn(), target: vi.fn() }));
vi.mock("@/config/env", () => ({
  env: {
    security: {
      get iamAuthorizationMode() {
        return mocks.mode;
      },
    },
  },
}));
vi.mock("@/store/user-script.repository", () => ({ UserScriptRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({
  PermissionService: { getInstance: () => ({ checkUserPermissions: mocks.check }) },
}));
vi.mock("@/services/user-script/user-script-iam.service", () => ({
  UserScriptIamService: {
    getInstance: () => ({ list: mocks.list, authorizeCreate: mocks.create, authorizeTarget: mocks.target }),
  },
}));
vi.mock("@/util/logger", () => ({ getLogger: () => ({ warn: vi.fn() }), LogCategory: { SECURITY: "security" } }));
import { UserScriptService } from "@/services/user-script/user-script.service";
const repository = mockDeep<UserScriptRepository>();
const Service = UserScriptService as unknown as new (repository: UserScriptRepository) => UserScriptService;
const service = new Service(repository);
const request = { user: { userId: "actor", roleSessionId: "session" } } as unknown as TypedRequest;
const row = {
  id: "script",
  userId: "actor",
  name: "fixture",
  description: null,
  status: 1,
  content: "private",
  createTime: new Date(),
  updateTime: new Date(),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.mode = "enforce";
  repository.findByUserId.mockResolvedValue([row]);
  mocks.check.mockResolvedValue({ hasPermission: true });
});
describe("script rollout modes and service mutation guards", () => {
  it("never falls back to legacy storage after an enforce denial", async () => {
    mocks.list.mockRejectedValue(new Error("denied"));
    await expect(service.listScripts("actor", request)).rejects.toThrow("denied");
    expect(repository.findByUserId).not.toHaveBeenCalled();
    expect(mocks.check).not.toHaveBeenCalled();
    mocks.target.mockRejectedValue(new Error("denied"));
    await expect(service.updateScript("script", { content: "change" }, "actor", request)).rejects.toThrow("denied");
    await expect(service.deleteScript("script", "actor", request)).rejects.toThrow("denied");
    expect(repository.updateTarget).not.toHaveBeenCalled();
    expect(repository.deleteTarget).not.toHaveBeenCalled();
  });
  it("preserves legacy permissions and role-session checks in legacy and shadow modes", async () => {
    for (const mode of ["legacy", "shadow"]) {
      mocks.mode = mode;
      mocks.list.mockRejectedValue(new Error("IAM unavailable"));
      expect((await service.listScripts("actor", request))[0].id).toBe("script");
      expect(mocks.check).toHaveBeenCalledWith("actor", expect.any(Array), { assumedRoleSessionId: "session" });
      mocks.check.mockResolvedValueOnce({ hasPermission: false });
      await expect(service.listScripts("actor", request)).rejects.toMatchObject({ statusCode: 403 });
    }
  });
  it("uses fresh IAM target metadata for scoped writes and retains legacy ownership guards", async () => {
    const target = { id: row.id, userId: row.userId, createTime: row.createTime, updateTime: row.updateTime };
    mocks.target.mockResolvedValue({ target, principal: { accountOwnerId: "owner" } });
    repository.updateTarget.mockResolvedValue(row);
    await service.updateScript("script", { name: "next" }, "actor", request);
    expect(repository.updateTarget).toHaveBeenCalledWith(target, "owner", { name: "next" });
    mocks.mode = "legacy";
    repository.findById.mockResolvedValue({ ...row, userId: "other" });
    await expect(service.deleteScript("script", "actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.delete).not.toHaveBeenCalled();
  });
});
