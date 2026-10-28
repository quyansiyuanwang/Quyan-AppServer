import { beforeEach, describe, expect, it, vi } from "vitest";
import { getIamActionDefinition } from "@quyan/shared";

const { findActiveBackingProjectId } = vi.hoisted(() => ({ findActiveBackingProjectId: vi.fn() }));
vi.mock("@/store/developer/developer-product-instance.repository", () => ({
  DeveloperProductInstanceRepository: {
    getInstance: () => ({ findActiveBackingProjectId }),
  },
}));

import {
  developerProductKvItemResourceResolver,
  developerProductKvProjectResourceResolver,
  developerProductInstanceProjectResourceResolver,
  developerProductSecretInstanceProjectResourceResolver,
  developerProductSecretInstanceResourceResolver,
} from "@/iam/request/developer-product-resource-resolvers";
import type { TypedRequest } from "@/types/express";

const principal = {
  subjectUserId: "user-1",
  principalUserId: "user-1",
  accountOwnerId: "account-1",
  subjectType: "sub_user" as const,
};
const request = (params: Record<string, string>, body: unknown = {}) => ({ params, body }) as unknown as TypedRequest;

beforeEach(() => {
  vi.clearAllMocks();
  findActiveBackingProjectId.mockResolvedValue("project-1");
});

describe("developer product resource IAM resolvers", () => {
  it("resolves a product instance to its account-owned backing project", async () => {
    await expect(
      developerProductKvProjectResourceResolver({ request: request({ instanceId: "instance-1" }), principal }),
    ).resolves.toBe("acs:developer:*:account-1:project/project-1");
    expect(findActiveBackingProjectId).toHaveBeenCalledWith("instance-1", "kv", "account-1");
  });

  it("resolves self-service instance routes from the shared product catalog", async () => {
    await expect(
      developerProductInstanceProjectResourceResolver({
        request: request({ product: "kv", instanceId: "instance-1" }),
        principal,
      }),
    ).resolves.toBe("acs:developer:*:account-1:project/project-1");
    expect(findActiveBackingProjectId).toHaveBeenCalledWith("instance-1", "kv", "account-1");

    await expect(
      developerProductInstanceProjectResourceResolver({
        request: request({ product: "unknown", instanceId: "instance-1" }),
        principal,
      }),
    ).resolves.toBeUndefined();
  });

  it("uses the exact KV item ARN while keeping the product instance as the ownership boundary", async () => {
    await expect(
      developerProductKvItemResourceResolver({
        request: request({ instanceId: "instance-1", key: "config:prod" }),
        principal,
      }),
    ).resolves.toBe("acs:developer:*:account-1:kv-item/project-1/Y29uZmlnOnByb2Q");
  });

  it("rejects malformed identifiers and an instance owned by another account", async () => {
    await expect(
      developerProductKvItemResourceResolver({
        request: request({ instanceId: "instance-1", key: "bad/key" }),
        principal,
      }),
    ).resolves.toBeUndefined();
    findActiveBackingProjectId.mockResolvedValueOnce(undefined);
    await expect(
      developerProductSecretInstanceProjectResourceResolver({
        request: request({ secretInstanceId: "secret-instance" }),
        principal,
      }),
    ).resolves.toBeUndefined();
  });

  it("resolves nested secret writes to the secret resource, never the push instance", async () => {
    await expect(
      developerProductSecretInstanceResourceResolver({
        request: request({ secretInstanceId: "secret-instance" }, { alias: "API_TOKEN" }),
        principal,
      }),
    ).resolves.toBe("acs:developer:*:account-1:secret/project-1/API_TOKEN");
  });

  it("registers dedicated JSON endpoint and product instance actions", () => {
    expect(getIamActionDefinition("quyan:developer:GetJsonEndpoint")).toMatchObject({
      resourceTypes: ["developer/project"],
      accessLevel: "Read",
    });
    expect(getIamActionDefinition("quyan:developer:UpdateJsonEndpoint")).toMatchObject({
      resourceTypes: ["developer/project"],
      accessLevel: "Write",
    });
    expect(getIamActionDefinition("quyan:developer:ListProductInstances")).toMatchObject({
      resourceTypes: ["quyan/account"],
      accessLevel: "List",
    });
    expect(getIamActionDefinition("quyan:developer:CreateProductInstance")).toMatchObject({
      resourceTypes: ["quyan/account"],
      accessLevel: "Write",
    });
    expect(getIamActionDefinition("quyan:developer:RevokeProductInstanceKey")).toMatchObject({
      resourceTypes: ["developer/project"],
      accessLevel: "Write",
    });
  });
});
