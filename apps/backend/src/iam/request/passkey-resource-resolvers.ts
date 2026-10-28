import type { ResourceResolver } from "./resource-resolvers";
import { PasskeyManagementRepository } from "@/store/auth/passkey-management.repository";
import {
  isCanonicalPasskeyCredentialId,
  isCanonicalPasskeyResourceId,
  passkeyArn,
} from "../resources/passkey-resources";
/** Public path contains a WebAuthn ID; authorization uses the actual, account-scoped record ID. */
export const passkeyResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const credentialId = request.params.credentialId;
  if (!isCanonicalPasskeyCredentialId(credentialId) || !isCanonicalPasskeyResourceId(principal.subjectUserId))
    return undefined;
  const target = await PasskeyManagementRepository.getInstance().target(principal, credentialId);
  if (!target || target.userId !== principal.subjectUserId || !isCanonicalPasskeyResourceId(target.id))
    return undefined;
  return passkeyArn(principal.accountOwnerId, principal.subjectUserId, target.id);
};
