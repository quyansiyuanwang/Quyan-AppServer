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
const action = "quyan:relay:UpdateChannelProviderConfig";
describe("platform channel provider configuration declarations", () => {
  it("registers platform channel plus individual recipient relation resources, not account-owned channel aliases", () => {
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["platform/relay-channel", "platform/relay-channel-provider"],
      accessLevel: "Write",
      authorizationBoundary: "platform",
      legacyPermissions: [Permission.RELAY_CHANNEL_REVIEW, Permission.RELAY_CHANNEL_UPDATE],
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
  it.each([Permission.RELAY_CHANNEL_REVIEW, Permission.RELAY_CHANNEL_UPDATE])(
    "retains migrated %s grants and removal priority on both resource kinds",
    (permission) => {
      const allow = legacyPermissionsToPrincipalPolicy([permission], "owner", "actor")!,
        deny = legacyPermissionsToPrincipalPolicy([permission], "owner", "actor", "Deny")!;
      for (const resource of [
        platformRelayChannelArn("channel"),
        platformRelayChannelProviderArn("channel", "recipient"),
      ]) {
        expect(evaluatePolicies([{ policyId: "legacy", document: allow }], { action, resource }).decision).toBe(
          "Allow",
        );
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
    },
  );
  it("keeps server Action and replay/stepup/body validation on its JWT route", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      source = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "PUT /v1/relay-channels/{id}/provider-config",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], issues: [] });
    const method = source.getClassOrThrow("RelayChannelController").getMethodOrThrow("updateProviderConfig").getText();
    expect(method.match(/action: "quyan:relay:UpdateChannelProviderConfig"/g)).toHaveLength(2);
    for (const required of [
      '@Security("jwt")',
      "platformRelayChannelResourceResolver",
      "PermissionCheckMode.ANY",
      "@TwoFactorChallengeProtected",
      "replayProtectionMiddleware",
      "validateParams",
      "validateBody(updateRelayChannelProviderConfigBodySchema)",
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
