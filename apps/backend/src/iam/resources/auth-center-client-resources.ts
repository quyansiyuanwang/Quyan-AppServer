import { buildAcsResource } from "@quyan/shared";
import { isCanonicalOAuthClientId } from "./oauth-client-resources";
export { isCanonicalOAuthClientId };
export function authCenterClientArn(accountId: string, userId: string, clientId: string) {
  if (![accountId, userId, clientId].every(isCanonicalOAuthClientId))
    throw new Error("Invalid auth center client identity");
  return buildAcsResource({ service: "auth-center", region: "*", accountId, path: `client/${userId}/${clientId}` });
}
