import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { isCanonicalOAuthClientId } from "./oauth-client-resources";

export function platformAuthCenterReviewClientArn(id: string) {
  if (!isCanonicalOAuthClientId(id)) throw new Error("Invalid Auth Center application review identity");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "auth-center-review-client/" + id,
  });
}
