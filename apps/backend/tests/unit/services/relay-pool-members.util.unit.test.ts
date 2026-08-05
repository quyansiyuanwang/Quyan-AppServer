import { describe, expect, it } from "vitest";
import { resolveEffectiveRelayPoolMembers } from "../../../src/services/relay/relay-pool-members.util";

describe("resolveEffectiveRelayPoolMembers", () => {
  it("merges legacy and strict members by ID and lets strict settings win", () => {
    const legacyMember = {
      id: "legacy-edge",
      memberChannelId: "member-1",
      priority: 8,
      weight: 2,
      enabled: false,
      memberChannel: { id: "member-1", name: "Member 1", channelType: "standalone" },
    };
    const strictMember = {
      id: "member-1",
      name: "Member 1",
      channelType: "pooled-member",
      pooledPriority: 1,
      pooledWeight: 3,
      pooledMemberEnabled: true,
    };

    const result = resolveEffectiveRelayPoolMembers({
      id: "pool-1",
      channelType: "pooled",
      poolMembers: [legacyMember],
      pooledChildren: [strictMember],
    } as any);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      memberChannelId: "member-1",
      priority: 1,
      weight: 3,
      enabled: true,
      memberChannel: strictMember,
    });
  });

  it("keeps legacy members for non-pooled channels", () => {
    const result = resolveEffectiveRelayPoolMembers({
      id: "automatic-1",
      channelType: "automatic-proxy-pool",
      poolMembers: [{ memberChannelId: "logical-1", priority: 1, weight: 1, enabled: true }],
      pooledChildren: [{ id: "physical-1", pooledPriority: 1, pooledWeight: 1, pooledMemberEnabled: true }],
    } as any);

    expect(result.map((member) => member.memberChannelId)).toEqual(["logical-1"]);
  });
});
