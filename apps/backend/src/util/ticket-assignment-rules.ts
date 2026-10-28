import { setTicketAssignmentConfigBodySchema } from "@/api/schema/ticket/ticket.schema";
import type { SetTicketReviewAssignmentConfigDto } from "@/api/dto/ticket/ticket.dto";
import { BadRequestError } from "./errors";
export function normalizeTicketAssignmentRules(input: SetTicketReviewAssignmentConfigDto) {
  const parsed = setTicketAssignmentConfigBodySchema.safeParse(input);
  if (!parsed.success)
    throw new BadRequestError("Invalid ticket assignment rules", undefined, { messageKey: "errors.badRequest" });
  return { rules: parsed.data.rules.map((rule) => ({ ...rule, assigneeUserIds: [...new Set(rule.assigneeUserIds)] })) };
}
