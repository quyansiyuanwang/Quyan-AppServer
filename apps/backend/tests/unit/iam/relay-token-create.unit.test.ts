import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import {
  Permission,
  getIamActionDefinition,
  isIamActionResourceCompatible,
  iamActionsForLegacyPermission,
} from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
const own = "acs:relay:*:owner:token/actor/new-token",
  managed = "acs:platform:*:platform:relay-token/peer/new-token",
  control = "acs:quyan:*:owner:user/actor";
describe("native token creation contract", () => {
  it("declares a server-owned Create action and independent sensitive dependencies", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find((route) => route.key === "POST /v1/relay/tokens"),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:CreateToken"], issues: [] });
    const definition = getIamActionDefinition("quyan:relay:CreateToken")!;
    expect(definition.requiredActions).toEqual(["quyan:relay:GetToken"]);
    expect(definition.conditionalActions).toEqual(
      expect.arrayContaining([
        "quyan:relay:CreateManagedToken",
        "quyan:relay:RevealToken",
        "quyan:relay:SelectTokenChannel",
        "quyan:relay:ReferenceToken",
        "quyan:relay:SetTokenCredential",
        "quyan:relay:BypassTokenCredentialLimits",
      ]),
    );
    expect(getIamActionDefinition("quyan:relay:CreateManagedToken")!.authorizationBoundary).toBe("platform");
  });
  it("registers collection and prospective-resource scopes without treating personal creation as platform authority", () => {
    expect(isIamActionResourceCompatible("quyan:relay:CreateToken", control)).toBe(true);
    expect(isIamActionResourceCompatible("quyan:relay:CreateToken", own)).toBe(true);
    expect(isIamActionResourceCompatible("quyan:relay:CreateToken", managed)).toBe(false);
    expect(isIamActionResourceCompatible("quyan:relay:CreateManagedToken", managed)).toBe(true);
    expect(isIamActionResourceCompatible("quyan:relay:CreateManagedToken", own)).toBe(false);
  });
  it("projects legacy CREATE to the author's prospective tokens but never implicitly grants read, update, reference or credential capabilities", () => {
    const document = legacyPermissionsToPrincipalPolicy([Permission.RELAY_TOKEN_CREATE], "owner", "actor")!;
    const decide = (action: string, resource = own) =>
      evaluatePolicies([{ policyId: "fixture", document }], { action: "quyan:relay:" + action, resource }).decision;
    expect(decide("CreateToken", control)).toBe("Allow");
    expect(decide("CreateToken")).toBe("Allow");
    expect(decide("CreateToken", "acs:relay:*:owner:token/peer/new-token")).toBe("ImplicitDeny");
    for (const action of [
      "GetToken",
      "UpdateToken",
      "ReferenceToken",
      "SetTokenCredential",
      "BypassTokenCredentialLimits",
    ])
      expect(decide(action)).toBe("ImplicitDeny");
  });
  it("keeps channel selection compatibility for both legacy creation and updates without introducing cloud actions", () => {
    for (const permission of [Permission.RELAY_TOKEN_CREATE, Permission.RELAY_TOKEN_UPDATE])
      expect(iamActionsForLegacyPermission(permission)).toContain("quyan:relay:SelectTokenChannel");
    expect(getIamActionDefinition("quyan:relay:SelectTokenChannel")!.apiRoutes).toContain("POST /v1/relay/tokens");
    expect(getIamActionDefinition("alidns:AddDomainRecord")).toBeUndefined();
  });
});
