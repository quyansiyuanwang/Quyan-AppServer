import { buildAcsResource } from "@quyan/shared";
import { isPlatformLogResourceId } from "./platform-log-resources";
function resource(accountOwnerId: string, type: string, ids: readonly string[]) {
  if (ids.some((id) => !isPlatformLogResourceId(id))) throw new Error("Invalid monthly pass resource identity");
  return buildAcsResource({
    service: "monthly-pass",
    region: "*",
    accountId: accountOwnerId,
    path: type + "/" + ids.join("/"),
  });
}
export const monthlyPassAssignmentArn = (owner: string, userId: string, id: string) =>
  resource(owner, "assignment", [userId, id]);
export const monthlyPassTemplateArn = (owner: string, userId: string, id: string) =>
  resource(owner, "template", [userId, id]);
export const monthlyPassUsageArn = (owner: string, userId: string, passId: string, id: string) =>
  resource(owner, "usage", [userId, passId, id]);
