import { domainToASCII } from "node:url";
import { buildAcsResource } from "@quyan/shared";
import type { IamPrincipal } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
export interface ResourceResolverContext {
  request: TypedRequest<unknown>;
  principal: IamPrincipal;
}
export type ResourceResolver = (context: ResourceResolverContext) => string | undefined | Promise<string | undefined>;
export const ramAccountResourceResolver: ResourceResolver = ({ principal }) =>
  buildAcsResource({ service: "quyan", region: "*", accountId: principal.accountOwnerId, path: "account" });
export function normalizeDomainName(input: unknown): string | undefined {
  if (
    typeof input !== "string" ||
    !input ||
    /[\s@:/\\%?#*[\]]/u.test(input) ||
    [...input].some((char) => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127)
  )
    return undefined;
  const domain = domainToASCII(input.replace(/\.$/, "").toLowerCase());
  if (!domain || domain.length > 253) return undefined;
  const labels = domain.split(".");
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return undefined;
  return domain;
}
export function domainResourceResolver(readDomain: (request: TypedRequest<unknown>) => unknown): ResourceResolver {
  return ({ request, principal }) => {
    const domain = normalizeDomainName(readDomain(request));
    if (!domain) return undefined;
    return buildAcsResource({
      service: "alidns",
      region: "*",
      accountId: principal.accountOwnerId,
      path: "domain/" + domain,
    });
  };
}
/** Resolver factories require already-validated, server-owned identifiers. Ownership checks remain in services. */
export function accountEntityResourceResolver(
  kind: "user" | "group" | "role" | "relay-channel",
  readId: (request: TypedRequest<unknown>) => unknown,
): ResourceResolver {
  return ({ request, principal }) => {
    const id = readId(request);
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return undefined;
    return buildAcsResource({
      service: "quyan",
      region: "*",
      accountId: principal.accountOwnerId,
      path: kind + "/" + id,
    });
  };
}
