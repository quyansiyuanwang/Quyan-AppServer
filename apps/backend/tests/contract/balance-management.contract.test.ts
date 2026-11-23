import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { IAM_BALANCE_MANAGEMENT_OPERATIONS, Permission } from "@quyan/shared";
const document = JSON.parse(readFileSync(resolve(process.cwd(), "src/build/swagger.json"), "utf8"));
describe("generated balance management contract", () => {
  it("supports username and legacy ID selectors for overdraft previews", () => {
    const schema = document.components.schemas.PreviewOverdraftRequest;
    expect(schema.properties.usernames).toMatchObject({ type: "array", items: { type: "string" } });
    expect(schema.properties.userIds).toMatchObject({ type: "array", items: { type: "string" } });
    expect(schema.required ?? []).not.toContain("usernames");
    expect(schema.required ?? []).not.toContain("userIds");
  });
  it("exposes self-service credit without changing managed account responses", () => {
    const operation = document.paths["/v1/balance/account"].get;
    expect(operation.security).toContainEqual({ jwt: ["balance:read"] });
    expect(operation.responses["200"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/MyBalanceAccountResponse",
    });
    const schemas = document.components.schemas;
    expect(schemas.MyBalanceAccountResponse.properties.overdraft.$ref).toBe(
      "#/components/schemas/BalanceOverdraftSummary",
    );
    expect(schemas.MyBalanceAccountResponse.required).not.toContain("overdraft");
    expect(schemas.BalanceAccountResponse.properties).not.toHaveProperty("overdraft");
    expect(schemas.BalanceOverdraftSummary.required).toEqual(
      expect.arrayContaining([
        "overdraftLimit",
        "usedOverdraft",
        "remainingOverdraft",
        "categories",
        "calculationError",
        "accountActive",
      ]),
    );
    expect(schemas.BalanceOverdraftSummary.properties).not.toHaveProperty("rule");
  });

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
