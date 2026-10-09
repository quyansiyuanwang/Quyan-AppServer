import { describe, expect, it } from "vitest";
import { ALL_NOTIFICATION_EVENTS, Permission, iamActionsForLegacyPermission } from "@quyan/shared";
import { normalizeNotificationPreferenceUpdate } from "@/services/notification/notification-preference-validation";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";

describe("notification preference input and compatibility", () => {
  it("strips identity, lifecycle, and event-version overrides from internal inputs", () => {
    expect(
      normalizeNotificationPreferenceUpdate({
        notificationEmail: null,
        subscribedEvents: [],
        thresholds: {},
        cooldownMinutes: 0,
        userId: "peer",
        accountOwnerId: "foreign",
        id: "forged",
        status: -1,
        knownEvents: ["forged"],
      }),
    ).toEqual({
      notificationEmail: null,
      subscribedEvents: [],
      thresholds: {},
      cooldownMinutes: 0,
      knownEvents: [...ALL_NOTIFICATION_EVENTS],
    });
    expect(normalizeNotificationPreferenceUpdate({ knownEvents: [] })).toEqual({});
  });
  it.each([
    { notificationEmail: "invalid" },
    { cooldownMinutes: -1 },
    { cooldownMinutes: 43201 },
    { cooldownMinutes: 0.5 },
    { thresholds: { balance_low: -1 } },
    { thresholds: { balance_low: Infinity } },
    { subscribedEvents: ["unknown"] },
    { subscribedEvents: new Array(ALL_NOTIFICATION_EVENTS.length + 1).fill(ALL_NOTIFICATION_EVENTS[0]) },
    null,
  ])("rejects invalid internal preference data without echoing it", (input) => {
    expect(() => normalizeNotificationPreferenceUpdate(input)).toThrowError(
      expect.objectContaining({
        statusCode: 400,
        messageKey: "errors.validationFailed",
        data: undefined,
      }),
    );
  });
  it("maps the old permission to explicitly registered native Actions, with removals staying Deny", () => {
    const actions = iamActionsForLegacyPermission(Permission.NOTIFICATION_MANAGE);
    expect(actions).toContain("quyan:notification:GetPreferences");
    expect(actions).toContain("quyan:notification:UpdatePreferences");
    for (const Effect of ["Allow", "Deny"] as const) {
      const document = parseIamPolicy(
        legacyPermissionsToPrincipalPolicy([Permission.NOTIFICATION_MANAGE], "account", "actor", Effect),
      ).document;
      for (const action of actions.slice(1))
        expect(
          evaluatePolicies([{ policyId: "legacy", document }], {
            action,
            resource: "acs:quyan:*:account:user/actor",
          }).decision,
        ).toBe(Effect === "Allow" ? "Allow" : "ExplicitDeny");
    }
  });
  it("does not reinterpret a canonical JSON management grant as native preference Actions", () => {
    const document = parseIamPolicy({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: iamActionsForLegacyPermission(Permission.NOTIFICATION_MANAGE)[0],
        Resource: "*",
      },
    }).document;
    expect(
      evaluatePolicies([{ policyId: "explicit-json", document }], {
        action: "quyan:notification:GetPreferences",
        resource: "acs:quyan:*:account:user/actor",
      }).decision,
    ).toBe("ImplicitDeny");
  });
});
