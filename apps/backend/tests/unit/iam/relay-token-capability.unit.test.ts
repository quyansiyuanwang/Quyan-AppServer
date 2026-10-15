import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
describe("token capability action contract", () => {
  it("declares a fixed native action and preserves channel-read OAuth scope", () => {
    const p = new Project({ skipAddingFilesFromTsConfig: true });
    const source = p.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    expect(
      collectIamRoutes(p.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "GET /v1/relay/tokens/{id}/available-models",
      ),
    ).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:relay:GetTokenAvailableModels"],
      issues: [],
    });
    const method = source.getClassOrThrow("RelayController").getMethodOrThrow("getTokenAvailableModels");
    expect(method.getDecoratorOrThrow("Security").getText()).toContain('"relay:channel:read"');
    expect(method.getBodyOrThrow().getText()).toContain("targetUserId, request");
  });
  it("registers personal and platform-managed resources as independent actions", () => {
    expect(getIamActionDefinition("quyan:relay:GetTokenAvailableModels")).toMatchObject({
      resourceTypes: ["quyan/user", "relay/token"],
      legacyPermission: Permission.RELAY_TOKEN_READ,
    });
    expect(getIamActionDefinition("quyan:relay:GetManagedTokenAvailableModels")).toMatchObject({
      authorizationBoundary: "platform",
      legacyPermission: Permission.RELAY_TOKEN_MANAGE_OTHERS_READ,
    });
  });
  it("declares preview and managed preview separately without changing token-read OAuth scope", () => {
    const p = new Project({ skipAddingFilesFromTsConfig: true });
    const source = p.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    expect(
      collectIamRoutes(p.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay/tokens/composition-preview",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:PreviewTokenComposition"], issues: [] });
    const method = source.getClassOrThrow("RelayController").getMethodOrThrow("previewComposition");
    expect(method.getDecoratorOrThrow("Security").getText()).toContain('"relay:token:read"');
    expect(method.getBodyOrThrow().getText()).toContain("body, request");
    expect(getIamActionDefinition("quyan:relay:PreviewManagedTokenComposition")).toMatchObject({
      authorizationBoundary: "platform",
      resourceTypes: ["platform/user", "platform/relay-token"],
    });
  });
});
