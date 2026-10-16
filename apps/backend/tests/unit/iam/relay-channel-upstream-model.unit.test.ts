import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { parseUpstreamModels, relayUpstreamModelsPolicy } from "@/services/relay/relay-upstream-models";
import {
  platformRelayChannelArn,
  platformRelayChannelUpstreamModelResources as resolver,
} from "@/iam/resources/platform-relay-channel-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:BatchListUpstreamModels";
describe("bounded upstream model parsing and batch authorization contract", () => {
  it("parses protocol shapes and deduplicates IDs without exposing unrelated properties", () => {
    const catalog = [{ model: "display", provider: "request-id" }];
    expect(
      parseUpstreamModels(
        {
          data: [" request-id ", { id: "request-id", apiKey: "fixture-only" }, { name: "second" }, { model: "third" }],
        },
        catalog,
      ),
    ).toEqual([
      { id: "request-id", matched: true, pricingModel: "display", pricingModelId: "request-id" },
      { id: "second", matched: false },
      { id: "third", matched: false },
    ]);
    expect(parseUpstreamModels({ models: ["a"] }, [])).toMatchObject([{ id: "a" }]);
  });
  it("does not coerce objects, numbers, control characters or overlong IDs", () => {
    expect(
      parseUpstreamModels(
        {
          data: [
            { id: { secret: true } },
            { id: 42 },
            null,
            false,
            " ",
            "a\n",
            "a\0",
            "a".repeat(relayUpstreamModelsPolicy.maxModelIdLength + 1),
          ],
        },
        [],
      ),
    ).toEqual([]);
  });
  it("bounds parsed upstream entries and declines ambiguous pricing identities", () => {
    const catalog = [
      { model: "a", provider: "same" },
      { model: "b", provider: "same" },
      { model: "c", provider: "same" },
    ];
    expect(parseUpstreamModels({ data: ["same"] }, catalog)).toEqual([{ id: "same", matched: false }]);
    expect(
      parseUpstreamModels(
        { data: Array.from({ length: relayUpstreamModelsPolicy.maxModels + 1 }, (_, i) => String(i)) },
        [],
      ),
    ).toHaveLength(relayUpstreamModelsPolicy.maxModels);
  });
  it.each([null, undefined, [], {}, { data: "invalid" }])("rejects non-list payload %j safely", (payload) => {
    expect(parseUpstreamModels(payload, [])).toEqual([]);
  });
  it("maps only platform targets and keeps legacy permission removals as Deny", () => {
    const resource = platformRelayChannelArn("channel");
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["platform/relay-channel"],
      legacyPermission: Permission.RELAY_CHANNEL_UPDATE,
    });
    expect(isIamActionResourceCompatible(action, resource)).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:relay:*:owner:channel-submission/actor/channel")).toBe(false);
    const allow = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_UPDATE], "owner", "actor")!,
      deny = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_UPDATE], "owner", "actor", "Deny")!;
    expect(evaluatePolicies([{ policyId: "a", document: allow }], { action, resource }).decision).toBe("Allow");
    expect(
      evaluatePolicies(
        [
          { policyId: "a", document: allow },
          { policyId: "d", document: deny },
        ],
        { action, resource },
      ).decision,
    ).toBe("ExplicitDeny");
  });
  it("resolves the full batch in caller order without trusting identity or Action hints", async () => {
    const invoke = (ids: unknown, format = "openai") =>
      resolver({
        request: {
          body: { ids, format, action: "fake:*", accountOwnerId: "fake" },
          headers: { "x-action": "fake:*" },
        } as unknown as TypedRequest,
        principal: {
          subjectUserId: "actor",
          principalUserId: "actor",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
      });
    expect(await invoke(["b", "a"])).toEqual([platformRelayChannelArn("b"), platformRelayChannelArn("a")]);
    for (const invalid of [[], ["a", "a"], ["*"], ["a/b"], Array.from({ length: 201 }, (_, i) => String(i))])
      expect(await invoke(invalid)).toBeUndefined();
    expect(await invoke(["a"], "fake")).toBeUndefined();
  });
  it("declares a fixed Action, canonical batch resolver and forwards trusted request identity", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      source = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channels/batch/upstream-models",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], resourceKind: "batch", issues: [] });
    const method = source
      .getClassOrThrow("RelayChannelController")
      .getMethodOrThrow("batchListUpstreamModels")
      .getText();
    expect(method).toContain("validateBody(batchRelayChannelUpstreamModelsBodySchema)");
    expect(method).toContain("body, request.user!.userId, request");
  });
});
