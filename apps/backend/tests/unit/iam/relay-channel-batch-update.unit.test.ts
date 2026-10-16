import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import {
  platformRelayChannelArn,
  platformRelayChannelBatchUpdateResources as resolver,
} from "@/iam/resources/platform-relay-channel-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:BatchUpdateChannels";
describe("general channel batch authorization contract", () => {
  it("has one platform Action and legacy removal remains an explicit Deny", () => {
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["platform/relay-channel"],
      legacyPermission: Permission.RELAY_CHANNEL_UPDATE,
    });
    const resource = platformRelayChannelArn("channel"),
      allow = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_UPDATE], "owner", "actor")!,
      deny = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_UPDATE], "owner", "actor", "Deny")!;
    expect(isIamActionResourceCompatible(action, resource)).toBe(true);
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
  it("resolves the entire validated batch in caller order without trusting action/account inputs", async () => {
    const invoke = (body: unknown) =>
      resolver({
        request: { body, headers: { "x-action": "fake:*" } } as unknown as TypedRequest,
        principal: {
          subjectUserId: "actor",
          principalUserId: "actor",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
      });
    expect(await invoke({ ids: ["b", "a"], patch: { multiplier: 2 } })).toEqual([
      platformRelayChannelArn("b"),
      platformRelayChannelArn("a"),
    ]);
    for (const body of [
      { ids: ["a", "a"], patch: { multiplier: 2 } },
      { ids: ["*"], patch: { multiplier: 2 } },
      { ids: ["a"], patch: {} },
      { ids: ["a"], patch: { openaiUpstreamApiKey: "fixture-only" } },
      { ids: ["a"], patch: { multiplier: 2 }, accountId: "forged" },
    ])
      expect(await invoke(body)).toBeUndefined();
  });
  it("declares server Action, complete batch resolver and existing replay/stepup guards", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      source = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "PATCH /v1/relay-channels/batch",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], resourceKind: "batch", issues: [] });
    const method = source.getClassOrThrow("RelayChannelController").getMethodOrThrow("batchUpdateChannels").getText();
    for (const required of [
      '@Security("jwt")',
      "platformRelayChannelBatchUpdateResources",
      "@TwoFactorChallengeProtected",
      "replayProtectionMiddleware",
      "validateBody(batchUpdateRelayChannelsBodySchema)",
    ])
      expect(method).toContain(required);
  });
});
