import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { legacyPermissionsToPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
const metadata = "quyan:relay:ReadChannelPoolHealthMetadata",
  resource = "acs:platform:*:platform:relay-channel/channel";
const cases = [
  ["ListChannelHealth", "GET /v1/relay-channels/health/overview"],
  ["GetChannelHealth", "GET /v1/relay-channels/{id}/health"],
  ["ListAutomaticPoolHealth", "GET /v1/relay-channels/health/automatic-pools"],
] as const;
describe("channel health resource authorization declarations", () => {
  it.each(cases)("registers %s with platform-only channel resources", (operation) => {
    const action = "quyan:relay:" + operation,
      definition = getIamActionDefinition(action)!;
    expect(definition).toMatchObject({
      authorizationBoundary: "platform",
      resourceTypes: ["platform/relay-channel"],
      legacyPermission: Permission.RELAY_CHANNEL_HEALTH_READ,
    });
    expect(definition.requiredActions ?? []).toEqual(operation === "ListChannelHealth" ? [] : [metadata]);
    expect(isIamActionResourceCompatible(action, resource)).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:relay:*:owner:channel/channel")).toBe(false);
    expect(isIamActionResourceCompatible(action, "acs:quyan:*:owner:user/user")).toBe(false);
  });
  it("declares server actions and registered metadata dependencies without client inputs", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    const rows = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [operation, key] of cases)
      expect(rows.find((row) => row.key === key)).toMatchObject({
        coverage: "explicit",
        actions: ["quyan:relay:" + operation],
        issues: [],
      });
    expect(getIamActionDefinition(metadata)).toMatchObject({
      legacyPermission: Permission.RELAY_CHANNEL_POOL_METADATA_READ,
      resourceTypes: ["platform/relay-channel"],
      authorizationBoundary: "platform",
    });
  });
  it("does not project pool metadata authority from legacy HEALTH alone or health from metadata alone", () => {
    const health = legacyPermissionsToPolicy([Permission.RELAY_CHANNEL_HEALTH_READ], "owner")!,
      pool = legacyPermissionsToPolicy([Permission.RELAY_CHANNEL_POOL_METADATA_READ], "owner")!;
    for (const [operation] of cases) {
      expect(
        evaluatePolicies([{ policyId: "health", document: health }], { action: "quyan:relay:" + operation, resource })
          .decision,
      ).toBe("Allow");
      expect(
        evaluatePolicies([{ policyId: "pool", document: pool }], { action: "quyan:relay:" + operation, resource })
          .decision,
      ).toBe("ImplicitDeny");
    }
    expect(evaluatePolicies([{ policyId: "health", document: health }], { action: metadata, resource }).decision).toBe(
      "ImplicitDeny",
    );
    expect(evaluatePolicies([{ policyId: "pool", document: pool }], { action: metadata, resource }).decision).toBe(
      "Allow",
    );
  });
});

describe("resource-scoped health configuration write declarations", () => {
  it("registers a distinct sensitive write Action and both server routes", () => {
    const action = "quyan:relay:UpdateChannelHealthConfig";
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["platform/relay-channel"],
      legacyPermission: Permission.RELAY_CHANNEL_UPDATE,
      authorizationBoundary: "platform",
      accessLevel: "Write",
      sensitive: true,
    });
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    const rows = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const key of ["PATCH /v1/relay-channels/{id}/health-config", "PATCH /v1/relay-channels/health/batch-config"])
      expect(rows.find((row) => row.key === key)).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
    expect(isIamActionResourceCompatible(action, resource)).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:relay:*:owner:channel/channel")).toBe(false);
  });
});
