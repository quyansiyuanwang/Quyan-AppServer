import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, buildAcsResource } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";

describe("model mapping preview and candidate action contracts", () => {
  it.each([
    [
      "model-mapping-preview",
      "PreviewTokenModelMapping",
      "PreviewManagedTokenModelMapping",
      "previewTokenModelMapping",
    ],
    [
      "model-mapping-channel-options",
      "ListTokenModelMappingChannelOptions",
      "ListManagedTokenModelMappingChannelOptions",
      "tokenModelMappingChannelOptions",
    ],
  ])("registers explicit personal and managed actions for %s", (path, operation, managedOperation, methodName) => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const source = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    const route = "POST /v1/relay/tokens/" + path;
    expect(collectIamRoutes(project.getSourceFiles(), process.cwd()).find((row) => row.key === route)).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:relay:" + operation],
      resourceKind: "collection",
      issues: [],
    });
    const method = source.getClassOrThrow("RelayController").getMethodOrThrow(methodName);
    expect(method.getDecoratorOrThrow("Security").getText()).toContain('"relay:channel:read"');
    expect(method.getDecoratorOrThrow("Security").getText()).toContain('"relay:token:read"');
    expect(method.getText()).toContain("alwaysEnforce: true");
    expect(getIamActionDefinition("quyan:relay:" + operation)).toMatchObject({
      resourceTypes: ["quyan/user", "relay/token"],
      legacyPermission: Permission.RELAY_TOKEN_READ,
      apiRoutes: [route],
      conditionalActions: ["quyan:relay:" + managedOperation, "quyan:relay:ListChannelRoutingCatalog"],
    });
    expect(getIamActionDefinition("quyan:relay:" + managedOperation)).toMatchObject({
      authorizationBoundary: "platform",
      resourceTypes: ["platform/user", "platform/relay-token"],
      legacyPermission: Permission.RELAY_TOKEN_MANAGE_OTHERS_READ,
    });
  });
  it.each(["PreviewTokenModelMapping", "ListTokenModelMappingChannelOptions"])(
    "bounds legacy %s grants to the actor",
    (operation) => {
      const policy = legacyPermissionsToPrincipalPolicy([Permission.RELAY_TOKEN_READ], "owner", "actor")!;
      const resource = (user: string) =>
        buildAcsResource({ service: "quyan", region: "*", accountId: "owner", path: "user/" + user });
      expect(
        evaluatePolicies([{ policyId: "fixture", document: policy }], {
          action: "quyan:relay:" + operation,
          resource: resource("actor"),
        }).decision,
      ).toBe("Allow");
      expect(
        evaluatePolicies([{ policyId: "fixture", document: policy }], {
          action: "quyan:relay:" + operation,
          resource: resource("peer"),
        }).decision,
      ).not.toBe("Allow");
    },
  );
});
