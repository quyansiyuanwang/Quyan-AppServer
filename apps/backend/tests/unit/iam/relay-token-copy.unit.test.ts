import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
const own = "acs:relay:*:owner:token/actor/source",
  control = "acs:quyan:*:owner:user/actor",
  managed = "acs:platform:*:platform:relay-token/peer/source";
describe("native token configuration duplication contract", () => {
  it("declares a server-owned duplicate operation for both single and batch endpoints", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const path of ["POST /v1/relay/tokens/{id}/duplicate", "POST /v1/relay/tokens/batch/duplicate"]) {
      expect(routes.find((route) => route.key === path)).toMatchObject({
        coverage: "explicit",
        actions: ["quyan:relay:DuplicateToken"],
        issues: [],
      });
      for (const action of ["DuplicateToken", "CreateToken", "SelectTokenChannel"])
        expect(getIamActionDefinition("quyan:relay:" + action)!.apiRoutes).toContain(path);
    }
  });
  it("requires creation and source/destination metadata reads but never requires source disclosure or import", () => {
    const definition = getIamActionDefinition("quyan:relay:DuplicateToken")!;
    expect(definition.requiredActions).toEqual(["quyan:relay:CreateToken", "quyan:relay:GetToken"]);
    expect(definition.conditionalActions).toEqual(
      expect.arrayContaining([
        "quyan:relay:RevealToken",
        "quyan:relay:SelectTokenChannel",
        "quyan:relay:ReferenceToken",
        "quyan:relay:DuplicateManagedToken",
      ]),
    );
    for (const action of [
      "quyan:relay:RevealToken",
      "quyan:relay:ImportTokens",
      "quyan:relay:SetTokenCredential",
      "quyan:relay:UpdateToken",
    ])
      expect(definition.requiredActions).not.toContain(action);
  });
  it("does not mix personal and platform scopes", () => {
    expect(isIamActionResourceCompatible("quyan:relay:DuplicateToken", own)).toBe(true);
    expect(isIamActionResourceCompatible("quyan:relay:DuplicateToken", control)).toBe(true);
    expect(isIamActionResourceCompatible("quyan:relay:DuplicateToken", managed)).toBe(false);
    expect(isIamActionResourceCompatible("quyan:relay:DuplicateManagedToken", managed)).toBe(true);
    expect(isIamActionResourceCompatible("quyan:relay:DuplicateManagedToken", own)).toBe(false);
    expect(getIamActionDefinition("quyan:relay:DuplicateManagedToken")!.authorizationBoundary).toBe("platform");
  });
  it("projects legacy CREATE to the author's copy source scope only, not peer reads or secrets", () => {
    const document = legacyPermissionsToPrincipalPolicy([Permission.RELAY_TOKEN_CREATE], "owner", "actor")!;
    const decide = (action: string, resource = own) =>
      evaluatePolicies([{ policyId: "fixture", document }], { action: "quyan:relay:" + action, resource }).decision;
    expect(decide("DuplicateToken")).toBe("Allow");
    expect(decide("DuplicateToken", control)).toBe("Allow");
    expect(decide("DuplicateToken", "acs:relay:*:owner:token/peer/source")).toBe("ImplicitDeny");
    for (const action of ["GetToken", "RevealToken", "SetTokenCredential", "UpdateToken"])
      expect(decide(action)).toBe("ImplicitDeny");
  });
});
