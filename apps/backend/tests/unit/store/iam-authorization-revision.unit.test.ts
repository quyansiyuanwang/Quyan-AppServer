import { beforeEach, describe, expect, it, vi } from "vitest";
import { readIamAuthorizationRevision } from "@/store/users/iam-authorization-revision";
const names = [
  "user",
  "group",
  "ramPolicy",
  "ramPolicyVersion",
  "ramPolicyAttachment",
  "ramAuthorization",
  "ramRole",
  "ramUserRoleBinding",
  "ramGroupRoleBinding",
  "ramRoleSession",
  "ramResourceGroup",
  "ramResourceGroupMember",
] as const;
let client: any;
beforeEach(() => {
  client = Object.fromEntries(names.map((name) => [name, { findMany: vi.fn().mockResolvedValue([]) }]));
});
describe("transaction authorization graph revision", () => {
  it("reads a stable account-scoped sequence without credential or document fields", async () => {
    expect(await readIamAuthorizationRevision(client, "owner")).toHaveLength(64);
    for (const name of names) {
      const args = client[name].findMany.mock.calls[0][0];
      const where =
        name === "user"
          ? { OR: [{ accountOwnerId: "owner" }, { id: "owner", accountOwnerId: null }] }
          : name === "group"
            ? { OR: [{ accountOwnerId: "owner" }, { id: { in: [] } }] }
            : name === "ramPolicyVersion"
              ? { policy: { accountOwnerId: "owner" } }
              : { accountOwnerId: "owner" };
      expect(args.where).toEqual(where);
      expect(args.orderBy).toEqual({ id: "asc" });
      for (const key of ["document", "tokenJtiHash", "ipAddress", "userAgent", "description", "password"])
        expect(args.select).not.toHaveProperty(key);
    }
  });
  it.each(names)("detects %s additions and revision changes", async (name) => {
    const initial = await readIamAuthorizationRevision(client, "owner");
    client[name].findMany.mockResolvedValue([{ id: "record", status: 1, updateTime: new Date(0) }]);
    const inserted = await readIamAuthorizationRevision(client, "owner");
    expect(inserted).not.toBe(initial);
    client[name].findMany.mockResolvedValue([{ id: "record", status: 0, updateTime: new Date(1) }]);
    expect(await readIamAuthorizationRevision(client, "owner")).not.toBe(inserted);
  });
  it("does not conceal a failed authorization-data read", async () => {
    client.ramAuthorization.findMany.mockRejectedValue(new Error("fixture unavailable"));
    await expect(readIamAuthorizationRevision(client, "owner")).rejects.toThrow("fixture unavailable");
    expect(client.ramRole.findMany).not.toHaveBeenCalled();
  });
  it("includes the persisted global group and legacy permission overrides, even when timestamps stay unchanged", async () => {
    client.user.findMany.mockResolvedValue([
      {
        id: "actor",
        groupId: "global-group",
        status: 1,
        updateTime: new Date(0),
        permissionAdds: [],
        permissionRemoves: [],
      },
    ]);
    client.group.findMany.mockResolvedValue([
      { id: "global-group", accountOwnerId: null, permissions: ["fixture:Read"], status: 1, updateTime: new Date(0) },
    ]);
    const before = await readIamAuthorizationRevision(client, "owner");
    expect(client.group.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { OR: [{ accountOwnerId: "owner" }, { id: { in: ["global-group"] } }] } }),
    );
    client.group.findMany.mockResolvedValue([
      { id: "global-group", accountOwnerId: null, permissions: [], status: 1, updateTime: new Date(0) },
    ]);
    const changed = await readIamAuthorizationRevision(client, "owner");
    expect(changed).not.toBe(before);
    client.user.findMany.mockResolvedValue([
      {
        id: "actor",
        groupId: "global-group",
        status: 1,
        updateTime: new Date(0),
        permissionAdds: [],
        permissionRemoves: ["fixture:Read"],
      },
    ]);
    expect(await readIamAuthorizationRevision(client, "owner")).not.toBe(changed);
  });
});
