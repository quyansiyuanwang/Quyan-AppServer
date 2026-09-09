import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, Permission } from "../../../src/constant/permission";
import { setGroupPermissionsBodySchema } from "../../../src/api/schema/users/group.schema";

describe("group permission schema", () => {
  it("accepts the complete shared permission catalog", () => {
    const result = setGroupPermissionsBodySchema.safeParse({ permissions: ALL_PERMISSIONS });

    expect(result.success).toBe(true);
    expect(ALL_PERMISSIONS.length).toBeGreaterThan(200);
  });

  it("rejects permission values outside the shared catalog", () => {
    const result = setGroupPermissionsBodySchema.safeParse({
      permissions: [Permission.USER_READ, "group:not-defined"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects an array larger than the shared catalog", () => {
    const result = setGroupPermissionsBodySchema.safeParse({
      permissions: Array.from({ length: ALL_PERMISSIONS.length + 1 }, () => Permission.USER_READ),
    });

    expect(result.success).toBe(false);
  });
});
