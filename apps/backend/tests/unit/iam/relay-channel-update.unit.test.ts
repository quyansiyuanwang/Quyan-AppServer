import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import {
  platformRelayChannelArn,
  platformRelayChannelProviderArn,
  platformRelayChannelResourceResolver,
} from "@/iam/resources/platform-relay-channel-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { updateRelayChannelBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:UpdateChannel";
describe("administrative channel update authorization contract", () => {
  it("registers only deployment channel and provider-relation resources", () => {
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["platform/relay-channel", "platform/relay-channel-provider"],
      authorizationBoundary: "platform",
      legacyPermission: Permission.RELAY_CHANNEL_UPDATE,
      sensitive: true,
    });
    const resource = platformRelayChannelArn("channel"),
      allow = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_UPDATE], "owner", "actor")!,
      deny = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_UPDATE], "owner", "actor", "Deny")!;
    expect(isIamActionResourceCompatible(action, resource)).toBe(true);
    expect(isIamActionResourceCompatible(action, platformRelayChannelProviderArn("channel", "user"))).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:relay:*:owner:channel/channel")).toBe(false);
    expect(evaluatePolicies([{ policyId: "a", document: allow }], { action, resource }).decision).toBe("Allow");
    expect(
      evaluatePolicies(
        [
          { policyId: "a", document: allow },
          { policyId: "d", document: deny },
        ],
        { action, resource },
      ).decision,
    ).toBe("ExplicitDeny");
  });
  it("takes only the validated path identifier, not caller Action/account hints", async () => {
    const invoke = (id: string) =>
      platformRelayChannelResourceResolver({
        request: {
          params: { id },
          body: { accountId: "forged" },
          headers: { "x-action": "fake:*" },
        } as unknown as TypedRequest,
        principal: {
          subjectUserId: "actor",
          principalUserId: "actor",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
      });
    expect(await invoke("channel")).toBe(platformRelayChannelArn("channel"));
    for (const id of ["*", "../channel", "channel/child", " channel", ""]) expect(await invoke(id)).toBeUndefined();
  });
  it("rejects unknown top-level fields instead of accepting forged mutation scope", () => {
    expect(updateRelayChannelBodySchema.safeParse({ multiplier: 2 }).success).toBe(true);
    for (const key of [
      "accountOwnerId",
      "action",
      "status",
      "submittedByUserId",
      "reviewReason",
      "providerServiceEnabled",
      "permissionAdds",
    ])
      expect(updateRelayChannelBodySchema.safeParse({ multiplier: 2, [key]: "forged" }).success).toBe(false);
  });
  it("retains the fixed server Action, resolver, replay and stepup protection", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      source = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "PUT /v1/relay-channels/{id}",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], resourceKind: "single-resource", issues: [] });
    const method = source.getClassOrThrow("RelayChannelController").getMethodOrThrow("updateChannel").getText();
    for (const required of [
      '@Security("jwt")',
      "platformRelayChannelResourceResolver",
      "@TwoFactorChallengeProtected",
      "replayProtectionMiddleware",
      "validateBody(updateRelayChannelBodySchema)",
    ])
      expect(method).toContain(required);
  });
});
