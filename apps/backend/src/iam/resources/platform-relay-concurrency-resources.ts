import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { isRelayConcurrencySubjectId } from "@/util/relay-concurrency-status-projection";
const resource = (path: string) =>
  buildAcsResource({ service: "platform", region: "*", accountId: IAM_PLATFORM_ACCOUNT_ID, path });
export const platformRelayConcurrencyArn = () => resource("relay-concurrency-control/default");
export const platformRelayImageConcurrencyArn = () => resource("relay-concurrency-scope/image");
export function platformRelayUserConcurrencyArn(id: string) {
  if (!isRelayConcurrencySubjectId(id)) throw new Error("Invalid concurrency resource identifier");
  return resource("relay-concurrency-user/" + id);
}
