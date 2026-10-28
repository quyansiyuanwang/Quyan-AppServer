import { CONFIG_KEYS } from "@/constant/config-keys";
import { platformConfigurationArn } from "./platform-configuration-resources";
// Reuse the same resource identity as the general configuration API so Deny covers both paths.
export function platformTicketAssignmentArn() {
  return platformConfigurationArn(CONFIG_KEYS.NOTIFICATION.TICKET_ASSIGNMENT_RULES);
}
