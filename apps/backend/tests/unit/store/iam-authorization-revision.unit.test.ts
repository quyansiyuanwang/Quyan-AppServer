import { beforeEach, describe, expect, it, vi } from "vitest";
import { readIamAuthorizationRevision } from "@/store/users/iam-authorization-revision";
const names = [
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
      expect(args.where).toEqual(
        name === "ramPolicyVersion" ? { policy: { accountOwnerId: "owner" } } : { accountOwnerId: "owner" },
      );
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
});
