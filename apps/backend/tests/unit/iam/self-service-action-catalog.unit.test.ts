import { describe, expect, it } from "vitest";
import { getIamActionDefinition } from "@quyan/shared";

describe("self-service IAM action catalog", () => {
  it("registers support, monthly pass, and remote terminal actions with bounded resources", () => {
    const userActions = [
      "quyan:support:GetAvailability",
      "quyan:support:GetConversation",
      "quyan:support:ClearConversation",
      "quyan:support:SendMessage",
      "quyan:support:Handoff",
      "quyan:balance:GetAccount",
      "quyan:balance:GetUsage",
      "quyan:balance:GetTransferConfig",
      "quyan:balance:ListGiftCodes",
      "quyan:balance:CreateGiftCode",
      "quyan:balance:CancelGiftCode",
      "quyan:balance:CreateTransfer",
      "quyan:balance:ListTransactions",
      "quyan:carpool:ListMyOrders",
      "quyan:carpool:CreateOrder",
      "quyan:carpool:AcceptInvite",
      "quyan:monthly_pass:ListMyPasses",
      "quyan:monthly_pass:ClaimPublishedTemplate",
      "quyan:remote_terminal:ListMyEntitlements",
      "quyan:remote_terminal:ClaimPublishedTemplate",
      "quyan:remote_terminal:RotateMyRegistrationToken",
      "quyan:remote_terminal:GetMyInstallToken",
      "quyan:remote_terminal:ListMyDevices",
      "quyan:remote_terminal:GetMyUnbindReminder",
    ];
    for (const action of userActions)
      expect(getIamActionDefinition(action)).toMatchObject({
        resourceTypes: ["quyan/user"],
        authorizationStage: "declared",
      });

    expect(getIamActionDefinition("quyan:monthly_pass:ListPublishedTemplates")).toMatchObject({
      resourceTypes: ["quyan/account"],
    });
    expect(getIamActionDefinition("quyan:remote_terminal:ListPublishedTemplates")).toMatchObject({
      resourceTypes: ["quyan/account"],
    });
    for (const action of [
      "quyan:carpool:GetOrder",
      "quyan:carpool:CreateInvite",
      "quyan:carpool:AllocateRatios",
      "quyan:carpool:ConfirmMember",
      "quyan:carpool:LeaveOrder",
      "quyan:carpool:CancelOrder",
      "quyan:carpool:SubmitOrder",
    ])
      expect(getIamActionDefinition(action)).toMatchObject({
        resourceTypes: ["carpool/order"],
        authorizationStage: "declared",
      });

    expect(getIamActionDefinition("quyan:carpool:ListPublishedTemplates")).toMatchObject({
      resourceTypes: ["quyan/account"],
    });
    expect(getIamActionDefinition("quyan:carpool:ListPackageCatalog")).toMatchObject({
      resourceTypes: ["quyan/account"],
    });
  });
});
