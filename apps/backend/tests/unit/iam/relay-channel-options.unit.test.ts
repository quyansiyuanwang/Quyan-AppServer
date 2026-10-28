import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { getIamActionDefinition, isIamActionResourceCompatible, iamLegacyPermissionsForAction } from "@quyan/shared";
import { relayChannelSelectionArn } from "@/iam/resources/relay-channel-selection-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const action = "quyan:relay:ListChannelOptions",
  metadata = "quyan:relay:ReadChannelOptionPoolMetadata";
const resource = relayChannelSelectionArn("owner", "channel");
describe("channel options registered authorization contract", () => {
  it("pins the server Action and distinguishes local/managed preview and optional metadata", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "GET /v1/relay-channels/options",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], resourceKind: "collection", issues: [] });
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["relay/channel-selection"],
      conditionalActions: ["quyan:relay:PreviewChannelOptions", "quyan:relay:PreviewManagedChannelOptions", metadata],
    });
    expect(getIamActionDefinition("quyan:relay:PreviewChannelOptions")!.resourceTypes).toEqual(["quyan/user"]);
    expect(getIamActionDefinition("quyan:relay:PreviewChannelOptions")!.authorizationBoundary).toBeUndefined();
    expect(getIamActionDefinition("quyan:relay:PreviewManagedChannelOptions")).toMatchObject({
      resourceTypes: ["platform/user"],
      authorizationBoundary: "platform",
    });
    expect(isIamActionResourceCompatible(action, resource)).toBe(true);
    expect(isIamActionResourceCompatible(metadata, resource)).toBe(true);
    expect(isIamActionResourceCompatible(metadata, "acs:platform:*:platform:relay-channel/channel")).toBe(false);
  });
  it.each(iamLegacyPermissionsForAction(action))("preserves %s without hiding explicit removals", (permission) => {
    const allow = legacyPermissionsToPrincipalPolicy([permission], "owner", "actor")!;
    const deny = legacyPermissionsToPrincipalPolicy([permission], "owner", "actor", "Deny")!;
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
    expect(evaluatePolicies([{ policyId: "allow", document: allow }], { action: metadata, resource }).decision).toBe(
      "ImplicitDeny",
    );
  });
  it("keeps optional pool metadata separate from basic view and platform management", () => {
    const allow = {
      Version: "1" as const,
      Statement: [{ Effect: "Allow" as const, Action: [metadata], Resource: [resource] }],
    };
    expect(evaluatePolicies([{ policyId: "allow", document: allow }], { action: metadata, resource }).decision).toBe(
      "Allow",
    );
    expect(evaluatePolicies([{ policyId: "allow", document: allow }], { action, resource }).decision).toBe(
      "ImplicitDeny",
    );
    expect(
      evaluatePolicies([{ policyId: "allow", document: allow }], {
        action: "quyan:relay:ReadChannelPoolMetadata",
        resource: "acs:platform:*:platform:relay-channel/channel",
      }).decision,
    ).toBe("ImplicitDeny");
  });
});
