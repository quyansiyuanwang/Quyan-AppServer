import { describe, expect, it } from "vitest";
import {
  productResourceAliasParamsSchema,
  productResourceIdParamsSchema,
  productResourceKvParamsSchema,
} from "../../../src/api/schema/developer/product-platform.schema";

describe("developer product resource parameter schemas", () => {
  it("keeps the KV instance ID and key in one parsed parameter object", () => {
    expect(productResourceKvParamsSchema.parse({ instanceId: "instance_1", key: "theme" })).toEqual({
      instanceId: "instance_1",
      key: "theme",
    });
  });

  it("keeps both instance and resource IDs for mutable resource routes", () => {
    expect(productResourceIdParamsSchema.parse({ instanceId: "instance_1", id: "link_1" })).toEqual({
      instanceId: "instance_1",
      id: "link_1",
    });
  });

  it("keeps the secret alias with its instance ID", () => {
    expect(productResourceAliasParamsSchema.parse({ instanceId: "instance_1", alias: "OPENAI_KEY" })).toEqual({
      instanceId: "instance_1",
      alias: "OPENAI_KEY",
    });
  });

  it("rejects a missing resource key instead of silently stripping it", () => {
    expect(productResourceKvParamsSchema.safeParse({ instanceId: "instance_1" }).success).toBe(false);
  });
});
