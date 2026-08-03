import { describe, expect, it } from "vitest";
import { Permission } from "../../../src/constant/permission";
import { createRamPolicyBodySchema, updateRamPolicyBodySchema } from "../../../src/api/schema/users/ram.schema";

describe("RAM policy permission schemas", () => {
  it("accepts valid permission arrays for policy creation", () => {
    const result = createRamPolicyBodySchema.safeParse({
      name: "valid-policy",
      permissions: [Permission.USER_READ, Permission.RAM_POLICY_READ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects arbitrary permission strings for policy creation", () => {
    const result = createRamPolicyBodySchema.safeParse({
      name: "invalid-policy",
      permissions: [Permission.USER_READ, "not:a_permission"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects empty permission strings for policy creation", () => {
    const result = createRamPolicyBodySchema.safeParse({
      name: "empty-string-policy",
      permissions: [""],
    });

    expect(result.success).toBe(false);
  });

  it("rejects non-array permission payloads for policy creation", () => {
    const result = createRamPolicyBodySchema.safeParse({
      name: "non-array-policy",
      permissions: Permission.USER_READ,
    });

    expect(result.success).toBe(false);
  });

  it("rejects policy creation payloads with more than 500 permissions", () => {
    const result = createRamPolicyBodySchema.safeParse({
      name: "too-large-policy",
      permissions: Array.from({ length: 501 }, () => Permission.USER_READ),
    });

    expect(result.success).toBe(false);
  });

  it("allows empty policy permissions when business logic wants to clear grants", () => {
    const result = createRamPolicyBodySchema.safeParse({
      name: "empty-policy",
      permissions: [],
    });

    expect(result.success).toBe(true);
  });

  it("allows policy updates without permissions", () => {
    const result = updateRamPolicyBodySchema.safeParse({
      description: "metadata only",
    });

    expect(result.success).toBe(true);
  });

  it("accepts empty permission arrays for policy updates", () => {
    const result = updateRamPolicyBodySchema.safeParse({
      permissions: [],
    });

    expect(result.success).toBe(true);
  });

  it("rejects arbitrary permission strings for policy updates", () => {
    const result = updateRamPolicyBodySchema.safeParse({
      permissions: ["system:made_up"],
    });

    expect(result.success).toBe(false);
  });
});
