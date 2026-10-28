import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  group: { findMany: vi.fn() },
  ramRole: { findMany: vi.fn() },
  ramPolicyAttachment: { findMany: vi.fn() },
}));
vi.mock("@/config/database", () => ({ prisma: db }));
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
const repository = RamPolicyRepository.getInstance();
beforeEach(() => {
  vi.resetAllMocks();
  for (const model of [db.user, db.group, db.ramRole]) model.findMany.mockResolvedValue([{ id: "target" }]);
  db.ramPolicyAttachment.findMany.mockResolvedValue([]);
});
describe("explicit account scope for direct policy reads", () => {
  it.each(["user", "group", "role"])(
    "requires active %s membership and scopes both attachment and policy",
    async (type) => {
      await repository.listPoliciesForTarget(type, "target", "owner");
      expect(db.ramPolicyAttachment.findMany.mock.calls[0]![0].where).toEqual({
        accountOwnerId: "owner",
        targetType: type,
        targetId: { in: ["target"] },
        status: 1,
        policy: { accountOwnerId: "owner", status: 1 },
      });
      const model = type === "user" ? db.user : type === "group" ? db.group : db.ramRole;
      expect(model.findMany.mock.calls[0]![0]).toMatchObject({
        where: { id: { in: ["target"] }, status: 1 },
        select: { id: true },
      });
      expect(model.findMany.mock.calls[0]![0].where).toMatchObject(
        type === "user"
          ? { OR: [{ accountOwnerId: "owner" }, { id: "owner", accountOwnerId: null }] }
          : type === "group"
            ? { OR: [{ accountOwnerId: "owner" }, { accountOwnerId: null }] }
            : { accountOwnerId: "owner" },
      );
    },
  );
  it("filters batch targets before reading attachments", async () => {
    db.ramRole.findMany.mockResolvedValue([{ id: "local" }]);
    await repository.listPoliciesForTargets("role", ["local", "foreign", "local"], "owner");
    expect(db.ramRole.findMany.mock.calls[0]![0].where.id).toEqual({ in: ["local", "foreign"] });
    expect(db.ramPolicyAttachment.findMany.mock.calls[0]![0].where.targetId).toEqual({ in: ["local"] });
  });
  it("does not read grants for absent, disabled or out-of-account targets", async () => {
    db.user.findMany.mockResolvedValue([]);
    expect(await repository.listPoliciesForTarget("user", "target", "owner")).toEqual([]);
    expect(db.ramPolicyAttachment.findMany).not.toHaveBeenCalled();
  });
  it("fails closed if the account scope is omitted at runtime or the target type is unsupported", async () => {
    expect(await repository.listPoliciesForTarget("user", "target", undefined as never)).toEqual([]);
    expect(await repository.listPoliciesForTarget("invented", "target", "owner")).toEqual([]);
    expect(await repository.listPoliciesForTargets("role", [], "owner")).toEqual([]);
    expect(db.ramPolicyAttachment.findMany).not.toHaveBeenCalled();
  });
  it("propagates lookup failures instead of reverting to unscoped grants", async () => {
    db.user.findMany.mockRejectedValue(new Error("fixture unavailable"));
    await expect(repository.listPoliciesForTarget("user", "target", "owner")).rejects.toThrow("fixture unavailable");
    expect(db.ramPolicyAttachment.findMany).not.toHaveBeenCalled();
  });
});
