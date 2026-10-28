import { isDeepStrictEqual as same } from "node:util";
import type { Prisma } from "@prisma/client";
import type { IamPrincipal, IamAuthorizationMode } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestTransportConditionContext } from "@/iam/request/condition-context";
import {
  IamAccountUserRepository,
  assertIamAccountPrincipal,
  iamAccountDenied,
} from "@/store/users/iam-account-principal";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import type {
  UpstreamModelScopeInput,
  UpstreamModelReadGuard,
  UpstreamModelReadScope,
} from "@/store/relay/relay-channel-upstream-model.repository";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import type { TypedRequest } from "@/types/express";
/** Request-local authority shared by single/preview and batch model discovery. No credential values are retained here. */
export async function createUpstreamModelReadAuthority(input: {
  principal: IamPrincipal;
  request: TypedRequest;
  mode: IamAuthorizationMode;
  action: string;
  resources: readonly string[];
  scope: UpstreamModelScopeInput;
}) {
  const { principal, request, mode, action, resources } = input;
  const iam = IamAuthorizationService.getInstance(),
    accounts = IamAccountUserRepository.getInstance();
  const scope: UpstreamModelReadScope =
    input.scope.kind === "platform"
      ? { ...input.scope, group: await platformManagementGroupSnapshot(principal, input.scope.permissions) }
      : input.scope;
  const ids = [...new Set([principal.subjectUserId, principal.accountOwnerId])].sort();
  const users = (await accounts.targets(principal, ids)).sort((a, b) => a.id.localeCompare(b.id));
  if (users.length !== ids.length) throw iamAccountDenied();
  const fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal)),
    keyId = request.accessKey?.id,
    keyRevision = await captureIamAccessKeyRevision(principal, keyId),
    transport = requestTransportConditionContext(request);
  const assertRequest = () => {
    if (
      env.security.iamAuthorizationMode !== mode ||
      !same(getIamPrincipal(request), principal) ||
      request.accessKey?.id !== keyId ||
      request.oauthAccessToken ||
      !same(requestTransportConditionContext(request), transport)
    )
      throw iamAccountDenied();
  };
  const recheck = async (tx?: Prisma.TransactionClient, admittedResources: readonly string[] = resources) => {
    assertRequest();
    await assertIamAccountPrincipal(principal, tx);
    const current = tx
      ? await tx.user.findMany({
          where: { id: { in: ids }, status: 1 },
          select: { id: true, updateTime: true },
          orderBy: { id: "asc" },
        })
      : (await accounts.targets(principal, ids)).sort((a, b) => a.id.localeCompare(b.id));
    if (
      !same(current, users) ||
      (scope.kind === "platform" &&
        !same(await platformManagementGroupSnapshot(principal, scope.permissions, tx), scope.group)) ||
      fingerprintIamPolicies(await iam.loadPolicies(principal)) !== fingerprint ||
      (await captureIamAccessKeyRevision(principal, keyId, tx)) !== keyRevision
    )
      throw iamAccountDenied();
    const decisions = await platformCollectionDecisions(iam, {
      principal,
      action,
      request,
      resources: admittedResources,
    });
    if (decisions.length !== admittedResources.length || decisions.some((decision) => decision !== "Allow"))
      throw iamAccountDenied();
    assertRequest();
  };
  await recheck();
  const guard: UpstreamModelReadGuard = { principal, users, scope, recheck };
  return { guard, recheck };
}
