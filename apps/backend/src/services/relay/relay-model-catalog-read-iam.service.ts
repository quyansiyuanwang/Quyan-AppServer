import { createHash } from "node:crypto";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { relayModelCatalogArn, isRelayModelCatalogId } from "@/iam/resources/relay-model-catalog-resources";
import {
  RelayModelCatalogReadRepository,
  type RelayModelCatalogEntry,
  type RelayModelCatalogTarget,
} from "@/store/relay/relay-model-catalog-read.repository";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { captureIamOAuthRevision } from "@/store/users/iam-oauth-authority";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { PermissionService } from "../users/permission.service";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:ListAvailableModels";
export class RelayModelCatalogReadIamService {
  private static instance: RelayModelCatalogReadIamService;
  static getInstance() {
    return (this.instance ??= new RelayModelCatalogReadIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: Pick<
      RelayModelCatalogReadRepository,
      "snapshot" | "scan" | "hydrate"
    > = RelayModelCatalogReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  async read<T>(
    actorUserId: string | undefined,
    request: TypedRequest | undefined,
    project: (rows: readonly RelayModelCatalogEntry[], principal: IamPrincipal) => Promise<T>,
    legacy: () => Promise<T>,
  ): Promise<T> {
    const mode = env.security.iamAuthorizationMode;
    if (!["legacy", "shadow", "enforce"].includes(mode)) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const identity = getIamPrincipal(request);
    if (!identity || identity.subjectUserId !== actorUserId || identity.principalUserId !== actorUserId)
      throw iamAccountDenied();
    const principal: IamPrincipal = { ...identity };
    if (
      mode !== "enforce" &&
      !(
        await this.permissions.checkUserPermissions(actorUserId, [Permission.RELAY_TOKEN_READ], {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    if (mode === "legacy") return legacy();
    const native = async (hydrate: boolean) => {
      const oauth = request.oauthAccessToken
          ? { id: request.oauthAccessToken.id, clientId: request.oauthAccessToken.oauthClientId }
          : undefined,
        keyId = request.accessKey?.id;
      const assertRequest = () => {
        if (
          JSON.stringify(getIamPrincipal(request)) !== JSON.stringify(principal) ||
          request.accessKey?.id !== keyId ||
          (oauth
            ? request.oauthAccessToken?.id !== oauth.id ||
              request.oauthAccessToken.oauthClientId !== oauth.clientId ||
              request.oauthAccessToken.userId !== actorUserId
            : Boolean(request.oauthAccessToken))
        )
          throw iamAccountDenied();
      };
      assertRequest();
      const snapshot = JSON.stringify(await this.repository.snapshot(principal)),
        fingerprint = fingerprintIamPolicies(await this.iam.loadPolicies(principal)),
        keyRevision = await captureIamAccessKeyRevision(principal, keyId),
        oauthRevision = await captureIamOAuthRevision(principal, oauth, ["relay:channel:read"]);
      const recheck = async () => {
        assertRequest();
        if (
          JSON.stringify(await this.repository.snapshot(principal)) !== snapshot ||
          fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== fingerprint ||
          (await captureIamAccessKeyRevision(principal, keyId)) !== keyRevision ||
          (await captureIamOAuthRevision(principal, oauth, ["relay:channel:read"])) !== oauthRevision
        )
          throw iamAccountDenied();
        assertRequest();
      };
      const decisions = new Map<string, readonly string[]>();
      const collect = async () => {
        const hash = createHash("sha256"),
          allowed: RelayModelCatalogTarget[] = [];
        let after: string | undefined;
        for (;;) {
          await recheck();
          const rows = await this.repository.scan(after);
          if (
            rows.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
            rows.some(
              (row, i) =>
                !isRelayModelCatalogId(row.id) ||
                row.status !== 1 ||
                (i ? rows[i - 1]!.id >= row.id : after !== undefined && after >= row.id),
            )
          )
            throw iamAccountDenied();
          if (!rows.length) break;
          const outcomes = await platformCollectionDecisions(this.iam, {
            principal,
            request,
            action,
            resources: rows.map((row) => relayModelCatalogArn(principal.accountOwnerId, row.id)),
          });
          const key = JSON.stringify(rows.map((row) => row.id)),
            previous = decisions.get(key);
          if (previous && outcomes.some((value, i) => value !== previous[i])) throw iamAccountDenied();
          decisions.set(key, outcomes);
          rows.forEach((row, i) => {
            hash.update(JSON.stringify([row, outcomes[i]]) + "\n");
            if (outcomes[i] === "Allow") allowed.push(row);
          });
          after = rows.at(-1)!.id;
          if (rows.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
        }
        await recheck();
        return { hash: hash.digest("hex"), allowed };
      };
      const initial = await collect();
      if (!hydrate) return undefined;
      const entries: RelayModelCatalogEntry[] = [];
      for (let i = 0; i < initial.allowed.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
        await recheck();
        entries.push(
          ...(await this.repository.hydrate(
            initial.allowed.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
          )),
        );
      }
      entries.sort((a, b) => a.model.localeCompare(b.model) || a.id.localeCompare(b.id));
      const result = await project(entries, { ...principal });
      const final = await collect();
      if (final.hash !== initial.hash) throw iamAccountDenied();
      for (let i = 0; i < initial.allowed.length; i += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
        const targets = initial.allowed.slice(i, i + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
          rows = await this.repository.hydrate(targets);
        if (rows.some((row) => JSON.stringify(row) !== JSON.stringify(entries.find((entry) => entry.id === row.id))))
          throw iamAccountDenied();
      }
      await recheck();
      return result;
    };
    if (mode === "enforce") {
      const result = await native(true);
      if (result === undefined) throw iamAccountDenied();
      return result;
    }
    try {
      await native(false);
    } catch {
      getLogger("RelayModelCatalogIam", LogCategory.SECURITY).warn("Relay model catalog shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
}
