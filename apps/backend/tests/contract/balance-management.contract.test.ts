import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { IAM_BALANCE_MANAGEMENT_OPERATIONS, Permission } from "@quyan/shared";
const document = JSON.parse(readFileSync(resolve(process.cwd(), "src/build/swagger.json"), "utf8"));
describe("generated balance management contract", () => {
  it.each(IAM_BALANCE_MANAGEMENT_OPERATIONS)(
    "requires JWT and replay protection for $operation",
    ({ route, accessLevel }) => {
      const [method, path] = route.split(" ");
      const operation = document.paths[path!][method!.toLowerCase()];
      expect(operation.security).toContainEqual({ jwt: [] });
      if (method === "POST") expect(operation["X-Replay-Protected"]).toBe(true);
      if (accessLevel === "Write")
        expect(operation["X-Two-Factor-Challenge"]).toMatchObject({
          required: true,
          purpose: "stepup",
          method: "code",
        });
    },
  );
  it("keeps independent permissions for reads, corrections, and credit policies", () => {
    expect(new Set(IAM_BALANCE_MANAGEMENT_OPERATIONS.map((operation) => operation.permission))).toEqual(
      new Set([
        Permission.BALANCE_MANAGEMENT_READ,
        Permission.BALANCE_ACCOUNT_ADJUST,
        Permission.BALANCE_OVERDRAFT_MANAGE,
      ]),
    );
    expect(
      IAM_BALANCE_MANAGEMENT_OPERATIONS.some(
        (operation) => String(operation.permission) === Permission.BALANCE_RECHARGE,
      ),
    ).toBe(false);
  });
});
