import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { getIamActionDefinition, isIamActionResourceCompatible, iamLegacyPermissionsForAction } from "@quyan/shared";
import { relayChannelSelectionArn } from "@/iam/resources/relay-channel-selection-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const action = "quyan:relay:ListChannelCatalog",
  resource = relayChannelSelectionArn("owner", "channel");
describe("consumer catalog server metadata and compatibility", () => {
  it("declares one fixed consumer Action, not platform management or a client-selected Action", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    const route = collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
      (row) => row.key === "GET /v1/relay-channels/catalog",
    );
    expect(route).toMatchObject({ coverage: "explicit", actions: [action], resourceKind: "collection", issues: [] });
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["relay/channel-selection"],
      accessLevel: "List",
      sensitive: false,
    });
    expect(getIamActionDefinition(action)!.authorizationBoundary).toBeUndefined();
    expect(isIamActionResourceCompatible(action, resource)).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:platform:*:platform:relay-channel/channel")).toBe(false);
    expect(isIamActionResourceCompatible(action, "acs:quyan:*:owner:account")).toBe(false);
  });
  it.each(iamLegacyPermissionsForAction(action))(
    "preserves legacy %s with explicit removals taking precedence",
    (permission) => {
      const allow = legacyPermissionsToPrincipalPolicy([permission], "owner", "actor")!,
        deny = legacyPermissionsToPrincipalPolicy([permission], "owner", "actor", "Deny")!;
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
    },
  );
});
