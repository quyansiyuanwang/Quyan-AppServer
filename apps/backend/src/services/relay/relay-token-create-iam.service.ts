import { RelayTokenCopyRepository, type RelayTokenCopySource } from "@/store/relay/relay-token-copy.repository";
import { RelayTokenCreationReservation } from "@/store/relay/relay-token-creation-reservation";
import type { RelayTokenCreateInput } from "@/store/relay/relay-token.store";
import { createId } from "@paralleldrive/cuid2";
import type { Prisma } from "@prisma/client";
import { Permission, buildAcsResource, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
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
import type { CreateRelayTokenDto, ImportRelayTokensRequest, RelayTokenImportItemDto } from "@/api/dto/relay/relay.dto";
import {
  createRelayTokenBodySchema,
  importRelayTokensBodySchema,
  batchDuplicateRelayTokensBodySchema,
  duplicateRelayTokenBodySchema,
} from "@/api/schema/relay/relay.schema";
import { prepareRelayTokenCreate } from "./relay-token-create-preparation";
import {
  RelayTokenConfigurationAdmissionService,
  type RelayTokenConfigurationInvocation,
} from "./relay-token-configuration-admission.service";
export interface RelayTokenCreateInvocation extends RelayTokenConfigurationInvocation {
  data: CreateRelayTokenDto;
  generatedCredential: () => string;
}
export interface RelayTokenImportInvocation extends RelayTokenConfigurationInvocation {
  data: ImportRelayTokensRequest;
  generatedCredential: () => string;
}
export interface RelayTokenDuplicateInvocation extends RelayTokenConfigurationInvocation {
  data: { ids: string[]; targetUserId?: string; name?: string | null };
  single: boolean;
  configuration: (source: RelayTokenCopySource) => RelayTokenImportItemDto;
  generatedCredential: () => string;
}
interface RelayTokenBatchCreateInvocation extends RelayTokenConfigurationInvocation {
  items: RelayTokenImportItemDto[];
  copy?: {
    sourceIds: string[];
    single: boolean;
    name?: string | null;
    configuration: (source: RelayTokenCopySource) => RelayTokenImportItemDto;
  };
  targetUserId?: string;
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
    const result = await this.execute(
      "create",
      actorUserId,
      request,
      { ...invocation, items: [data], targetUserId: data.targetUserId },
      project,
      async () => [await legacy()],
    );
    return result[0]!;
  }
  async importTokens<T>(
    actorUserId: string,
    request: TypedRequest | undefined,
    invocation: RelayTokenImportInvocation,
    project: (record: RelayTokenReadRecord) => Promise<T>,
    legacy: () => Promise<T[]>,
  ): Promise<T[]> {
    const data = structuredClone(invocation.data);
    if (
      !importRelayTokensBodySchema.safeParse(data).success ||
      (data.targetUserId !== undefined && !isRelayTokenResourceId(data.targetUserId))
    )
      throw new BadRequestError("Invalid token import request", undefined, { messageKey: "errors.badRequest" });
    return this.execute(
      "import",
      actorUserId,
      request,
      { ...invocation, items: data.tokens, targetUserId: data.targetUserId },
      project,
      legacy,
    );
  }
  async duplicateTokens<T>(
    actorUserId: string,
    request: TypedRequest | undefined,
    invocation: RelayTokenDuplicateInvocation,
    project: (record: RelayTokenReadRecord) => Promise<T>,
    legacy: () => Promise<T[]>,
  ): Promise<T[]> {
    const data = structuredClone(invocation.data);
    if (
      !batchDuplicateRelayTokensBodySchema.safeParse(data).success ||
      data.ids.some((id) => !isRelayTokenResourceId(id)) ||
      (data.targetUserId !== undefined && !isRelayTokenResourceId(data.targetUserId)) ||
      (invocation.single &&
        (data.ids.length !== 1 ||
          !duplicateRelayTokenBodySchema.safeParse({ name: data.name, targetUserId: data.targetUserId }).success)) ||
      (!invocation.single && data.name !== undefined)
    )
      throw new BadRequestError("Invalid token duplication request", undefined, { messageKey: "errors.badRequest" });
    return this.execute(
      "duplicate",
      actorUserId,
      request,
      {
        ...invocation,
        items: data.ids.map(() => ({})),
        targetUserId: data.targetUserId,
        copy: {
          sourceIds: data.ids,
          single: invocation.single,
          name: data.name,
          configuration: invocation.configuration,
        },
      },
      project,
      legacy,
    );
  }
  private async execute<T>(
    operation: "create" | "import" | "duplicate",
    actorUserId: string,
    request: TypedRequest | undefined,
    invocation: RelayTokenBatchCreateInvocation,
    project: (record: RelayTokenReadRecord) => Promise<T>,
    legacy: () => Promise<T[]>,
  ): Promise<T[]> {
    const items = structuredClone(invocation.items),
      targetUserId = invocation.targetUserId,
      copy = invocation.copy ? { ...invocation.copy, sourceIds: [...invocation.copy.sourceIds] } : undefined;
    const endpointAction =
      operation === "import"
        ? "quyan:relay:ImportTokens"
        : operation === "duplicate"
          ? "quyan:relay:DuplicateToken"
          : action;
    const endpointManagedAction =
      operation === "import"
        ? "quyan:relay:ImportManagedTokens"
        : operation === "duplicate"
          ? "quyan:relay:DuplicateManagedToken"
          : managedAction;
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
    const ids = items.map(() => this.allocateId());
    if (ids.some((id) => !isRelayTokenResourceId(id)) || new Set(ids).size !== ids.length) throw iamAccountDenied();
    const native = async (persist: boolean) => {
      await this.iam.loadPolicies(principal);
      const userId =
          targetUserId ??
          (copy?.single ? await RelayTokenCopyRepository.getInstance().owner(copy.sourceIds[0]!) : actorUserId),
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
      const verifyResponses: ((tx: Prisma.TransactionClient) => Promise<void>)[] = [];
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
        if (tx) for (const verifyResponse of verifyResponses) await verifyResponse(tx);
        assertRequest();
      };
      const resource = (id: string) =>
        identity.managed ? platformRelayTokenArn(userId, id) : relayTokenArn(principal.accountOwnerId, userId, id);
      const resources = ids.map(resource),
        sourceResources = copy?.sourceIds.map(resource) ?? [];
      const control = buildAcsResource({
        service: "quyan",
        region: "*",
        accountId: principal.accountOwnerId,
        path: "user/" + actorUserId,
      });
      const readAction = identity.managed ? "quyan:relay:GetManagedToken" : "quyan:relay:GetToken";
      const revealAction = identity.managed ? "quyan:relay:RevealManagedToken" : "quyan:relay:RevealToken";
      const evaluations = new Map<string, Map<string, string>>();
      const decide = async (operation: string, resources: readonly string[]) => {
        const decisions = await platformCollectionDecisions(this.iam, {
          principal,
          action: operation,
          request,
          resources,
        });
        const previous = evaluations.get(operation) ?? new Map<string, string>();
        for (const [index, resource] of resources.entries()) {
          const decision = decisions[index]!;
          if (previous.has(resource) && previous.get(resource) !== decision) throw iamAccountDenied();
          previous.set(resource, decision);
        }
        evaluations.set(operation, previous);
        return decisions;
      };
      const requireAllow = async (operation: string, resources: readonly string[]) => {
        if ((await decide(operation, resources)).some((decision) => decision !== "Allow")) throw iamAccountDenied();
      };
      const authorize = async () => {
        await requireAllow(endpointAction, [control]);
        if (operation !== "create") await requireAllow(action, [control]);
        if (identity.managed) {
          await requireAllow(endpointManagedAction, [platformUserArn(userId)]);
          if (operation !== "create") await requireAllow(managedAction, [platformUserArn(userId)]);
          await requireAllow("quyan:relay:GetToken", [control]);
          await requireAllow(readAction, [platformUserArn(userId)]);
        }
        if (copy) {
          await requireAllow(identity.managed ? endpointManagedAction : endpointAction, sourceResources);
          await requireAllow(readAction, sourceResources);
        }
        await requireAllow(
          identity.managed ? (copy ? managedAction : endpointManagedAction) : copy ? action : endpointAction,
          resources,
        );
        if (operation === "import") await requireAllow(identity.managed ? managedAction : action, resources);
        await requireAllow(readAction, resources);
        // Re-evaluate every observed decision, grouping by action rather than replaying each
        // one-item response query. Bound each call by the shared evaluator request limit.
        for (const [operation, decisions] of [...evaluations.entries()]) {
          const targets = [...decisions.keys()];
          for (let offset = 0; offset < targets.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
            await decide(operation, targets.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest));
        }
      };
      await recheck();
      await authorize();
      const canReveal = await decide(revealAction, resources);
      const reservation = new RelayTokenCreationReservation();
      const admissions = ids.map((id) =>
        this.admissions.plan(identity, id, false, invocation, requireAllow, decide, reservation),
      );
      const apply = () =>
        this.repository.apply({
          ids,
          identity,
          snapshot,
          persist,
          recheck,
          authorize,
          prepare: async (tx) => {
            const entries: RelayTokenCreateInput[] = [];
            const verifyEntries: ((persisted: boolean) => Promise<void>)[] = [];
            let plannedItems = items;
            if (copy) {
              await requireAllow(identity.managed ? endpointManagedAction : endpointAction, sourceResources);
              await requireAllow(readAction, sourceResources);
              const copies = RelayTokenCopyRepository.getInstance();
              await copies.lock(tx, userId, copy.sourceIds);
              // Lock acquisition may wait; do not hydrate source configuration with pre-wait authority.
              await recheck(tx);
              await authorize();
              const sources = await copies.sources(tx, userId, copy.sourceIds);
              const expected = JSON.stringify(sources);
              verifyEntries.push(async () => {
                if (JSON.stringify(await copies.sources(tx, userId, copy.sourceIds)) !== expected)
                  throw iamAccountDenied();
              });
              plannedItems = [];
              for (const source of sources) {
                const projected = copy.configuration(source);
                const override = copy.single ? copy.name?.trim() : undefined;
                const name = override || (await reservation.name(tx, userId, source.name, true));
                // Copy is configuration-only: source credentials/custom status are never inputs.
                plannedItems.push({ ...projected, name, targetUserId: undefined, token: undefined, enabled: true });
              }
            }
            for (const [index, item] of plannedItems.entries()) {
              const id = ids[index]!,
                admission = admissions[index]!;
              const name = operation === "import" ? await reservation.name(tx, userId, item.name) : item.name;
              const created = (
                await prepareRelayTokenCreate(
                  userId,
                  { ...item, name },
                  {
                    ...invocation.normalizers,
                    ...admission.preparation(tx, persist),
                    generatedCredential: async () => {
                      const value = await RelayTokenUpdateAdmissionRepository.getInstance().credential(
                        tx,
                        invocation.generatedCredential(),
                        reservation.credentials,
                      );
                      reservation.credentials.add(value.token);
                      return value.token;
                    },
                  },
                )
              ).create;
              if (operation === "import") {
                created.status = item.enabled === false ? 0 : 1;
                const preferred = item.token?.trim();
                created.legacyToken =
                  preferred && admission.retainAlias() && preferred !== created.token ? preferred : null;
              }
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
              entries.push(created);
              verifyEntries.push(async (persisted) => {
                if (persisted) await RelayTokenUpdateAdmissionRepository.getInstance().verifyCreated(tx, expected);
                await admission.verify(tx, persisted);
              });
            }
            return {
              entries,
              verify: async (persisted) => {
                for (const verify of verifyEntries) await verify(persisted);
              },
            };
          },
          response: async (tx) => {
            // Capture response admission together; these transaction-local proofs are re-evaluated
            // by authorize() after ALL projections and again at the final commit boundary.
            // Never memoize unrelated member reads or carry these proofs across transactions.
            const readDecisions = await decide(readAction, resources);
            const revealDecisions = await decide(revealAction, resources);
            const responseProofs = new Map([
              [readAction, new Map(resources.map((resource, index) => [resource, readDecisions[index]!]))],
              [revealAction, new Map(resources.map((resource, index) => [resource, revealDecisions[index]!]))],
            ]);
            const responseDecision = async (operation: string, targets: readonly string[]) => {
              const proof = responseProofs.get(operation);
              return proof && targets.every((target) => proof.has(target))
                ? targets.map((target) => proof.get(target)!)
                : decide(operation, targets);
            };
            const results: T[] = [];
            for (const [index, id] of ids.entries()) {
              const response = await this.responses.read(
                tx,
                identity,
                id,
                responseDecision,
                canReveal[index] === "Allow",
              );
              verifyResponses.push((tx) => this.responses.verify(tx, identity, response.targets));
              results.push(await project(response.record));
            }
            // Recheck the complete batch after projection, including every earlier response target.
            // Per-item full-batch checks would make the supported 200-item import quadratic.
            await recheck(tx);
            await authorize();
            return results;
          },
        });
      return copy || items.some((item) => item.routingMode === "composite")
        ? invocation.withGraphLock(userId, apply)
        : apply();
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
        action: endpointAction,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
