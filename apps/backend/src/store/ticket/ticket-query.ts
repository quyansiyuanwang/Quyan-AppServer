import type { Prisma } from "@prisma/client";
import { MANAGED_STATUS } from "@/constant/status";
import type { TicketListFilters } from "./ticket.store";
export function buildTicketWhere(
  filters: Omit<TicketListFilters, "page" | "pageSize"> & { userId?: string },
): Prisma.TicketWhereInput {
  const keyword = filters.keyword?.trim();
  const orConditions: Prisma.TicketWhereInput[] = [];
  if (keyword)
    orConditions.push(
      { id: { contains: keyword } },
      { title: { contains: keyword } },
      { description: { contains: keyword } },
      { user: { username: { contains: keyword } } },
    );

  return {
    status: MANAGED_STATUS.ENABLED,
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.workflowStatus ? { workflowStatus: filters.workflowStatus } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.assigneeUserId ? { assigneeUserId: filters.assigneeUserId } : {}),
    ...(filters.startTime || filters.endTime
      ? {
          createTime: {
            ...(filters.startTime ? { gte: filters.startTime } : {}),
            ...(filters.endTime ? { lte: filters.endTime } : {}),
          },
        }
      : {}),
    ...(orConditions.length > 0 ? { OR: orConditions } : {}),
  };
}
