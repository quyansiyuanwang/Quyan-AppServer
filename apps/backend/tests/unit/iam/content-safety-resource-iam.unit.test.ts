import { describe, expect, it } from "vitest";
import { getIamActionDefinition } from "@quyan/shared";
import { contentSafetyUserResourceResolver } from "@/iam/request/content-safety-resource-resolvers";
import type { TypedRequest } from "@/types/express";

const principal = {
  subjectUserId: "user-1",
  principalUserId: "user-1",
  accountOwnerId: "account-1",
  subjectType: "sub_user" as const,
};
const request = (query: Record<string, unknown> = {}, body: unknown = {}) =>
  ({ query, body }) as unknown as TypedRequest;

describe("content safety IAM resource contract", () => {
  it("resolves the authenticated user when no administrative target is supplied", () => {
    expect(contentSafetyUserResourceResolver({ request: request(), principal })).toBe(
      "acs:quyan:*:account-1:user/user-1",
    );
  });

  it("resolves validated target identifiers from the request without trusting account input", () => {
    expect(
      contentSafetyUserResourceResolver({
        request: request({ targetUserId: "user-2" }, { targetUserId: "user-3", accountId: "attacker-account" }),
        principal,
      }),
    ).toBe("acs:quyan:*:account-1:user/user-3");
  });

  it("registers every user-scoped content safety action", () => {
    for (const operation of [
      "GetUserConfig",
      "UpdateUserConfig",
      "UpdateRuleOverride",
      "DeleteRuleOverride",
      "ListUserRules",
      "CreateUserRule",
      "UpdateUserRule",
      "DeleteUserRule",
      "ImportUserRules",
      "BatchUpdateUserRules",
      "ExportUserRules",
      "ListUserIncidents",
    ]) {
      expect(getIamActionDefinition(`quyan:content_safety:${operation}`)).toMatchObject({
        resourceTypes: ["quyan/user"],
        authorizationStage: "declared",
      });
    }
  });
});
