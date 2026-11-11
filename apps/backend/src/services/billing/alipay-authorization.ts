import { Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { platformSystemArn } from "@/iam/resources/platform-system-resources";
import { authorizeLegacyPermissions } from "@/iam/middleware/legacy-permission-bridge";
import { iamAccountDenied } from "@/store/users/iam-account-principal";

export const paymentManagementResource = () => platformSystemArn("payment-orders");
export async function assertPaymentAdmin(
  request: TypedRequest,
  operation: "ListManagedOrders" | "ListManagedRefunds" | "RefundOrder" | "RefreshRefund",
) {
  const permission =
    operation === "RefundOrder" || operation === "RefreshRefund" ? Permission.PAYMENT_REFUND : Permission.PAYMENT_READ;
  if (
    request.oauthAccessToken ||
    !(await authorizeLegacyPermissions(request, [permission], false, {
      action: "quyan:payment:" + operation,
      resourceKind: "single-resource",
      resource: paymentManagementResource,
    }))
  )
    throw iamAccountDenied();
}
