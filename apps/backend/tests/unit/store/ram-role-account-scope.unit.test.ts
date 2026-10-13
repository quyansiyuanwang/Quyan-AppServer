import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
  group: { findFirst: vi.fn() },
  ramUserRoleBinding: { findMany: vi.fn() },
  ramGroupRoleBinding: { findMany: vi.fn() },
  ramPolicyAttachment: { findMany: vi.fn() },
}));
vi.mock("@/config/database", () => ({ prisma: db }));
import { RamRoleRepository } from "@/store/users/ram-role.repository";
const repository = RamRoleRepository.getInstance();
beforeEach(() => {
  vi.resetAllMocks();
  db.user.findFirst.mockResolvedValue({
    id: "actor",
    accountOwnerId: "owner",
    groupId: "group",
    group: { id: "group", status: 1, accountOwnerId: null },
  });
  db.group.findFirst.mockResolvedValue({ id: "group", accountOwnerId: "owner" });
  db.ramUserRoleBinding.findMany.mockResolvedValue([
    { id: "binding", roleId: "role", userId: "actor", role: { name: "Role" } },
  ]);
  db.ramGroupRoleBinding.findMany.mockResolvedValue([]);
  db.ramPolicyAttachment.findMany.mockResolvedValue([]);
});
describe("role grant account scope", () => {
  it("scopes bindings, roles, attachments and policies to the persisted user account", async () => {
    await repository.listRoleBindingsForUser("actor", "group");
    expect(db.user.findFirst.mock.calls[0]![0].where).toEqual({ id: "actor", status: 1 });
    expect(db.ramUserRoleBinding.findMany.mock.calls[0]![0].where).toEqual({
      userId: "actor",
      accountOwnerId: "owner",
      status: 1,
      role: { accountOwnerId: "owner", status: 1 },
    });
    expect(db.ramGroupRoleBinding.findMany.mock.calls[0]![0].where).toEqual({
      groupId: "group",
      accountOwnerId: "owner",
      status: 1,
      role: { accountOwnerId: "owner", status: 1 },
    });
    expect(db.ramPolicyAttachment.findMany.mock.calls[0]![0].where).toEqual({
      accountOwnerId: "owner",
      targetType: "role",
      targetId: { in: ["role"] },
      status: 1,
      policy: { accountOwnerId: "owner", status: 1 },
    });
  });
  it("uses the user's own ID for a root account", async () => {
    db.user.findFirst.mockResolvedValue({ id: "owner", accountOwnerId: null, groupId: null });
    await repository.listRoleBindingsForUser("owner");
    expect(db.ramUserRoleBinding.findMany.mock.calls[0]![0].where.accountOwnerId).toBe("owner");
  });
  it.each([
    {
      id: "actor",
      accountOwnerId: "owner",
      groupId: "different",
      group: { id: "different", status: 1, accountOwnerId: "owner" },
    },
    {
      id: "actor",
      accountOwnerId: "owner",
      groupId: "group",
      group: { id: "group", status: 0, accountOwnerId: "owner" },
    },
    {
      id: "actor",
      accountOwnerId: "owner",
      groupId: "group",
      group: { id: "group", status: 1, accountOwnerId: "foreign" },
    },
  ])("never uses a supplied, disabled or foreign group as the user's group", async (user) => {
    db.user.findFirst.mockResolvedValue(user);
    await repository.listRoleBindingsForUser("actor", "group");
    expect(db.ramGroupRoleBinding.findMany).not.toHaveBeenCalled();
  });
  it("returns no grants for an absent or inactive user without querying bindings", async () => {
    db.user.findFirst.mockResolvedValue(null);
    expect(await repository.listRoleBindingsForUser("actor", "group")).toEqual([]);
    expect(db.ramUserRoleBinding.findMany).not.toHaveBeenCalled();
    expect(db.ramGroupRoleBinding.findMany).not.toHaveBeenCalled();
  });
  it("supports the internal account-owned group delegation projection without a fictitious user", async () => {
    await repository.listRoleBindingsForUser("", "group");
    expect(db.user.findFirst).not.toHaveBeenCalled();
    expect(db.ramUserRoleBinding.findMany).not.toHaveBeenCalled();
    expect(db.group.findFirst.mock.calls[0]![0].where).toEqual({
      id: "group",
      status: 1,
      accountOwnerId: { not: null },
    });
    expect(db.ramGroupRoleBinding.findMany.mock.calls[0]![0].where.accountOwnerId).toBe("owner");
    expect(db.ramPolicyAttachment.findMany).not.toHaveBeenCalled();
  });
  it("fails closed for unavailable account-owned group projections and query failures", async () => {
    db.group.findFirst.mockResolvedValue(null);
    expect(await repository.listRoleBindingsForUser("", "group")).toEqual([]);
    db.user.findFirst.mockRejectedValue(new Error("fixture unavailable"));
    await expect(repository.listRoleBindingsForUser("actor", "group")).rejects.toThrow("fixture unavailable");
  });
});
