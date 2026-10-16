import { describe, expect, it, vi } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import {
  platformRelayChannelArn,
  platformRelayChannelProviderArn,
} from "@/iam/resources/platform-relay-channel-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { createRelayChannelBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { actionRouteCatalog } from "../../../scripts/iam/action-route-catalog";
import { IamCatalogService } from "@/iam/iam-catalog.service";
import { getIamPolicyJsonSchema } from "@/iam/diagnostics/policy-json-schema";
vi.mock("@/build/iam-action-routes", () => ({
  IAM_ACTION_ROUTES: {
    "quyan:relay:CreateChannel": ["POST /v1/relay-channels"],
    "quyan:relay:UseChannelCreationReference": ["POST /v1/relay-channels"],
  },
}));
const action = "quyan:relay:CreateChannel",
  reference = "quyan:relay:UseChannelCreationReference";
describe("native administrator creation authorization contract", () => {
  it("separates new destination creation from existing-reference reads", () => {
    const definition = getIamActionDefinition(action)!;
    expect(definition).toMatchObject({
      sensitive: true,
      authorizationBoundary: "platform",
      legacyPermission: Permission.RELAY_CHANNEL_CREATE,
      resourceTypes: ["platform/relay-channel", "platform/relay-channel-provider"],
    });
    const resource = platformRelayChannelArn("existing"),
      policy = {
        Version: "1" as const,
        Statement: [
          { Effect: "Allow" as const, Action: [action], Resource: ["acs:platform:*:platform:relay-channel/*"] },
        ],
      };
    expect(evaluatePolicies([{ policyId: "create", document: policy }], { action, resource }).decision).toBe("Allow");
    expect(evaluatePolicies([{ policyId: "create", document: policy }], { action: reference, resource }).decision).toBe(
      "ImplicitDeny",
    );
    expect(isIamActionResourceCompatible(action, platformRelayChannelProviderArn("new", "recipient"))).toBe(true);
    expect(isIamActionResourceCompatible(reference, platformRelayChannelProviderArn("new", "recipient"))).toBe(false);
    expect(isIamActionResourceCompatible(action, "acs:relay:*:owner:channel/new")).toBe(false);
  });
  it("keeps legacy Allow/Deny mapping without granting other management Actions", () => {
    const allow = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_CREATE], "owner", "actor")!,
      deny = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_CREATE], "owner", "actor", "Deny")!,
      resource = platformRelayChannelArn("new");
    for (const current of [action, reference]) {
      expect(evaluatePolicies([{ policyId: "allow", document: allow }], { action: current, resource }).decision).toBe(
        "Allow",
      );
      expect(
        evaluatePolicies(
          [
            { policyId: "allow", document: allow },
            { policyId: "deny", document: deny },
          ],
          { action: current, resource },
        ).decision,
      ).toBe("ExplicitDeny");
    }
    expect(
      evaluatePolicies([{ policyId: "allow", document: allow }], { action: "quyan:relay:UpdateChannel", resource })
        .decision,
    ).toBe("ImplicitDeny");
  });
  it("exposes reference dependency metadata through catalog and Schema without implicit grants", () => {
    const expected = [
      {
        action: reference,
        resourceTypes: ["platform/relay-channel"],
        resourceRole: "reference",
        selection: "server-resolved",
      },
    ];
    expect(getIamActionDefinition(action)!.resourceDependencies).toEqual(expected);
    expect(
      IamCatalogService.getInstance()
        .listActions("relay")
        .find((row) => row.action === action)!.resourceDependencies,
    ).toEqual(expected);
    const actions = getIamPolicyJsonSchema()["x-quyan-actions"] as { action: string; resourceDependencies?: unknown }[];
    expect(actions.find((row) => row.action === action)!.resourceDependencies).toEqual(expected);
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    const routes = actionRouteCatalog(collectIamRoutes(project.getSourceFiles(), process.cwd()));
    expect(routes[reference]).toContain("POST /v1/relay-channels");
  });
  it("strictly rejects forged identity/status/Action hints", () => {
    expect(createRelayChannelBodySchema.safeParse({ name: "valid" }).success).toBe(true);
    for (const key of [
      "id",
      "action",
      "accountOwnerId",
      "status",
      "submittedByUserId",
      "reviewReason",
      "providerServiceEnabled",
    ])
      expect(createRelayChannelBodySchema.safeParse({ name: "valid", [key]: "forged" }).success).toBe(false);
  });
  it("uses collection admission with final server-reserved resource checks and retains stepup/replay protection", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      source = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find((row) => row.key === "POST /v1/relay-channels"),
    ).toMatchObject({ coverage: "explicit", actions: [action], resourceKind: "collection", issues: [] });
    const method = source.getClassOrThrow("RelayChannelController").getMethodOrThrow("createChannel").getText();
    for (const required of [
      '@Security("jwt")',
      "iamCollectionAuthorizationMiddleware",
      "ramAccountResourceResolver",
      "@TwoFactorChallengeProtected",
      "replayProtectionMiddleware",
      "validateBody(createRelayChannelBodySchema)",
    ])
      expect(method).toContain(required);
  });
});
