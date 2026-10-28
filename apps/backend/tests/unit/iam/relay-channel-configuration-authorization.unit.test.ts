import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { legacyPermissionsToPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
const resource = "acs:platform:*:platform:relay-channel/channel";
describe("channel configuration resource authorization declarations", () => {
  it.each(["ListChannels", "GetChannel"])("registers %s only on actual platform channels", (operation) => {
    const action = "quyan:relay:" + operation;
    expect(getIamActionDefinition(action)).toMatchObject({
      authorizationBoundary: "platform",
      resourceTypes: ["platform/relay-channel"],
      legacyPermissions: [Permission.RELAY_CHANNEL_READ, Permission.RELAY_CHANNEL_REVIEW],
    });
    expect(isIamActionResourceCompatible(action, resource)).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:relay:*:owner:channel/channel")).toBe(false);
    expect(isIamActionResourceCompatible(action, "acs:quyan:*:owner:user/user")).toBe(false);
  });
  it("declares fixed actions independently of client headers or query inputs", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [path, action] of [
      ["GET /v1/relay-channels", "ListChannels"],
      ["GET /v1/relay-channels/{id}", "GetChannel"],
    ])
      expect(routes.find((row) => row.key === path)).toMatchObject({
        coverage: "explicit",
        actions: ["quyan:relay:" + action],
        issues: [],
      });
  });
  it.each([Permission.RELAY_CHANNEL_READ, Permission.RELAY_CHANNEL_REVIEW])(
    "preserves legacy %s without granting writes",
    (permission) => {
      const document = legacyPermissionsToPolicy([permission], "owner")!;
      for (const operation of ["ListChannels", "GetChannel"])
        expect(
          evaluatePolicies([{ policyId: "fixture", document }], { action: "quyan:relay:" + operation, resource })
            .decision,
        ).toBe("Allow");
      expect(
        evaluatePolicies([{ policyId: "fixture", document }], {
          action: "quyan:ram:DeleteUser",
          resource: "acs:quyan:*:owner:user/user",
        }).decision,
      ).toBe("ImplicitDeny");
    },
  );
});
