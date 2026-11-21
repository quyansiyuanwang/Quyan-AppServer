import { Decimal } from "@prisma/client/runtime/library";
import { BALANCE_MANAGEMENT_POLICY } from "@quyan/shared";
import type { AdjustBalanceAccountRequest, BalanceAdjustmentResultDto } from "@/api/dto/billing/balance-management.dto";
import { BadRequestError, ConflictError } from "@/util/errors";

/** Shared by the server-side trial and the locked account mutation. */
export function calculateAccountAdjustment(
  before: BalanceAdjustmentResultDto["before"],
  body: AdjustBalanceAccountRequest,
) {
  const after = { ...before };
  for (const field of ["balance", "totalRecharged", "totalUsed"] as const) {
    const change = body[field];
    if (!change) continue;
    if (change.mode === "set" && (change.expected === undefined || !new Decimal(before[field]).equals(change.expected)))
      throw new ConflictError("Account changed", undefined, { messageKey: "billing.accountChanged" });
    const value = change.mode === "set" ? new Decimal(change.value) : new Decimal(before[field]).plus(change.value);
    if (
      !value.isFinite() ||
      value.abs().gt(BALANCE_MANAGEMENT_POLICY.maximumAmount) ||
      (field !== "balance" && value.lt(0))
    )
      throw new BadRequestError("Invalid adjustment result", undefined, { messageKey: "billing.invalidAdjustment" });
    after[field] = value.toNumber();
  }
  return after;
}
