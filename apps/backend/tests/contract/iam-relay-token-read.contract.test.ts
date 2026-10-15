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
  it("keeps export credentials required under its separate authenticated operation", () => {
    const operation = document.paths["/v1/relay/tokens/export"].post;
    expect(operation.security).toContainEqual({ jwt: [Permission.RELAY_TOKEN_READ] });
    expect(operation.responses).toHaveProperty("403");
    expect(document.components.schemas.RelayTokenExportItemDto.required).toContain("token");
  });
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

describe("generated resource-authorized relay token deletion contract", () => {
  it.each([
    ["/v1/relay/tokens/{id}", "delete"],
    ["/v1/relay/tokens/batch/delete", "post"],
  ])("retains authenticated delete scope, replay and step-up protection for %s %s", (path, method) => {
    const operation = document.paths[path!][method!];
    expect(operation.security).toContainEqual({ jwt: [Permission.RELAY_TOKEN_DELETE] });
    expect(operation["X-Replay-Protected"]).toBe(true);
    expect(operation["X-Two-Factor-Challenge"]).toMatchObject({ required: true, purpose: "stepup", method: "code" });
    expect(operation.responses).toHaveProperty("401");
    expect(operation.responses).toHaveProperty("403");
  });
});

describe("generated resource-authorized token batch metadata contract", () => {
  it.each([
    ["/v1/relay/tokens/batch/status", "patch"],
    ["/v1/relay/tokens/batch/content-safety", "post"],
  ])("retains UPDATE scope, replay and step-up protection for %s %s", (path, method) => {
    const operation = document.paths[path!][method!];
    expect(operation.security).toContainEqual({ jwt: [Permission.RELAY_TOKEN_UPDATE] });
    expect(operation["X-Replay-Protected"]).toBe(true);
    expect(operation["X-Two-Factor-Challenge"]).toMatchObject({ required: true, purpose: "stepup", method: "code" });
    expect(operation.responses).toHaveProperty("401");
    expect(operation.responses).toHaveProperty("403");
  });
  it("requires a real JSON boolean and retains the bounded batch result contract", () => {
    expect(document.components.schemas.BatchSetRelayTokenStatusRequest.properties.enabled).toEqual({ type: "boolean" });
    expect(document.components.schemas.BatchSetRelayTokenStatusRequest.required).toContain("enabled");
    expect(document.components.schemas.BatchRelayTokensResultDto.required).toEqual(
      expect.arrayContaining(["total", "affected"]),
    );
    expect(document.components.schemas.BatchRelayTokensResultDto.properties).not.toHaveProperty("token");
  });
});

describe("generated resource-authorized token usage contract", () => {
  it.each(["/v1/relay/tokens/{id}/usage", "/v1/relay/tokens/{id}/usage-summary"])(
    "retains authenticated usage scope and safe denial responses for %s",
    (path) => {
      const operation = document.paths[path].get;
      expect(operation.security).toContainEqual({ jwt: ["relay:usage:read"] });
      expect(operation.responses).toHaveProperty("401");
      expect(operation.responses).toHaveProperty("403");
    },
  );
  it.each(["RelayUsageStatsDto", "RelayTokenUsageDetailDto"])("does not add credential fields to %s", (name) => {
    const properties = document.components.schemas[name].properties;
    expect(properties).not.toHaveProperty("token");
    expect(properties).not.toHaveProperty("upstreamApiKey");
    expect(properties).not.toHaveProperty("legacyToken");
  });
});

describe("generated atomic token lifecycle contract", () => {
  it.each([
    ["/v1/relay/tokens/{id}/toggle", "patch"],
    ["/v1/relay/tokens/{id}/refresh", "post"],
  ])("retains UPDATE OAuth scope, replay, step-up and denial responses for %s %s", (path, method) => {
    const operation = document.paths[path!][method!];
    expect(operation.security).toContainEqual({ jwt: [Permission.RELAY_TOKEN_UPDATE] });
    expect(operation["X-Replay-Protected"]).toBe(true);
    expect(operation["X-Two-Factor-Challenge"]).toMatchObject({ required: true, purpose: "stepup", method: "code" });
    expect(operation.responses).toHaveProperty("401");
    expect(operation.responses).toHaveProperty("403");
    expect(operation.responses["200"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/RelayTokenDto",
    });
  });
});
