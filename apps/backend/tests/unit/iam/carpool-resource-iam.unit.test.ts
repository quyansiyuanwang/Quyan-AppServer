import { beforeEach, describe, expect, it, vi } from "vitest";

const { findOrder } = vi.hoisted(() => ({ findOrder: vi.fn() }));
vi.mock("@/store/billing/carpool.repository", () => ({
  CarpoolRepository: { getInstance: () => ({ findOrder }) },
}));

import { getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { carpoolOrderResourceResolver } from "@/iam/request/carpool-resource-resolvers";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import type { TypedRequest } from "@/types/express";

const principal = {
  subjectUserId: "user-1",
  principalUserId: "user-1",
  accountOwnerId: "account-1",
  subjectType: "sub_user" as const,
};
const request = (id: string) => ({ params: { id }, body: { accountId: "foreign-account" } }) as unknown as TypedRequest;

beforeEach(() => {
  vi.clearAllMocks();
  findOrder.mockResolvedValue({
    id: "order-1",
    members: [{ userId: "user-1" }],
  });
});

describe("carpool IAM resource contract", () => {
  it("resolves only an order containing the authenticated subject", async () => {
    await expect(carpoolOrderResourceResolver({ request: request("order-1"), principal })).resolves.toBe(
      "acs:carpool:*:account-1:order/order-1",
    );
    findOrder.mockResolvedValueOnce({ id: "order-1", members: [{ userId: "user-2" }] });
    await expect(carpoolOrderResourceResolver({ request: request("order-1"), principal })).resolves.toBeUndefined();
    expect(findOrder).toHaveBeenCalledWith("order-1");
  });

  it("rejects malformed identifiers before querying the repository", async () => {
    await expect(carpoolOrderResourceResolver({ request: request("*"), principal })).resolves.toBeUndefined();
    expect(findOrder).not.toHaveBeenCalled();
  });

  it("fails closed for missing or mismatched stored targets", async () => {
    findOrder.mockResolvedValueOnce(null);
    await expect(carpoolOrderResourceResolver({ request: request("order-1"), principal })).resolves.toBeUndefined();
    findOrder.mockResolvedValueOnce({ id: "other-order", members: [{ userId: "user-1" }] });
    await expect(carpoolOrderResourceResolver({ request: request("order-1"), principal })).resolves.toBeUndefined();
  });

  it("limits an Allow to its target order and retains explicit Deny precedence", () => {
    const action = "quyan:carpool:CancelOrder";
    const document = parseIamPolicy({
      Version: "1",
      Statement: [
        { Effect: "Allow", Action: action, Resource: "acs:carpool:*:account-1:order/order-*" },
        { Effect: "Deny", Action: action, Resource: "acs:carpool:*:account-1:order/order-2" },
      ],
    }).document;
    const decide = (resource: string) =>
      evaluatePolicies([{ policyId: "fixture", document }], { action, resource }).decision;
    expect(decide("acs:carpool:*:account-1:order/order-1")).toBe("Allow");
    expect(decide("acs:carpool:*:account-1:order/order-2")).toBe("ExplicitDeny");
    expect(decide("acs:carpool:*:foreign:order/order-1")).toBe("ImplicitDeny");
    expect(isIamActionResourceCompatible(action, "acs:carpool:*:account-1:template/template-1")).toBe(false);
  });

  it("registers order actions against the concrete carpool order resource", () => {
    expect(getIamActionDefinition("quyan:carpool:GetOrder")).toMatchObject({
      resourceTypes: ["carpool/order"],
    });
    expect(getIamActionDefinition("quyan:carpool:CreateOrder")).toMatchObject({
      resourceTypes: ["quyan/user"],
    });
  });
});
