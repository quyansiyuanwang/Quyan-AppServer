import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { importRelayTokensBodySchema } from "@/api/schema/relay/relay.schema";
import { RELAY_TOKEN_CREATION_LIMITS } from "@/constant/relay-token";
import { relayTokenCopyNames } from "@/util/relay/relay-token-name.util";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";

describe("native token import contract", () => {
  it("declares a fixed import action rather than reusing creation admission", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (route) => route.key === "POST /v1/relay/tokens/import",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:ImportTokens"], issues: [] });
    const definition = getIamActionDefinition("quyan:relay:ImportTokens")!;
    expect(definition.requiredActions).toEqual(["quyan:relay:CreateToken", "quyan:relay:GetToken"]);
    expect(definition.conditionalActions).toEqual(
      expect.arrayContaining([
        "quyan:relay:RevealToken",
        "quyan:relay:SetTokenCredential",
        "quyan:relay:ReferenceToken",
        "quyan:relay:SelectTokenChannel",
        "quyan:relay:ImportManagedTokens",
      ]),
    );
    expect(getIamActionDefinition("quyan:relay:CreateToken")!.apiRoutes).toContain("POST /v1/relay/tokens/import");
    expect(getIamActionDefinition("quyan:relay:SelectTokenChannel")!.apiRoutes).toContain(
      "POST /v1/relay/tokens/import",
    );
  });
  it("keeps personal and platform resource boundaries distinct", () => {
    const own = "acs:relay:*:owner:token/actor/new-token";
    const managed = "acs:platform:*:platform:relay-token/peer/new-token";
    expect(isIamActionResourceCompatible("quyan:relay:ImportTokens", own)).toBe(true);
    expect(isIamActionResourceCompatible("quyan:relay:ImportTokens", "acs:quyan:*:owner:user/actor")).toBe(true);
    expect(isIamActionResourceCompatible("quyan:relay:ImportTokens", managed)).toBe(false);
    expect(isIamActionResourceCompatible("quyan:relay:ImportManagedTokens", managed)).toBe(true);
    expect(isIamActionResourceCompatible("quyan:relay:ImportManagedTokens", own)).toBe(false);
    expect(getIamActionDefinition("quyan:relay:ImportManagedTokens")!.authorizationBoundary).toBe("platform");
  });
  it("bridges legacy CREATE only to the author's future imports, not peers or disclosure", () => {
    const document = legacyPermissionsToPrincipalPolicy([Permission.RELAY_TOKEN_CREATE], "owner", "actor")!;
    const decide = (action: string, resource: string) =>
      evaluatePolicies([{ policyId: "fixture", document }], { action, resource }).decision;
    expect(decide("quyan:relay:ImportTokens", "acs:relay:*:owner:token/actor/new-token")).toBe("Allow");
    expect(decide("quyan:relay:ImportTokens", "acs:relay:*:owner:token/peer/new-token")).toBe("ImplicitDeny");
    expect(decide("quyan:relay:RevealToken", "acs:relay:*:owner:token/actor/new-token")).toBe("ImplicitDeny");
  });
  it("retains stream and content safety configuration through schema validation", () => {
    const item = {
      channelId: "channel",
      enabled: false,
      contentSafetyConfig: { requestEnabled: false },
      streamConfig: { preflightBufferLimitBytes: 512 * 1024 },
    };
    expect(importRelayTokensBodySchema.parse({ tokens: [item] }).tokens[0]).toEqual(item);
    expect(
      importRelayTokensBodySchema.safeParse({ tokens: [{ ...item, streamConfig: { preflightBufferLimitBytes: -1 } }] })
        .success,
    ).toBe(false);
  });
  it("enforces the centralized nonempty 200-item batch limit", () => {
    expect(RELAY_TOKEN_CREATION_LIMITS.batch).toBe(200);
    const item = { channelId: "channel" };
    expect(
      importRelayTokensBodySchema.safeParse({ tokens: Array(RELAY_TOKEN_CREATION_LIMITS.batch).fill(item) }).success,
    ).toBe(true);
    expect(importRelayTokensBodySchema.safeParse({ tokens: [] }).success).toBe(false);
    expect(
      importRelayTokensBodySchema.safeParse({ tokens: Array(RELAY_TOKEN_CREATION_LIMITS.batch + 1).fill(item) })
        .success,
    ).toBe(false);
  });
  it("shares bounded copy suffixes, truncation and localized exhaustion", () => {
    const names = relayTokenCopyNames("name");
    expect(names.next().value).toBe("name（副本）");
    expect(names.next().value).toBe("name（副本2）");
    expect(relayTokenCopyNames("a".repeat(100)).next().value!.length).toBe(RELAY_TOKEN_CREATION_LIMITS.nameLength);
    const exhausted = relayTokenCopyNames("name");
    for (let i = 0; i < RELAY_TOKEN_CREATION_LIMITS.copyNameAttempts; i++) exhausted.next();
    expect(() => exhausted.next()).toThrow("Unable to generate a unique relay token name");
  });
});
