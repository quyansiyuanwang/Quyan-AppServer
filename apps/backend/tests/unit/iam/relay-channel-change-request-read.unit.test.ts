import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { projectRelayChannelChangeRequest } from "@/services/relay/relay-channel-change-request-projection";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
const personal = "acs:relay:*:owner:channel-change-request/actor/request",
  platform = "acs:platform:*:platform:relay-channel-change-request/channel/request";
describe("channel change request read contract and projection", () => {
  it("registers server-owned resource collection actions for both list routes", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [key, action] of [
      ["GET /v1/relay-channels/change-requests/mine", "quyan:relay:ListMyChannelChangeRequests"],
      ["GET /v1/relay-channels/change-requests", "quyan:relay:ListChannelChangeRequests"],
    ]) {
      expect(routes.find((row) => row.key === key)).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
      expect(getIamActionDefinition(action!)!.apiRoutes).toContain(key);
    }
  });
  it("keeps personal ownership separate from the deployment review boundary", () => {
    expect(isIamActionResourceCompatible("quyan:relay:ListMyChannelChangeRequests", personal)).toBe(true);
    expect(isIamActionResourceCompatible("quyan:relay:ListMyChannelChangeRequests", platform)).toBe(false);
    expect(isIamActionResourceCompatible("quyan:relay:ListChannelChangeRequests", platform)).toBe(true);
    expect(isIamActionResourceCompatible("quyan:relay:ListChannelChangeRequests", personal)).toBe(false);
    expect(getIamActionDefinition("quyan:relay:ListChannelChangeRequests")!.authorizationBoundary).toBe("platform");
  });
  it("maps legacy SUBMIT only to the actor personal resources", () => {
    const document = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_SUBMIT], "owner", "actor")!;
    const decide = (resource: string) =>
      evaluatePolicies([{ policyId: "fixture", document }], {
        action: "quyan:relay:ListMyChannelChangeRequests",
        resource,
      }).decision;
    expect(decide(personal)).toBe("Allow");
    expect(decide(personal.replace("/actor/", "/peer/"))).toBe("ImplicitDeny");
    expect(decide(platform)).toBe("ImplicitDeny");
  });
  it("reads only the declared public projection and strips unknown nested fields", () => {
    const row = {
      id: "request",
      relayChannelId: "channel",
      submittedByUserId: "actor",
      reviewStatus: "pending",
      reviewedAt: null,
      reviewReason: null,
      createTime: new Date(),
      updateTime: new Date(),
      relayChannel: { name: "channel" },
      submittedBy: { username: "actor" },
      configSnapshot: {
        name: "configuration",
        openaiUpstreamApiKey: "fixture-secret",
        hasOpenaiUpstreamApiKey: true,
        previousChannelStatus: 1,
        surprise: "fixture-secret",
        providers: [
          { username: "provider", commissionPercent: 100, settlementMode: "realtime", secret: "fixture-secret" },
        ],
      },
    };
    for (const field of ["encryptedCredentials", "credentialIv", "credentialAuthTag"])
      Object.defineProperty(row, field, {
        get() {
          throw new Error("Credential was read");
        },
      });
    const result = projectRelayChannelChangeRequest(row);
    expect(result.config).toEqual({
      name: "configuration",
      hasOpenaiUpstreamApiKey: true,
      hasAnthropicUpstreamApiKey: false,
      hasGeminiUpstreamApiKey: false,
      providers: [{ username: "provider", commissionPercent: 100, settlementMode: "realtime" }],
    });
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
  });
  it("rejects corrupt stored config without returning input or validation details", () => {
    const row = {
      id: "request",
      relayChannelId: "channel",
      submittedByUserId: "actor",
      reviewStatus: "pending",
      reviewedAt: null,
      reviewReason: null,
      createTime: new Date(),
      updateTime: new Date(),
      relayChannel: { name: "" },
      submittedBy: { username: "" },
      configSnapshot: { openaiUpstreamApiKey: "fixture-secret" },
    };
    try {
      projectRelayChannelChangeRequest(row);
      throw new Error("Expected failure");
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 400 });
      expect(JSON.stringify(error)).not.toContain("fixture-secret");
    }
  });
});
