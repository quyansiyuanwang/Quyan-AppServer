import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Permission } from "@quyan/shared";
const document = JSON.parse(readFileSync(resolve(process.cwd(), "src/build/swagger.json"), "utf8"));
describe("generated resource-authorized relay token read contract", () => {
  it.each(["/v1/relay/tokens", "/v1/relay/tokens/{id}"])(
    "preserves authenticated OAuth-scope admission for %s",
    (path) => {
      const operation = document.paths[path].get;
      expect(operation.security).toContainEqual({ jwt: [Permission.RELAY_TOKEN_READ] });
      expect(operation.responses).toHaveProperty("401");
      expect(operation.responses).toHaveProperty("403");
    },
  );
  it("permits metadata-only DTOs without replacing the credential with another required field", () => {
    const schema = document.components.schemas.RelayTokenDto;
    expect(schema.properties.token).toMatchObject({ type: "string" });
    expect(schema.required).not.toContain("token");
    expect(schema.required).toEqual(
      expect.arrayContaining(["id", "userId", "status", "quotaWindows", "channelConfigs"]),
    );
    expect(schema.properties).not.toHaveProperty("legacyToken");
    expect(schema.properties).not.toHaveProperty("upstreamApiKey");
  });
});
