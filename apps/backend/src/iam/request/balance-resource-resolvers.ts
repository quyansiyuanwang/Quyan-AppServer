import { BalanceTransferRepository } from "@/store/billing/balance-transfer.repository";
import { balanceGiftCodeArn, isCanonicalBalanceId } from "../resources/balance-resources";
import type { ResourceResolver } from "./resource-resolvers";

/** The lookup excludes foreign accounts and codes created by another user; it never loads the secret code. */
export const balanceGiftCodeResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.id;
  if (!isCanonicalBalanceId(id)) return undefined;
  const target = await BalanceTransferRepository.getInstance().findGiftCodeTarget(
    id,
    principal.subjectUserId,
    principal.accountOwnerId,
  );
  if (!target || target.id !== id || target.createdBy !== principal.subjectUserId) return undefined;
  return balanceGiftCodeArn(principal.accountOwnerId, target.createdBy, target.id);
};
