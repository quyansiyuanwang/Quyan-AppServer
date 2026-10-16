import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { relayChannelSubmissionArn } from "@/iam/resources/relay-channel-submission-resources";
import { legacyPermissionsToPrincipalPolicy, legacyPermissionsToPolicy } from "@/iam/legacy-policy";
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

describe("resource-scoped health clear declarations", () => {
  it("registers distinct clear authority, platform channel resources and both protected routes", () => {
    const action = "quyan:relay:ClearChannelHealth";
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["platform/relay-channel"],
      legacyPermission: Permission.RELAY_CHANNEL_UPDATE,
      authorizationBoundary: "platform",
      accessLevel: "Write",
      sensitive: true,
    });
    expect(isIamActionResourceCompatible(action, resource)).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:relay:*:owner:channel/channel")).toBe(false);
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const source = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    const rows = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const key of ["DELETE /v1/relay-channels/{id}/health", "POST /v1/relay-channels/health/batch-clear"])
      expect(rows.find((row) => row.key === key)).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
    for (const name of ["clearChannelHealth", "batchClearChannelHealth"]) {
      const method = source.getClassOrThrow("RelayChannelController").getMethodOrThrow(name).getText();
      expect(method).toContain('@Security("jwt")');
      expect(method).toContain("@TwoFactorChallengeProtected");
      expect(method).toContain("replayProtectionMiddleware");
      expect(method).toMatch(/validate(Params|Body)/);
    }
  });
});

describe("own channel submission authorization", () => {
  it("registers an account-owned submitter-parented read, not platform channel management", () => {
    const action = "quyan:relay:ListMyChannelSubmissions",
      own = relayChannelSubmissionArn("owner", "actor", "channel");
    expect(own).toBe("acs:relay:*:owner:channel-submission/actor/channel");
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["relay/channel-submission"],
      legacyPermission: Permission.RELAY_CHANNEL_SUBMIT,
      accessLevel: "List",
    });
    expect(getIamActionDefinition(action)?.authorizationBoundary).toBeUndefined();
    expect(isIamActionResourceCompatible(action, own)).toBe(true);
    expect(isIamActionResourceCompatible(action, resource)).toBe(false);
    const document = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_SUBMIT], "owner", "actor")!;
    expect(evaluatePolicies([{ policyId: "legacy", document }], { action, resource: own }).decision).toBe("Allow");
    expect(
      evaluatePolicies([{ policyId: "legacy", document }], {
        action,
        resource: relayChannelSubmissionArn("owner", "other", "channel"),
      }).decision,
    ).toBe("ImplicitDeny");
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "GET /v1/relay-channels/submissions/mine",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], issues: [] });
  });
});

describe("own submission lifecycle declarations", () => {
  it.each([
    ["DeleteMyChannelSubmission", "DELETE /v1/relay-channels/submissions/{id}", "deleteSubmittedChannel"],
    [
      "SetMyChannelSubmissionServiceStatus",
      "PATCH /v1/relay-channels/submissions/{id}/service-status",
      "updateSubmittedChannelServiceStatus",
    ],
  ])("declares %s on a submitter-owned resource and keeps stepup/replay", (operation, route, method) => {
    const action = "quyan:relay:" + operation,
      own = relayChannelSubmissionArn("owner", "actor", "channel");
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["relay/channel-submission"],
      accessLevel: "Write",
      sensitive: true,
    });
    expect(isIamActionResourceCompatible(action, own)).toBe(true);
    expect(isIamActionResourceCompatible(action, resource)).toBe(false);
    const document = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_SUBMIT], "owner", "actor")!;
    expect(evaluatePolicies([{ policyId: "legacy", document }], { action, resource: own }).decision).toBe("Allow");
    expect(
      evaluatePolicies([{ policyId: "legacy", document }], {
        action,
        resource: relayChannelSubmissionArn("owner", "other", "channel"),
      }).decision,
    ).toBe("ImplicitDeny");
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const source = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(collectIamRoutes(project.getSourceFiles(), process.cwd()).find((row) => row.key === route)).toMatchObject({
      coverage: "explicit",
      actions: [action],
      issues: [],
    });
    const text = source.getClassOrThrow("RelayChannelController").getMethodOrThrow(method).getText();
    expect(text).toContain("@TwoFactorChallengeProtected");
    expect(text).toContain("replayProtectionMiddleware");
    expect(text).toContain("relayChannelSubmissionResourceResolver");
  });
});
