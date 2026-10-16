import { createId } from "@paralleldrive/cuid2";
import type { Prisma } from "@prisma/client";
import { Permission, buildAcsResource, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { relayTokenArn, platformRelayTokenArn, isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { platformCollectionDecisions } from "@/services/system/platform-collection-decisions";
import { RelayTokenUpdateAdmissionRepository } from "@/store/relay/relay-token-update-admission.repository";
import { RelayTokenCreateMutationRepository } from "@/store/relay/relay-token-create-mutation.repository";
import { RelayTokenMutationResponseRepository } from "@/store/relay/relay-token-mutation-response.repository";
import {
  captureRelayTokenAuthority,
  RELAY_TOKEN_AUTHORITY_REQUIREMENTS,
  type RelayTokenAuthorityIdentity,
} from "@/store/relay/relay-token-authority";
import type { RelayTokenReadRecord } from "@/store/relay/relay-token-read.repository";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { BadRequestError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { CreateRelayTokenDto } from "@/api/dto/relay/relay.dto";
import { createRelayTokenBodySchema } from "@/api/schema/relay/relay.schema";
import { prepareRelayTokenCreate } from "./relay-token-create-preparation";
import {
  RelayTokenConfigurationAdmissionService,
  type RelayTokenConfigurationInvocation,
} from "./relay-token-configuration-admission.service";
export interface RelayTokenCreateInvocation extends RelayTokenConfigurationInvocation {
  data: CreateRelayTokenDto;
  generatedCredential: () => string;
}
const action = "quyan:relay:CreateToken",
  managedAction = "quyan:relay:CreateManagedToken";
/** IDs and operations are server-owned; creation never grants permission to reveal credentials. */
export class RelayTokenCreateIamService {
  private static instance: RelayTokenCreateIamService;
  static getInstance() {
    return (this.instance ??= new RelayTokenCreateIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository = RelayTokenCreateMutationRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly responses = RelayTokenMutationResponseRepository.getInstance(),
    private readonly admissions = RelayTokenConfigurationAdmissionService.getInstance(),
    private readonly allocateId: () => string = createId,
  ) {}
  async create<T>(
    actorUserId: string,
    request: TypedRequest | undefined,
    invocation: RelayTokenCreateInvocation,
    project: (record: RelayTokenReadRecord) => Promise<T>,
    legacy: () => Promise<T>,
  ): Promise<T> {
    const data = structuredClone(invocation.data);
    if (
      !createRelayTokenBodySchema.safeParse(data).success ||
      (data.targetUserId !== undefined && !isRelayTokenResourceId(data.targetUserId))
    )
      throw new BadRequestError("Invalid token creation request", undefined, { messageKey: "errors.badRequest" });
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const current = getIamPrincipal(request);
    if (!current || current.subjectUserId !== actorUserId || current.principalUserId !== actorUserId)
      throw iamAccountDenied();
    const principal: IamPrincipal = { ...current };
    if (
      mode !== "enforce" &&
      !(
        await this.permissions.checkUserPermissions(actorUserId, [Permission.RELAY_TOKEN_CREATE], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const id = this.allocateId();
    if (!isRelayTokenResourceId(id)) throw iamAccountDenied();
    const native = async (persist: boolean) => {
      await this.iam.loadPolicies(principal);
      const userId = data.targetUserId ?? actorUserId,
        oauth = request.oauthAccessToken;
      if (oauth && oauth.userId !== actorUserId) throw iamAccountDenied();
      const identity: RelayTokenAuthorityIdentity = {
        principal,
        userId,
        managed: userId !== actorUserId,
        ...(oauth ? { oauth: { id: oauth.id, clientId: oauth.oauthClientId } } : {}),
      };
      const snapshot = await captureRelayTokenAuthority(identity, RELAY_TOKEN_AUTHORITY_REQUIREMENTS.create);
      const readSnapshot = await captureRelayTokenAuthority(identity, RELAY_TOKEN_AUTHORITY_REQUIREMENTS.read);
      const fingerprint = fingerprintIamPolicies(await this.iam.loadPolicies(principal));
      const keyId = request.accessKey?.id,
        keyRevision = await captureIamAccessKeyRevision(principal, keyId);
      const assertRequest = () => {
        if (
          JSON.stringify(getIamPrincipal(request)) !== JSON.stringify(principal) ||
          request.accessKey?.id !== keyId ||
          (identity.oauth
            ? request.oauthAccessToken?.id !== identity.oauth.id ||
              request.oauthAccessToken.oauthClientId !== identity.oauth.clientId ||
              request.oauthAccessToken.userId !== actorUserId
            : Boolean(request.oauthAccessToken))
        )
          throw iamAccountDenied();
      };
      let verifyResponse: ((tx: Prisma.TransactionClient) => Promise<void>) | undefined;
      const recheck = async (tx?: Prisma.TransactionClient) => {
        assertRequest();
        if (
          JSON.stringify(await captureRelayTokenAuthority(identity, RELAY_TOKEN_AUTHORITY_REQUIREMENTS.create, tx)) !==
            JSON.stringify(snapshot) ||
          JSON.stringify(await captureRelayTokenAuthority(identity, RELAY_TOKEN_AUTHORITY_REQUIREMENTS.read, tx)) !==
            JSON.stringify(readSnapshot) ||
          fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId, tx)) !== keyRevision
        )
          throw iamAccountDenied();
        if (tx && verifyResponse) await verifyResponse(tx);
        assertRequest();
      };
      const resource = identity.managed
        ? platformRelayTokenArn(userId, id)
        : relayTokenArn(principal.accountOwnerId, userId, id);
      const control = buildAcsResource({
        service: "quyan",
        region: "*",
        accountId: principal.accountOwnerId,
        path: "user/" + actorUserId,
      });
      const readAction = identity.managed ? "quyan:relay:GetManagedToken" : "quyan:relay:GetToken";
      const revealAction = identity.managed ? "quyan:relay:RevealManagedToken" : "quyan:relay:RevealToken";
      const evaluations = new Map<
        string,
        { action: string; resources: readonly string[]; decisions: readonly string[] }
      >();
      const decide = async (operation: string, resources: readonly string[]) => {
        const decisions = await platformCollectionDecisions(this.iam, {
          principal,
          action: operation,
          request,
          resources,
        });
        const key = JSON.stringify([operation, resources]),
          previous = evaluations.get(key);
        if (previous && decisions.some((value, i) => value !== previous.decisions[i])) throw iamAccountDenied();
        evaluations.set(key, { action: operation, resources, decisions });
        return decisions;
      };
      const requireAllow = async (operation: string, resources: readonly string[]) => {
        if ((await decide(operation, resources)).some((decision) => decision !== "Allow")) throw iamAccountDenied();
      };
      const authorize = async () => {
        await requireAllow(action, [control]);
        if (identity.managed) {
          await requireAllow(managedAction, [platformUserArn(userId)]);
          await requireAllow("quyan:relay:GetToken", [control]);
          await requireAllow(readAction, [platformUserArn(userId)]);
        }
        await requireAllow(identity.managed ? managedAction : action, [resource]);
        await requireAllow(readAction, [resource]);
        for (const entry of [...evaluations.values()]) await decide(entry.action, entry.resources);
      };
      await recheck();
      await authorize();
      const canReveal = (await decide(revealAction, [resource]))[0] === "Allow";
      const admission = this.admissions.plan(identity, id, false, invocation, requireAllow, decide);
      const apply = () =>
        this.repository.apply({
          id,
          identity,
          snapshot,
          persist,
          recheck,
          authorize,
          prepare: async (tx) => {
            const created = (
              await prepareRelayTokenCreate(userId, data, {
                ...invocation.normalizers,
                ...admission.preparation(tx, persist),
                generatedCredential: invocation.generatedCredential,
              })
            ).create;
            const expected = {
              id,
              userId,
              status: created.status ?? 1,
              routingMode: created.routingMode ?? "ordered",
              channelId: created.channelId ?? null,
              isCustomKey: created.isCustomKey ?? false,
              automaticProxyPoolChannelId: created.automaticProxyPoolChannelId ?? null,
              blockedAutomaticProxyPoolChannelIds: created.blockedAutomaticProxyPoolChannelIds ?? null,
              channelConfigs: [...(created.channelConfigs ?? [])].sort((a, b) => a.priority - b.priority),
              memberTokenConfigs: [...(created.memberTokenConfigs ?? [])].sort((a, b) => a.priority - b.priority),
            };
            await admission.routing(tx, expected, {});
            return {
              data: created,
              verify: async (persisted) => {
                if (persisted) await RelayTokenUpdateAdmissionRepository.getInstance().verifyCreated(tx, expected);
                await admission.verify(tx, persisted);
              },
            };
          },
          response: async (tx) => {
            await recheck(tx);
            await authorize();
            const response = await this.responses.read(tx, identity, id, decide, canReveal);
            verifyResponse = (tx) => this.responses.verify(tx, identity, response.targets);
            const result = await project(response.record);
            await recheck(tx);
            await authorize();
            return result;
          },
        });
      return data.routingMode === "composite" ? invocation.withGraphLock(userId, apply) : apply();
    };
    if (mode === "enforce") {
      const result = await native(true);
      if (!Object.hasOwn(result, "response")) throw iamAccountDenied();
      return result.response!;
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayTokenCreateIam", LogCategory.SECURITY).warn("Token creation shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
