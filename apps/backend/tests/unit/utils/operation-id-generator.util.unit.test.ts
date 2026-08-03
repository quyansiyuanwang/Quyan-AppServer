import { describe, expect, it } from "vitest";
import { generateUniqueOperationId, generateUniqueOperationIdWithSet } from "@/util/operationIdGenerator";

describe("operationIdGenerator util", () => {
  it("builds operationId from controller, path and method", () => {
    const id = generateUniqueOperationId("User", "/accounts/{id}", "get");

    expect(id).toBe("UserServiceAccountsIdGet");
  });

  it("removes repeated controller prefix from formatted path", () => {
    const id = generateUniqueOperationId("User", "/user/profile", "post");

    expect(id).toBe("UserServiceProfilePost");
  });

  it("strips non-letter characters from path segments", () => {
    const id = generateUniqueOperationId("Relay", "/v1/models/{model-id}", "put");

    expect(id).toBe("RelayServiceVModelsModelidPut");
  });

  it("adds numeric suffix when operationId is already used", () => {
    const used = new Set<string>();

    const first = generateUniqueOperationIdWithSet("RelayServiceProxyPost", used);
    const second = generateUniqueOperationIdWithSet("RelayServiceProxyPost", used);
    const third = generateUniqueOperationIdWithSet("RelayServiceProxyPost", used);

    expect(first).toBe("RelayServiceProxyPost");
    expect(second).toBe("RelayServiceProxyPost_1");
    expect(third).toBe("RelayServiceProxyPost_2");
    expect(used.has("RelayServiceProxyPost_2")).toBe(true);
  });
});
