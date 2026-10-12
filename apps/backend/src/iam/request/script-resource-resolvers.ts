import { UserScriptRepository } from "@/store/user-script.repository";
import { isCanonicalScriptId, userScriptArn } from "../resources/script-resources";
import type { ResourceResolver } from "./resource-resolvers";

/** Read ownership metadata only; client account IDs and script bodies are never authorization input. */
export const userScriptResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.id;
  if (!isCanonicalScriptId(id)) return undefined;
  const target = await UserScriptRepository.getInstance().findTarget(
    id,
    principal.subjectUserId,
    principal.accountOwnerId,
  );
  if (!target || target.id !== id || target.userId !== principal.subjectUserId) return undefined;
  return userScriptArn(principal.accountOwnerId, target.userId, target.id);
};
