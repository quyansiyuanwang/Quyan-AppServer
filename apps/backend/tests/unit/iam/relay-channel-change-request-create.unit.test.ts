import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import {
  relayChannelSubmissionArn,
  relayChannelSubmissionProviderArn,
} from "@/iam/resources/relay-channel-submission-resources";
import { relayChannelChangeRequestArn } from "@/iam/resources/relay-channel-change-request-resources";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const action = "quyan:relay:CreateMyChannelChangeRequest";
const resources = [
  relayChannelSubmissionArn("owner", "actor", "channel"),
  relayChannelChangeRequestArn("owner", "actor", "proposal"),
  relayChannelSubmissionProviderArn("owner", "actor", "channel", "recipient"),
];
describe("owned channel change proposal declarations", () => {
  it("registers an owned submission, request and recipient relation without platform management authority", () => {
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["relay/channel-submission", "relay/channel-change-request", "relay/submission-provider"],
      accessLevel: "Write",
      legacyPermission: Permission.RELAY_CHANNEL_SUBMIT,
    });
    for (const resource of resources) expect(isIamActionResourceCompatible(action, resource)).toBe(true);
    expect(isIamActionResourceCompatible(action, platformRelayChannelArn("channel"))).toBe(false);
    expect(isIamActionResourceCompatible(action, "acs:quyan:*:owner:user/recipient")).toBe(false);
  });
  it("maps old submit permission and its explicit removal across all required resource types", () => {
    const allow = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_SUBMIT], "owner", "actor")!,
      deny = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_SUBMIT], "owner", "actor", "Deny")!;
    for (const resource of resources) {
      expect(evaluatePolicies([{ policyId: "allow", document: allow }], { action, resource }).decision).toBe("Allow");
      expect(
        evaluatePolicies(
          [
            { policyId: "allow", document: allow },
            { policyId: "deny", document: deny },
          ],
          { action, resource },
        ).decision,
      ).toBe("ExplicitDeny");
    }
  });
  it("binds the server Action and submitter resolver while preserving JWT, validation, stepup and replay protection", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      source = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channels/{id}/change-requests",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], issues: [] });
    const method = source.getClassOrThrow("RelayChannelController").getMethodOrThrow("createChangeRequest").getText();
    for (const required of [
      '@Security("jwt")',
      "relayChannelSubmissionResourceResolver",
      "@TwoFactorChallengeProtected",
      "replayProtectionMiddleware",
      "validateParams(relayChannelIdParamsSchema)",
      "validateBody(createRelayChannelChangeRequestBodySchema)",
    ])
      expect(method).toContain(required);
  });
});
