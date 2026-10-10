import type { Response, NextFunction } from "express";
import type { TypedRequest } from "@/types/express";
import { getIamPrincipal } from "./principal-context";
import { isCanonicalAccessKeyId } from "../resources/accesskey-resources";
import {
  AccessKeyManagementRepository,
  accessKeyAuthorizationDenied,
  type AccessKeyIssuanceState,
} from "@/store/users/accesskey-management.repository";

// Not a request/header/body field: clients cannot forge completion of the step-up chain.
const contexts = new WeakMap<TypedRequest, { state: AccessKeyIssuanceState; ready: boolean }>();
export function accessKeyIssuanceSnapshotMiddleware(repository = AccessKeyManagementRepository.getInstance()) {
  return async (req: TypedRequest, _res: Response, next: NextFunction) => {
    try {
      const request = req as TypedRequest,
        principal = getIamPrincipal(request),
        oauth = request.oauthAccessToken;
      if (
        !principal ||
        !isCanonicalAccessKeyId(principal.subjectUserId) ||
        principal.subjectUserId !== principal.principalUserId ||
        (oauth &&
          (oauth.userId !== principal.subjectUserId ||
            !oauth.scopes.includes("accesskey") ||
            !Number.isFinite(Date.parse(oauth.expiresAt)) ||
            Date.parse(oauth.expiresAt) <= Date.now()))
      )
        throw accessKeyAuthorizationDenied();
      const state = await repository.captureIssuance(
        principal,
        oauth ? { id: oauth.id, clientId: oauth.oauthClientId } : undefined,
      );
      Object.freeze(state.principal);
      Object.freeze(state.snapshot);
      if (state.oauth) Object.freeze(state.oauth);
      Object.freeze(state);
      contexts.set(request, { state, ready: false });
      next();
    } catch (error) {
      next(error);
    }
  };
}
/** Must follow the existing two-factor challenge, replay and input-validation guards. */
export const accessKeyIssuanceReadyMiddleware = (req: TypedRequest, _res: Response, next: NextFunction) => {
  const context = contexts.get(req as TypedRequest);
  if (!context) return next(accessKeyAuthorizationDenied());
  context.ready = true;
  next();
};
export function getAccessKeyIssuanceState(request: TypedRequest): AccessKeyIssuanceState {
  const context = contexts.get(request),
    current = getIamPrincipal(request),
    oauth = request.oauthAccessToken;
  if (
    !context?.ready ||
    !current ||
    !["subjectUserId", "principalUserId", "accountOwnerId", "subjectType", "assumedRoleId", "roleSessionId"].every(
      (key) => current[key as keyof typeof current] === context.state.principal[key as keyof typeof current],
    ) ||
    (context.state.oauth
      ? !oauth ||
        oauth.id !== context.state.oauth.id ||
        oauth.oauthClientId !== context.state.oauth.clientId ||
        oauth.userId !== current.subjectUserId ||
        !oauth.scopes.includes("accesskey")
      : !!oauth)
  )
    throw accessKeyAuthorizationDenied();
  return context.state;
}
