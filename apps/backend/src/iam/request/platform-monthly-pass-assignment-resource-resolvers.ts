import type { ResourceResolver } from "./resource-resolvers";
import { MonthlyPassRepository } from "@/store/billing/monthly-pass.repository";
import { isPlatformLogResourceId } from "../resources/platform-log-resources";
import { platformMonthlyPassArn } from "../resources/platform-monthly-pass-resources";
export const platformMonthlyPassAssignmentResource: ResourceResolver = async ({ request }) => {
  const id = request.params.id;
  if (!isPlatformLogResourceId(id)) return undefined;
  const record = await MonthlyPassRepository.getInstance().findUserPassIdentity(id!);
  return record && record.id === id && [0, 1].includes(record.status) && isPlatformLogResourceId(record.userId)
    ? platformMonthlyPassArn(record.userId, record.id)
    : undefined;
};
