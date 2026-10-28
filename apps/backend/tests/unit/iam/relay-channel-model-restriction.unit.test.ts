import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { planRelayChannelModelRestriction as plan } from "@/services/relay/relay-channel-model-restriction";
import {
  platformRelayChannelArn,
  platformRelayChannelModelRestrictionResources as resolver,
} from "@/iam/resources/platform-relay-channel-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:ApplyChannelModelRestrictions",
  catalog = [
    { model: "a", provider: "upstream-a" },
    { model: "alias-a", provider: "upstream-a" },
    { model: "b", provider: "upstream-b" },
  ],
  source = { channelType: "standalone", allowedModels: '["a","historical"]', routingConfig: null };
describe("channel model restriction plans and authorization declarations", () => {
  it("merges manual model names and retains historical names", () => {
    expect(plan(source, ["b"], catalog)).toEqual({ patch: { allowedModels: '["a","historical","b"]' } });
  });
  it.each(["pooled", "automatic-proxy-pool"])(
    "switches %s auto mode to manual without carrying auto names or changing routing fields",
    (channelType) => {
      expect(
        plan({ ...source, channelType, routingConfig: { allowedModelsMode: "auto", custom: 42 } }, ["b"], catalog),
      ).toEqual({ patch: { allowedModels: '["b"]', routingConfig: { allowedModelsMode: "manual", custom: 42 } } });
    },
  );
  it.each(["standalone", "pooled-member"])("does not rewrite routing of %s", (channelType) => {
    expect(plan({ ...source, channelType, routingConfig: { custom: 42 } }, ["b"], catalog)).toEqual({
      patch: { allowedModels: '["a","historical","b"]' },
    });
  });
  it("does not preserve stale names from all mode", () => {
    expect(plan({ ...source, routingConfig: { allowedModelsMode: "all" } }, ["b"], catalog)).toEqual({
      patch: { allowedModels: '["b"]' },
    });
  });
  it("deduplicates model names but rejects distinct names sharing a request identity", () => {
    expect(plan(source, ["a"], catalog)).toHaveProperty("patch");
    expect(plan(source, ["alias-a"], catalog)).toEqual({ reason: "Duplicate request model identity" });
  });
  it("rejects unknown proposed models without echoing them", () => {
    expect(plan(source, ["sensitive-user-input"], catalog)).toEqual({ reason: "Unknown global pricing model" });
  });
  it.each(["{", "{}", "[1]", '[" "]'])("fails safely for stored restriction %s", (allowedModels) => {
    expect(plan({ ...source, allowedModels }, ["b"], catalog)).toEqual({ reason: "Invalid stored model restriction" });
  });
  it("rejects malformed pool routing rather than replacing unrelated configuration", () => {
    expect(plan({ ...source, channelType: "pooled", routingConfig: "bad" }, ["b"], catalog)).toEqual({
      reason: "Invalid stored pool routing configuration",
    });
  });
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
  it("resolves every validated target in original order and rejects duplicates and wildcard identifiers", async () => {
    const invoke = (targets: unknown) =>
      resolver({
        request: { body: { targets } } as unknown as TypedRequest,
        principal: {
          subjectUserId: "actor",
          principalUserId: "actor",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
      });
    expect(
      await invoke([
        { channelId: "b", addModels: ["a"] },
        { channelId: "a", addModels: ["a"] },
      ]),
    ).toEqual([platformRelayChannelArn("b"), platformRelayChannelArn("a")]);
    expect(
      await invoke([
        { channelId: "a", addModels: ["a"] },
        { channelId: "a", addModels: ["a"] },
      ]),
    ).toBeUndefined();
    expect(await invoke([{ channelId: "*", addModels: ["a"] }])).toBeUndefined();
  });
  it("declares server Action, complete batch resolver and existing replay/stepup guards", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      source = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channels/batch/model-restrictions",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], resourceKind: "batch", issues: [] });
    const method = source
      .getClassOrThrow("RelayChannelController")
      .getMethodOrThrow("applyModelRestrictions")
      .getText();
    for (const required of [
      '@Security("jwt")',
      "platformRelayChannelModelRestrictionResources",
      "@TwoFactorChallengeProtected",
      "replayProtectionMiddleware",
      "validateBody(applyRelayChannelModelRestrictionsBodySchema)",
    ])
      expect(method).toContain(required);
  });
});
