import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const document = JSON.parse(readFileSync(resolve(process.cwd(), "src/build/swagger.json"), "utf8"));
describe("generated channel change request read contract", () => {
  it.each(["/v1/relay-channels/change-requests/mine", "/v1/relay-channels/change-requests"])(
    "keeps JWT authentication, safe errors and pagination for %s",
    (path) => {
      const operation = document.paths[path].get;
      expect(operation.security).toContainEqual({ jwt: [] });
      expect(operation.responses).toHaveProperty("401");
      expect(operation.responses).toHaveProperty("403");
      expect(operation.parameters.map((parameter: { name: string }) => parameter.name)).toEqual(
        expect.arrayContaining(["page", "pageSize"]),
      );
    },
  );
  it("does not add credential fields to the public change request DTO", () => {
    const schema = document.components.schemas.RelayChannelChangeRequestDto;
    expect(schema.required).toEqual(expect.arrayContaining(["id", "relayChannelId", "submittedByUserId", "config"]));
    for (const field of ["encryptedCredentials", "credentialIv", "credentialAuthTag"])
      expect(schema.properties).not.toHaveProperty(field);
  });
});

describe("generated full-admission channel topology contract", () => {
  it("retains READ OAuth admission, report shape and safe errors", () => {
    const operation = document.paths["/v1/relay-channels/topology-audit"].get;
    expect(operation.security).toContainEqual({ jwt: ["relay:channel:read"] });
    expect(operation.responses).toHaveProperty("401");
    expect(operation.responses).toHaveProperty("403");
    expect(document.components.schemas.RelayChannelTopologyAuditDto.required).toEqual(
      expect.arrayContaining(["mode", "canEnableStrict", "issues"]),
    );
  });
});

describe("generated resource-scoped channel configuration reads", () => {
  it.each([
    ["/v1/relay-channels", ["relay:channel:read"]],
    ["/v1/relay-channels/{id}", []],
  ])("preserves OAuth admission and errors for %s", (path, scopes) => {
    const operation = document.paths[path as string].get;
    expect(operation.security).toContainEqual({ jwt: scopes });
    expect(operation.responses).toHaveProperty("401");
    expect(operation.responses).toHaveProperty("403");
  });
  it("exposes only credential-presence booleans, never credential values", () => {
    const fields = document.components.schemas.RelayChannelDto.properties;
    for (const provider of ["Openai", "Anthropic", "Gemini"]) {
      expect(fields["has" + provider + "UpstreamApiKey"]).toMatchObject({ type: "boolean" });
      expect(fields).not.toHaveProperty(provider[0].toLowerCase() + provider.slice(1) + "UpstreamApiKey");
    }
  });
});

describe("generated native channel health read contracts", () => {
  it.each([
    "/v1/relay-channels/health/overview",
    "/v1/relay-channels/{id}/health",
    "/v1/relay-channels/health/automatic-pools",
  ])("retains unscoped JWT and safe errors for %s", (path) => {
    const operation = document.paths[path].get;
    expect(operation.security).toContainEqual({ jwt: [] });
    expect(operation.responses).toHaveProperty("401");
    expect(operation.responses).toHaveProperty("403");
  });
  it("retains scalar health and automatic member projections without configuration secrets", () => {
    for (const name of ["RelayChannelHealthDto", "RelayAutomaticPoolHealthMemberDto"]) {
      const schema = document.components.schemas[name];
      expect(schema.required).toEqual(expect.arrayContaining(["channelId", "source", "availability", "trackingMode"]));
      expect(JSON.stringify(schema.properties)).not.toMatch(/Upstream|password|providers/);
    }
    expect(document.components.schemas.RelayAutomaticPoolHealthDto.required).toContain("members");
  });
});

describe("generated native channel health configuration writes", () => {
  it.each(["/v1/relay-channels/{id}/health-config", "/v1/relay-channels/health/batch-config"])(
    "retains unscoped JWT and safe errors for %s",
    (path) => {
      const operation = document.paths[path].patch;
      expect(operation.security).toContainEqual({ jwt: [] });
      expect(operation.responses).toHaveProperty("401");
      expect(operation.responses).toHaveProperty("403");
      expect(operation.requestBody.required).toBe(true);
    },
  );
});

describe("generated native channel health clear contracts", () => {
  it.each([
    { path: "/v1/relay-channels/{id}/health", verb: "delete" },
    { path: "/v1/relay-channels/health/batch-clear", verb: "post" },
  ])("retains unscoped JWT and safe errors for $verb $path", ({ path, verb }) => {
    const operation = document.paths[path][verb];
    expect(operation.security).toContainEqual({ jwt: [] });
    expect(operation.responses).toHaveProperty("401");
    expect(operation.responses).toHaveProperty("403");
    if (verb === "post") expect(operation.requestBody.required).toBe(true);
  });
});

describe("generated resource-scoped own channel submission listing", () => {
  it("retains pagination, channel DTOs, unscoped JWT and safe errors", () => {
    const operation = document.paths["/v1/relay-channels/submissions/mine"].get;
    expect(operation.security).toContainEqual({ jwt: [] });
    expect(operation.responses).toHaveProperty("401");
    expect(operation.responses).toHaveProperty("403");
    expect(operation.parameters.map((value: { name: string }) => value.name)).toEqual(
      expect.arrayContaining(["page", "pageSize"]),
    );
  });
});

describe("generated own submission lifecycle contracts", () => {
  it.each([
    ["/v1/relay-channels/submissions/{id}", "delete"],
    ["/v1/relay-channels/submissions/{id}/service-status", "patch"],
  ])("retains JWT and safe errors for %s", (path, verb) => {
    const operation = document.paths[path][verb];
    expect(operation.security).toContainEqual({ jwt: [] });
    expect(operation.responses).toHaveProperty("401");
    expect(operation.responses).toHaveProperty("403");
  });
});

describe("generated native channel submission creation contract", () => {
  it("retains the submission DTO, unscoped JWT and safe errors", () => {
    const operation = document.paths["/v1/relay-channels/submissions"].post;
    expect(operation.security).toContainEqual({ jwt: [] });
    expect(operation.requestBody.required).toBe(true);
    expect(operation.responses).toHaveProperty("401");
    expect(operation.responses).toHaveProperty("403");
    const body = document.components.schemas.SubmitRelayChannelRequest;
    expect(body.required).toContain("name");
    for (const field of ["id", "accountOwnerId", "submittedByUserId", "submissionStatus", "status"])
      expect(body.properties).not.toHaveProperty(field);
  });
});

describe("generated native platform channel deletion contracts", () => {
  it.each([
    { path: "/v1/relay-channels/{id}", verb: "delete" },
    { path: "/v1/relay-channels/batch/delete", verb: "post" },
  ])("retains unscoped JWT, stepup metadata and safe errors for $verb $path", ({ path, verb }) => {
    const operation = document.paths[path][verb];
    expect(operation.security).toContainEqual({ jwt: [] });
    expect(operation.responses).toHaveProperty("401");
    expect(operation.responses).toHaveProperty("403");
    if (verb === "post") expect(operation.requestBody.required).toBe(true);
  });
});

describe("generated native channel submission review contract", () => {
  it("retains unscoped JWT, body, safe failures and credential-presence-only configuration", () => {
    const operation = document.paths["/v1/relay-channels/{id}/review-submission"].post;
    expect(operation.security).toContainEqual({ jwt: [] });
    expect(operation.requestBody.required).toBe(true);
    for (const status of ["401", "403"]) expect(operation.responses).toHaveProperty(status);
    for (const field of ["openaiUpstreamApiKey", "anthropicUpstreamApiKey", "geminiUpstreamApiKey"])
      expect(document.components.schemas.RelayChannelDto.properties).not.toHaveProperty(field);
  });
});
