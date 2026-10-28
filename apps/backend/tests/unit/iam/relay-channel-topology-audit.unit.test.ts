import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { legacyPermissionsToPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import {
  assertRelayConfigurationTopology,
  relayConfigurationTopologyIssues,
} from "@/util/relay-configuration-topology";
const channel = (
  id: string,
  channelType = "standalone",
  pooledParentId: string | null = null,
  members: string[] = [],
) => ({
  id,
  name: id,
  channelType,
  pooledParentId,
  poolMembers: members.map((memberChannelId) => ({ memberChannelId })),
});
describe("global topology audit contract", () => {
  it("registers a fixed full-admission action on configuration and channel resources only", () => {
    const action = "quyan:relay:AuditChannelTopology",
      definition = getIamActionDefinition(action)!;
    expect(definition.authorizationBoundary).toBe("platform");
    expect(definition.legacyPermission).toBe(Permission.RELAY_CHANNEL_READ);
    expect(definition.resourceTypes).toEqual(["platform/relay-configuration", "platform/relay-channel"]);
    expect(isIamActionResourceCompatible(action, "acs:platform:*:platform:relay-configuration/default")).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:platform:*:platform:relay-channel/channel")).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:platform:*:platform:model-pricing/price")).toBe(false);
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "GET /v1/relay-channels/topology-audit",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], issues: [] });
  });
  it("maps historical READ to both audit contributions", () => {
    const document = legacyPermissionsToPolicy([Permission.RELAY_CHANNEL_READ], "owner")!;
    for (const resource of [
      "acs:platform:*:platform:relay-configuration/default",
      "acs:platform:*:platform:relay-channel/channel",
    ])
      expect(
        evaluatePolicies([{ policyId: "fixture", document }], { action: "quyan:relay:AuditChannelTopology", resource })
          .decision,
      ).toBe("Allow");
  });
  it("uses the same invariant report as strict-mode admission", () => {
    const graph = [
      channel("root", "pooled", null, ["orphan"]),
      channel("orphan", "pooled-member"),
      channel("wrong", "standalone", "root"),
      channel("automatic", "automatic-proxy-pool", null, ["orphan"]),
    ];
    expect(relayConfigurationTopologyIssues(graph).map((row) => row.code)).toEqual([
      "legacy_pool_members",
      "invalid_pooled_parent",
      "non_member_pooled_parent",
      "automatic_pool_physical_member",
    ]);
    expect(() => assertRelayConfigurationTopology(graph)).toThrow();
  });
  it.each([
    { graph: [] },
    { graph: [channel("standalone")] },
    {
      graph: [
        channel("pool", "pooled"),
        channel("leaf", "pooled-member", "pool"),
        channel("automatic", "automatic-proxy-pool", null, ["pool"]),
      ],
    },
  ])("accepts complete valid topologies %#", ({ graph }) => {
    expect(relayConfigurationTopologyIssues(graph)).toEqual([]);
    expect(() => assertRelayConfigurationTopology(graph)).not.toThrow();
  });
});
