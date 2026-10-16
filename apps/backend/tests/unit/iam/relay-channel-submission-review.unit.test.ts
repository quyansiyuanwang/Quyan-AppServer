import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import {
  platformRelayChannelArn,
  platformRelayChannelProviderArn,
} from "@/iam/resources/platform-relay-channel-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
const action = "quyan:relay:ReviewChannelSubmission";
describe("platform channel submission review declarations", () => {
  it("registers platform channel plus individual recipient relation resources, not account-owned channel aliases", () => {
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["platform/relay-channel", "platform/relay-channel-provider"],
      accessLevel: "Write",
      authorizationBoundary: "platform",
      legacyPermission: Permission.RELAY_CHANNEL_REVIEW,
    });
    expect(platformRelayChannelProviderArn("channel", "recipient")).toBe(
      "acs:platform:*:platform:relay-channel-provider/channel/recipient",
    );
    for (const resource of [
      platformRelayChannelArn("channel"),
      platformRelayChannelProviderArn("channel", "recipient"),
    ])
      expect(isIamActionResourceCompatible(action, resource)).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:relay:*:owner:channel/channel")).toBe(false);
  });
  it("retains migrated review grants and explicit legacy removal priority on both kinds", () => {
    const allow = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_REVIEW], "owner", "actor")!,
      deny = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_REVIEW], "owner", "actor", "Deny")!;
    for (const resource of [
      platformRelayChannelArn("channel"),
      platformRelayChannelProviderArn("channel", "recipient"),
    ]) {
      expect(evaluatePolicies([{ policyId: "legacy", document: allow }], { action, resource }).decision).toBe("Allow");
      expect(
        evaluatePolicies(
          [
            { policyId: "legacy", document: allow },
            { policyId: "removed", document: deny },
          ],
          { action, resource },
        ).decision,
      ).toBe("ExplicitDeny");
    }
  });
  it("keeps server Action and replay/stepup/body validation on its JWT route", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      source = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channels/{id}/review-submission",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], issues: [] });
    const method = source
      .getClassOrThrow("RelayChannelController")
      .getMethodOrThrow("reviewChannelSubmission")
      .getText();
    for (const required of [
      '@Security("jwt")',
      "platformRelayChannelResourceResolver",
      "@TwoFactorChallengeProtected",
      "replayProtectionMiddleware",
      "validateParams",
      "validateBody(reviewRelayChannelSubmissionBodySchema)",
    ])
      expect(method).toContain(required);
  });
  it.each([
    ["invalid/id", "recipient"],
    ["channel", "*"],
    ["channel", ""],
  ])("rejects invalid relation identifiers %#", (channel, recipient) => {
    expect(() => platformRelayChannelProviderArn(channel, recipient)).toThrow();
  });
});
