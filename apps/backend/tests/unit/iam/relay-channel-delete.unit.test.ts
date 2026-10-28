import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import {
  platformRelayChannelArn,
  platformRelayChannelResourceResolver,
} from "@/iam/resources/platform-relay-channel-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:DeleteChannel";
describe("platform channel deletion declarations", () => {
  it("uses real platform resources rather than pretending a shared channel belongs to the caller", () => {
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["platform/relay-channel"],
      accessLevel: "Write",
      authorizationBoundary: "platform",
      legacyPermission: Permission.RELAY_CHANNEL_DELETE,
    });
    expect(isIamActionResourceCompatible(action, platformRelayChannelArn("channel"))).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:relay:*:owner:channel/channel")).toBe(false);
    const document = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_DELETE], "owner", "actor")!;
    expect(
      evaluatePolicies([{ policyId: "legacy", document }], { action, resource: platformRelayChannelArn("channel") })
        .decision,
    ).toBe("Allow");
    const deny = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_DELETE], "owner", "actor", "Deny")!;
    expect(
      evaluatePolicies(
        [
          { policyId: "legacy", document },
          { policyId: "removed", document: deny },
        ],
        { action, resource: platformRelayChannelArn("channel") },
      ).decision,
    ).toBe("ExplicitDeny");
  });
  it.each(["DELETE /v1/relay-channels/{id}", "POST /v1/relay-channels/batch/delete"])(
    "declares fixed Action and keeps stepup/replay validation for %s",
    (route) => {
      const project = new Project({ skipAddingFilesFromTsConfig: true }),
        source = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
      expect(collectIamRoutes(project.getSourceFiles(), process.cwd()).find((row) => row.key === route)).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
      const method = source
        .getClassOrThrow("RelayChannelController")
        .getMethodOrThrow(route.startsWith("DELETE") ? "deleteChannel" : "batchDeleteChannels")
        .getText();
      expect(method).toContain('@Security("jwt")');
      expect(method).toContain("@TwoFactorChallengeProtected");
      expect(method).toContain("replayProtectionMiddleware");
      expect(method).toMatch(/validate(Body|Params)/);
    },
  );
  it("builds an ARN only from the path ID, without trusting client action/account headers", async () => {
    expect(
      await platformRelayChannelResourceResolver({
        request: {
          params: { id: "channel" },
          headers: { "x-action": "fake:*", "x-account-id": "foreign" },
          body: { accountOwnerId: "foreign" },
        } as unknown as TypedRequest,
        principal: {
          subjectUserId: "actor",
          principalUserId: "actor",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
      }),
    ).toBe("acs:platform:*:platform:relay-channel/channel");
  });
  it.each(["", "a/b", "*", "a\nb", "a".repeat(192)])("rejects unsafe resource ID %#", async (id) => {
    expect(() => platformRelayChannelArn(id)).toThrow();
    expect(
      await platformRelayChannelResourceResolver({
        request: { params: { id } } as unknown as TypedRequest,
        principal: {
          subjectUserId: "actor",
          principalUserId: "actor",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
      }),
    ).toBeUndefined();
  });
});
