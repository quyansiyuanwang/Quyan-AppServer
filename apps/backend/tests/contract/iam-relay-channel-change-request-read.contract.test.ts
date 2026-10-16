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
