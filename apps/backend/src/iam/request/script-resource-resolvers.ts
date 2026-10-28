import { UserScriptRepository } from "@/store/user-script.repository";
import { isCanonicalScriptId, userScriptArn } from "../resources/script-resources";
import { iamAuthenticatedUserResourceResolver } from "./resource-resolvers";
import type { BatchResourceResolver, ResourceResolver } from "./resource-resolvers";

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

export const userScriptExecutionSaveResourceResolver: BatchResourceResolver = async (context) => {
  const user = await iamAuthenticatedUserResourceResolver(context);
  if (typeof user !== "string") return undefined;
  const id = (context.request.body as { scriptId?: unknown })?.scriptId;
  if (id === undefined) return [user];
  if (!isCanonicalScriptId(id)) return undefined;
  const target = await UserScriptRepository.getInstance().findTarget(
    id,
    context.principal.subjectUserId,
    context.principal.accountOwnerId,
  );
  if (!target || target.id !== id || target.userId !== context.principal.subjectUserId) return undefined;
  return [user, userScriptArn(context.principal.accountOwnerId, target.userId, target.id)];
};
