import { isDeepStrictEqual as same } from "node:util";
import type { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import {
  platformRelayChannelArn,
  platformRelayChannelProviderArn,
} from "@/iam/resources/platform-relay-channel-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { assertIamAccountPrincipal, iamAccountDenied } from "@/store/users/iam-account-principal";
import { platformManagementGroupSnapshot } from "@/store/users/platform-management-principal";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { TypedRequest } from "@/types/express";
/** Immutable identity, deployment ceiling and policy revision for all destinations and references. */
export async function channelCreationAuthority(
  principal: IamPrincipal,
  request: TypedRequest,
  mode: string,
  action: string,
  referenceAction: string,
  ids: readonly string[],
) {
  const iam = IamAuthorizationService.getInstance(),
    snapshots = PlatformManagementReadRepository.getInstance(),
    snapshot = await snapshots.snapshot(principal, Permission.RELAY_CHANNEL_CREATE),
    fingerprint = fingerprintIamPolicies(await iam.loadPolicies(principal)),
    keyId = request.accessKey?.id,
    keyRevision = await captureIamAccessKeyRevision(principal, keyId),
    resources = new Set(ids.map(platformRelayChannelArn)),
    references = new Set<string>();
  const assertRequest = () => {
    if (
      env.security.iamAuthorizationMode !== mode ||
      !same(getIamPrincipal(request), principal) ||
      request.accessKey?.id !== keyId ||
      request.oauthAccessToken
    )
      throw iamAccountDenied();
  };
  const recheck = async (tx?: Prisma.TransactionClient) => {
    assertRequest();
    if (resources.size + references.size > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) throw iamAccountDenied();
    if (tx) {
      await assertIamAccountPrincipal(principal, tx);
      const group = await platformManagementGroupSnapshot(principal, Permission.RELAY_CHANNEL_CREATE, tx),
        users = await tx.user.findMany({
          where: { id: { in: snapshot.users.map((row) => row.id) }, status: 1 },
          select: { id: true, updateTime: true },
          orderBy: { id: "asc" },
        });
      if (
        !same(group, snapshot.group) ||
        !same(
          users,
          [...snapshot.users].sort((a, b) => a.id.localeCompare(b.id)),
        )
      )
        throw iamAccountDenied();
    } else await snapshots.recheck(principal, Permission.RELAY_CHANNEL_CREATE, snapshot);
    if (
      fingerprintIamPolicies(await iam.loadPolicies(principal)) !== fingerprint ||
      (await captureIamAccessKeyRevision(principal, keyId, tx)) !== keyRevision
    )
      throw iamAccountDenied();
    for (const [currentAction, currentResources] of [
      [action, resources],
      [referenceAction, references],
    ] as const) {
      if (!currentResources.size) continue;
      const decisions = await platformCollectionDecisions(iam, {
        principal,
        action: currentAction,
        request,
        resources: [...currentResources],
      });
      if (decisions.length !== currentResources.size || decisions.some((decision) => decision !== "Allow"))
        throw iamAccountDenied();
    }
    assertRequest();
  };

  const admitReferences = async (values: readonly string[]) => {
    for (const id of values) {
      if (!isPlatformLogResourceId(id)) throw iamAccountDenied();
      if (!ids.includes(id)) references.add(platformRelayChannelArn(id));
    }
    await recheck();
  };
  const admitProviders = async (id: string, userIds: readonly string[]) => {
    if (!ids.includes(id)) throw iamAccountDenied();
    for (const userId of userIds) {
      if (!isPlatformLogResourceId(userId)) throw iamAccountDenied();
      resources.add(platformRelayChannelProviderArn(id, userId));
    }
    if (resources.size + references.size > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) throw iamAccountDenied();
    await recheck();
  };
  await recheck();
  return { principal, snapshot, recheck, admitReferences, admitProviders };
}
