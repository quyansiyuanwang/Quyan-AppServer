import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { getIamActionDefinition, isIamActionResourceCompatible, iamLegacyPermissionsForAction } from "@quyan/shared";
import { relayChannelSelectionArn } from "@/iam/resources/relay-channel-selection-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { MAX_RETRY_STATUS_RULES, matchesRetryStatusRule } from "@/util/relay/relay-failover-status-rule.util";
import { consumerRoutingConfig } from "@/services/relay/relay-channel-routing-catalog-projection";
const action = "quyan:relay:ListChannelRoutingCatalog",
  resource = relayChannelSelectionArn("owner", "channel");
describe("routing catalog contract and safe consumer metadata", () => {
  it("keeps consumer resource grants separate from local and deployment preview authority", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    const route = collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
      (row) => row.key === "GET /v1/relay-channels/routing-catalog",
    );
    expect(route).toMatchObject({ coverage: "explicit", actions: [action], resourceKind: "collection", issues: [] });
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["relay/channel-selection"],
      conditionalActions: [
        "quyan:relay:PreviewChannelRoutingCatalog",
        "quyan:relay:PreviewManagedChannelRoutingCatalog",
      ],
    });
    expect(isIamActionResourceCompatible(action, resource)).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:platform:*:platform:relay-channel/channel")).toBe(false);
    expect(getIamActionDefinition("quyan:relay:PreviewChannelRoutingCatalog")).toMatchObject({
      resourceTypes: ["quyan/user"],
    });
    expect(getIamActionDefinition("quyan:relay:PreviewChannelRoutingCatalog")!.authorizationBoundary).toBeUndefined();
    expect(getIamActionDefinition("quyan:relay:PreviewManagedChannelRoutingCatalog")).toMatchObject({
      resourceTypes: ["platform/user"],
      authorizationBoundary: "platform",
    });
  });
  it.each(iamLegacyPermissionsForAction(action))(
    "preserves the existing %s alternative without hiding explicit removals",
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
  it("projects only registered consumer routing fields and clones arrays", () => {
    const input = {
      maxRetries: 2,
      failoverThreshold: 3,
      retryStatusCodes: [429, "5xx"],
      failbackCooldownMinutes: 20,
      healthScoreThreshold: null,
      latencyThresholdMs: 10,
      circuitBreakerThreshold: 3,
      stickyByModel: true,
      stickyByFormat: false,
      rankingMode: "price-first",
      allowedModelsMode: "all",
      manualAvailability: 1,
      apiKey: "fixture-secret",
      futureConfig: { credential: "fixture" },
    };
    const output = consumerRoutingConfig(input)!;
    expect(output).toEqual({
      maxRetries: 2,
      failoverThreshold: 3,
      retryStatusCodes: [429, "5xx"],
      failbackCooldownMinutes: 20,
      healthScoreThreshold: null,
      latencyThresholdMs: 10,
      circuitBreakerThreshold: 3,
      stickyByModel: true,
      stickyByFormat: false,
      rankingMode: "price-first",
    });
    output.retryStatusCodes!.length = 0;
    expect(input.retryStatusCodes).toHaveLength(2);
  });
  it.each([null, undefined, 42, [], "bad", { apiKey: "fixture-only" }])(
    "ignores non-contract routing data %#",
    (value) => {
      expect(consumerRoutingConfig(value)).toBeUndefined();
    },
  );
  it("does not coerce malformed fields or return credentials embedded in status codes", () => {
    expect(
      consumerRoutingConfig({
        maxRetries: "2",
        stickyByModel: "false",
        rankingMode: "invented",
        retryStatusCodes: ["fixture-only-secret"],
        healthScoreThreshold: 2,
        latencyThresholdMs: -1,
        circuitBreakerThreshold: NaN,
        failoverThreshold: Infinity,
      }),
    ).toBeUndefined();
    expect(consumerRoutingConfig({ retryStatusCodes: Array(MAX_RETRY_STATUS_RULES + 1).fill(500) })).toBeUndefined();
  });
  it("preserves canonical mixed wildcards and regex semantics without publishing regex text", () => {
    const rules = [429, "5*x", "X0x", " 5XX ", "/^(?:[34]0[12]|599|private-fixture-text)$/i"];
    const projected = consumerRoutingConfig({ retryStatusCodes: rules })!.retryStatusCodes!;
    expect(projected).toEqual([429, "5*x", "x0x", "5xx", 301, 302, 401, 402, 599]);
    expect(JSON.stringify(projected)).not.toContain("private-fixture-text");
    for (let code = 100; code <= 599; code++)
      expect(projected.some((rule) => matchesRetryStatusRule(code, rule))).toBe(
        rules.some((rule) => matchesRetryStatusRule(code, rule)),
      );
  });
  it.each([
    { rules: ["/not-a-status/"] },
    { rules: ["/^5/g"] },
    { rules: ["/[/"] },
    { rules: ["5xx", "fixture-only-secret"] },
    { rules: [{}] },
    { rules: ["/" + "x".repeat(2048) + "/"] },
    { rules: ["/(?:(?:a?){1000000000})b/"] },
  ])("omits unsafe or nonmatching retry metadata without executing unbounded patterns %#", ({ rules }) => {
    expect(consumerRoutingConfig({ retryStatusCodes: rules })).toBeUndefined();
  });
});
