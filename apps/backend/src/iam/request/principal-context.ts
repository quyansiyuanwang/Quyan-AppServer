import type { IamPrincipal } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
/** Only consume authentication-enriched context, never headers or request body. */
export function getIamPrincipal(request: TypedRequest): IamPrincipal | undefined {
  const user = request.user,
    context = request.authContext;
  if (!user?.userId || !context?.principalUserId || !context.accountOwnerId) return undefined;
  const roleSessionId = context.roleSessionId;
  const subjectType = roleSessionId
    ? "assumed_role"
    : context.subjectType === "access_key"
      ? "access_key"
      : context.subjectType === "service"
        ? "service"
        : context.principalUserId === context.accountOwnerId
          ? "root"
          : "sub_user";
  return {
    subjectUserId: user.userId,
    principalUserId: context.principalUserId,
    accountOwnerId: context.accountOwnerId,
    subjectType,
    assumedRoleId: context.assumedRoleId,
    roleSessionId,
  };
}
