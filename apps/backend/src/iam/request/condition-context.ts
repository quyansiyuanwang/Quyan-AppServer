import { isIP } from "node:net";
import type { IamConditionContext, IamPrincipal } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { extractClientIp } from "@/util/ip-extractor";
export function principalConditionContext(principal: IamPrincipal, now = new Date()): IamConditionContext {
  return {
    "quyan:PrincipalId": principal.principalUserId,
    "quyan:PrincipalAccount": principal.accountOwnerId,
    "quyan:PrincipalType": principal.subjectType,
    "acs:CurrentTime": now.toISOString(),
    "quyan:EpochTime": now.getTime() / 1000,
  };
}
/** Express resolves proxy headers within its configured trust boundary; body/query conditions are never read. */
export function requestConditionContext(request: TypedRequest, principal: IamPrincipal): IamConditionContext {
  const context = principalConditionContext(principal);
  const ip = request.socket ? extractClientIp(request) : request.ip;
  if (ip && isIP(ip)) context["acs:SourceIp"] = ip;
  context["acs:SecureTransport"] = request.secure === true;
  const userAgent = request.headers?.["user-agent"];
  if (
    typeof userAgent === "string" &&
    userAgent.length <= 512 &&
    [...userAgent].every((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127)
  )
    context["acs:UserAgent"] = userAgent;
  return context;
}
