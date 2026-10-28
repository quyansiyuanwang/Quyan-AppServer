import { describe, expect, it, vi } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import {
  platformRelayChannelArn,
  platformRelayChannelDuplicateResources as resolver,
} from "@/iam/resources/platform-relay-channel-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
import { actionRouteCatalog } from "../../../scripts/iam/action-route-catalog";
import { IamCatalogService } from "@/iam/iam-catalog.service";
import { getIamPolicyJsonSchema } from "@/iam/diagnostics/policy-json-schema";
vi.mock("@/build/iam-action-routes", () => ({
  IAM_ACTION_ROUTES: {
    "quyan:relay:DuplicateChannels": [
      "POST /v1/relay-channels/{id}/duplicate",
      "POST /v1/relay-channels/batch/duplicate",
    ],
    "quyan:relay:CreateChannelCopy": [
      "POST /v1/relay-channels/{id}/duplicate",
      "POST /v1/relay-channels/batch/duplicate",
    ],
  },
}));
const action = "quyan:relay:DuplicateChannels";
describe("single and batch duplication authorization contract", () => {
  it("has one platform Action and legacy removal remains an explicit Deny", () => {
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["platform/relay-channel"],
      legacyPermission: Permission.RELAY_CHANNEL_CREATE,
    });
    const resource = platformRelayChannelArn("channel"),
      allow = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_CREATE], "owner", "actor")!,
      deny = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_CREATE], "owner", "actor", "Deny")!;
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
  it("registers a distinct copy-destination capability, not general source or configuration authority", () => {
    const destinationAction = "quyan:relay:CreateChannelCopy";
    expect(getIamActionDefinition(destinationAction)).toMatchObject({
      resourceTypes: ["platform/relay-channel"],
      legacyPermission: Permission.RELAY_CHANNEL_CREATE,
      sensitive: true,
    });
    const source = platformRelayChannelArn("source"),
      destination = platformRelayChannelArn("destination");
    const document = {
      Version: "1" as const,
      Statement: [
        { Effect: "Allow" as const, Action: [action], Resource: [source] },
        {
          Effect: "Allow" as const,
          Action: [destinationAction],
          Resource: ["acs:platform:*:platform:relay-channel/*"],
        },
      ],
    };
    expect(evaluatePolicies([{ policyId: "copy", document }], { action, resource: source }).decision).toBe("Allow");
    expect(evaluatePolicies([{ policyId: "copy", document }], { action, resource: destination }).decision).toBe(
      "ImplicitDeny",
    );
    expect(
      evaluatePolicies([{ policyId: "copy", document }], { action: destinationAction, resource: destination }).decision,
    ).toBe("Allow");
  });
  it("discovers cross-resource source/destination checks without treating them as same-resource grants", () => {
    const dependency = {
      action: "quyan:relay:CreateChannelCopy",
      resourceTypes: ["platform/relay-channel"],
      resourceRole: "destination",
      selection: "server-reserved",
    };
    const definition = getIamActionDefinition(action)!;
    expect(definition.resourceDependencies).toEqual([dependency]);
    expect(definition.requiredActions).toBeUndefined();
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    const routes = actionRouteCatalog(collectIamRoutes(project.getSourceFiles(), process.cwd()));
    expect(routes[dependency.action]).toEqual(routes[action]);
    expect(routes[action]).toHaveLength(2); // Reciprocal metadata must terminate and deduplicate.
    const service = IamCatalogService.getInstance();
    const apiAction = service.listActions("relay").find((entry) => entry.action === action)!;
    expect(apiAction.resourceDependencies).toEqual([dependency]);
    apiAction.resourceDependencies![0]!.resourceTypes.length = 0;
    apiAction.resourceDependencies![0]!.action = "forged";
    expect(service.listActions("relay").find((entry) => entry.action === action)!.resourceDependencies).toEqual([
      dependency,
    ]);
    const schema = getIamPolicyJsonSchema();
    const schemaAction = (schema["x-quyan-actions"] as (typeof apiAction)[]).find((entry) => entry.action === action)!;
    expect(schemaAction.resourceDependencies).toEqual([dependency]);
    schemaAction.resourceDependencies![0]!.resourceTypes.length = 0;
    expect(definition.resourceDependencies).toEqual([dependency]);
  });
  it("resolves every source in caller order and rejects duplicate, wildcard, empty and forged account inputs", async () => {
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
    expect(await invoke({ ids: ["b", "a"] })).toEqual([platformRelayChannelArn("b"), platformRelayChannelArn("a")]);
    for (const body of [{ ids: ["a", "a"] }, { ids: ["*"] }, { ids: [] }, { ids: ["a"], accountId: "forged" }])
      expect(await invoke(body)).toBeUndefined();
  });
  it("declares server Action, complete batch resolver and existing replay/stepup guards", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      source = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channels/batch/duplicate",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], resourceKind: "batch", issues: [] });
    const method = source
      .getClassOrThrow("RelayChannelController")
      .getMethodOrThrow("batchDuplicateChannels")
      .getText();
    for (const required of [
      '@Security("jwt")',
      "platformRelayChannelDuplicateResources",
      "@TwoFactorChallengeProtected",
      "replayProtectionMiddleware",
      "validateBody(batchDuplicateRelayChannelsBodySchema)",
    ])
      expect(method).toContain(required);
  });
  it("single copying also uses a platform source and retains security guards", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      source = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channels/{id}/duplicate",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], resourceKind: "single-resource", issues: [] });
    const method = source.getClassOrThrow("RelayChannelController").getMethodOrThrow("duplicateChannel").getText();
    for (const required of [
      "platformRelayChannelResourceResolver",
      "@TwoFactorChallengeProtected",
      "replayProtectionMiddleware",
      "validateBody(duplicateRelayChannelBodySchema)",
    ])
      expect(method).toContain(required);
  });
});
