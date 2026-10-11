import { describe, expect, it } from "vitest";
import { relayChannelResourceResolver } from "@/iam/request/resource-resolvers";
import type { TypedRequest } from "@/types/express";

const principal = {
  subjectUserId: "user-1",
  principalUserId: "user-1",
  accountOwnerId: "account-1",
  subjectType: "sub_user" as const,
};

const request = (id: unknown) => ({ params: { id } }) as unknown as TypedRequest;

describe("relay channel IAM resource resolver", () => {
  it("builds a channel ARN from the validated route identifier and trusted account", async () => {
    await expect(relayChannelResourceResolver({ request: request("channel-1"), principal })).toBe(
      "acs:relay:*:account-1:channel/channel-1",
    );
  });

  it("does not resolve malformed identifiers or use a caller supplied account", async () => {
    await expect(relayChannelResourceResolver({ request: request("bad/channel"), principal })).toBeUndefined();
    const accountOverrideRequest = {
      params: { id: "channel-1" },
      body: { accountId: "attacker-account" },
    } as unknown as TypedRequest;
    await expect(relayChannelResourceResolver({ request: accountOverrideRequest, principal })).toBe(
      "acs:relay:*:account-1:channel/channel-1",
    );
  });
});
