import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { isCanonicalOAuthClientId } from "./oauth-client-resources";
export function platformOAuthClientArn(id: string) {
  if (!isCanonicalOAuthClientId(id)) throw new Error("Invalid platform OAuth application identity");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "oauth-client/" + id,
  });
}
