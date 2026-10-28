import {
  Permission,
  CustomCode,
  IAM_ACTION_DEFINITIONS,
  getIamResourcePatternTypes,
  matchIamPattern,
} from "@quyan/shared";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { isPlatformUserId, platformUserArn, platformUserGroupArn } from "@/iam/resources/platform-user-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { checkIamDelegation } from "@/iam/delegation/delegation-check";
import { projectScopedPolicyForDelegation } from "@/iam/delegation/scoped-policy";
import { updateUserBodySchema } from "@/api/schema/users/user.schema";
import { PlatformResourceReadIamService } from "@/services/system/platform-resource-read-iam.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformUserUpdateRepository } from "@/store/users/platform-user-update.repository";
import type {
  PlatformUserUpdateStore,
  PlatformUserUpdateGuard,
  PlatformUserUpdateTarget,
  PlatformUserUpdateGroup,
} from "@/store/users/platform-user-update.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { BadRequestError, ForbiddenError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
import type { IamPrincipal } from "@quyan/shared";
const action = "quyan:user:UpdateUser",
  permission = Permission.USER_UPDATE;
const recoveryServices = new Set(["ram", "group", "permission"]);
export class PlatformUserUpdateIamService {
  private static instance: PlatformUserUpdateIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany" | "loadGroupPolicies" | "loadDelegatablePolicies"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformUserUpdateStore = PlatformUserUpdateRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformUserUpdateIamService());
  }
  private async groupProof(
    principal: IamPrincipal,
    target: PlatformUserUpdateTarget,
    destination: PlatformUserUpdateGroup,
  ) {
    const load = () => this.iam.loadGroupPolicies(target.accountOwnerId, destination.id, { allowGlobalManaged: true });
    const candidates = await load(),
      hash = fingerprintIamPolicies(candidates);
    const old = async () =>
      this.iam.loadGroupPolicies(target.accountOwnerId, target.group.id, { allowGlobalManaged: true });
    const accountOwnerTarget = target.accountOwnerId === target.resource.id;
    const previous = target.recoveryBootstrap && !accountOwnerTarget ? [] : await old(),
      previousHash = fingerprintIamPolicies(previous);
    const prove = async () => {
      if (accountOwnerTarget) {
        // Group replacement must preserve the owner's existing IAM recovery authority, even for a bootstrap actor.
        if (candidates.some((policy) => policy.document.Statement.some((statement) => statement.Effect === "Deny")))
          throw iamAccountDenied();
        const next = candidates.flatMap((policy) => {
          // Available recovery grants need a proven lower bound; required old authority uses an upper bound below.
          const projected = projectScopedPolicyForDelegation(policy);
          return projected ? [projected] : [];
        });
        for (const policy of previous) {
          const projected = projectScopedPolicyForDelegation(policy, { purpose: "candidate" });
          for (const statement of projected?.Statement ?? []) {
            if (statement.Effect !== "Allow") continue;
            for (const definition of IAM_ACTION_DEFINITIONS) {
              if (
                !recoveryServices.has(definition.service) ||
                !statement.Action.some((pattern) => matchIamPattern(pattern, definition.action))
              )
                continue;
              const resources = statement.Resource.filter((pattern) =>
                getIamResourcePatternTypes(pattern).some((type) => definition.resourceTypes.includes(type.id)),
              );
              if (
                resources.length &&
                !checkIamDelegation(
                  { Version: "1", Statement: [{ ...statement, Action: [definition.action], Resource: resources }] },
                  next,
                ).allowed
              )
                throw iamAccountDenied();
            }
          }
        }
      }
      const actorGrants = await this.iam.loadDelegatablePolicies(principal);
      if (target.recoveryBootstrap) {
        // The configured root recovery exception supplies Allow coverage, never an escape from the actor's Denies.
        const denies = actorGrants.flatMap((document) => {
          const statements = document.Statement.filter((statement) => statement.Effect === "Deny");
          return statements.length ? [{ Version: "1" as const, Statement: statements }] : [];
        });
        if (!denies.length) return;
        const bootstrapGrants = [
          { Version: "1" as const, Statement: [{ Effect: "Allow" as const, Action: ["*"], Resource: ["*"] }] },
          ...denies,
        ];
        for (const candidate of candidates) {
          const projected = projectScopedPolicyForDelegation(candidate, { purpose: "candidate" });
          if (projected && !checkIamDelegation(projected, bootstrapGrants).allowed) throw iamAccountDenied();
        }
        return;
      }
      // Removing a group/role Deny could uncover unrelated direct grants. Decline that unproven expansion.
      if (previous.some((p) => p.document.Statement.some((s) => s.Effect === "Deny"))) throw iamAccountDenied();
      const grants = actorGrants;
      for (const candidate of candidates) {
        const projected = projectScopedPolicyForDelegation(candidate, { purpose: "candidate" });
        if (projected && !checkIamDelegation(projected, grants).allowed) throw iamAccountDenied();
      }
    };
    await prove();
    return async () => {
      if (
        fingerprintIamPolicies(await load()) !== hash ||
        ((!target.recoveryBootstrap || accountOwnerTarget) && fingerprintIamPolicies(await old()) !== previousHash)
      )
        throw iamAccountDenied();
      await prove();
    };
  }
  async execute(id: string, input: unknown, actorId: string, request?: TypedRequest, persist = true) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      !isPlatformUserId(id) ||
      principal.subjectUserId !== actorId ||
      principal.principalUserId !== actorId ||
      request.oauthAccessToken
    )
      throw iamAccountDenied();
    if (request.user?.impersonatorId && request.user.impersonationMode === "view")
      throw new ForbiddenError(
        "Read-only impersonation cannot update users",
        CustomCode.IMPERSONATION_READONLY_VIOLATION,
        {
          messageKey: "errors.impersonationReadonlyViolation",
        },
      );
    const parsed = updateUserBodySchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid user update", undefined, { messageKey: "errors.badRequest" });
    const identity = { ...principal },
      data = parsed.data,
      target = await this.repository.target(identity, id);
    if (target.resource.id !== id) throw iamAccountDenied();
    const destination =
      data.groupId !== undefined ? await this.repository.destination(identity, target, data.groupId) : undefined;
    const changesGroup = destination && destination.id !== target.group.id;
    if (
      (id === actorId || id === identity.accountOwnerId) &&
      (changesGroup || (data.email !== undefined && data.email !== target.email) || data.status === 0)
    )
      throw iamAccountDenied();
    const proof = changesGroup ? await this.groupProof(identity, target, destination) : async () => {};
    const reader = new PlatformResourceReadIamService(this.iam, this.snapshots);
    const additional: (() => Promise<void>)[] = [];
    const requireAction = async (extra: string, resources: string[]) =>
      reader.read(extra, identity, request, resources[0]!, async (guard) => {
        if ((await guard.allowed(resources)).size !== resources.length) throw iamAccountDenied();
        additional.push(guard.recheck);
      });
    const resource = platformUserArn(id);
    const prepared = await reader.read(action, identity, request, resource, async (guard) => {
      if (data.email !== undefined) await requireAction("quyan:user:SetUserEmail", [resource]);
      if (data.status !== undefined) await requireAction("quyan:user:SetUserStatus", [resource]);
      if (destination)
        await requireAction("quyan:user:AssignUserGroup", [resource, platformUserGroupArn(destination.id)]);
      const snapshot = await this.snapshots.snapshot(identity, permission),
        authorizationRevision = await this.repository.authorizationRevision(identity, target.accountOwnerId);
      const write: PlatformUserUpdateGuard = {
        target,
        destination,
        data,
        group: snapshot.group,
        authorizationRevision,
        users: {
          principal: identity,
          targetUserId: actorId,
          users: snapshot.users,
          recheck: async () => {
            await guard.recheck();
            for (const recheck of additional) await recheck();
            await this.snapshots.recheck(identity, permission, snapshot);
            await this.repository.recheck(identity, target, destination);
            if (
              (await this.repository.authorizationRevision(identity, target.accountOwnerId)) !== authorizationRevision
            )
              throw iamAccountDenied();
            await proof();
          },
        },
      };
      guard.trackSource(() => this.repository.recheck(identity, target, destination));
      guard.trackSource(proof);
      return write;
    });
    if (!persist) return undefined;
    return this.repository.update(prepared);
  }
}
