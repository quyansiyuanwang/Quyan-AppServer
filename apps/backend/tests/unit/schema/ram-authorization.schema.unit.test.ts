import { describe, expect, it } from "vitest";
import {
  createIamAuthorizationBodySchema,
  iamAuthorizationQuerySchema,
  iamResourceGroupQuerySchema,
} from "@/api/schema/users/ram.schema";
describe("RAM authorization scope schemas", () => {
  const base = { principalType: "user", principalId: "user", policyId: "policy" };
  it.each([
    { scopeType: "account" },
    { scopeType: "resource-group", scopeResourceId: "group" },
    { scopeType: "resource", scopeArn: "acs:quyan:*:owner:user/target" },
  ])("accepts exactly the fields for the selected scope %j", (scope) =>
    expect(createIamAuthorizationBodySchema.safeParse({ ...base, ...scope }).success).toBe(true),
  );
  it.each([
    { scopeType: "unknown" },
    { scopeType: "account", scopeArn: "*" },
    { scopeType: "account", scopeResourceId: "group" },
    { scopeType: "resource-group" },
    { scopeType: "resource-group", scopeResourceId: "group", scopeArn: "*" },
    { scopeType: "resource" },
    { scopeType: "resource", scopeArn: "*", scopeResourceId: "group" },
  ])("rejects ambiguous or invalid scope %j", (scope) =>
    expect(createIamAuthorizationBodySchema.safeParse({ ...base, ...scope }).success).toBe(false),
  );
  it("rejects invented principal types and unknown payload fields", () => {
    expect(
      createIamAuthorizationBodySchema.safeParse({ ...base, scopeType: "account", principalType: "root" }).success,
    ).toBe(false);
    expect(
      createIamAuthorizationBodySchema.safeParse({ ...base, scopeType: "account", accountOwnerId: "foreign" }).success,
    ).toBe(false);
  });
  it("bounds account-scoped pages before row authorization", () => {
    expect(iamAuthorizationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 50 });
    expect(iamResourceGroupQuerySchema.parse({ page: "2", pageSize: "10" })).toEqual({ page: 2, pageSize: 10 });
    for (const pageSize of [0, 101, NaN])
      expect(iamAuthorizationQuerySchema.safeParse({ pageSize }).success).toBe(false);
    expect(iamResourceGroupQuerySchema.safeParse({ page: -1 }).success).toBe(false);
  });
});
