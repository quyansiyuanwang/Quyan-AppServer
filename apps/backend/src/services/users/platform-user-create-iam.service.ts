import { z } from "zod";
import {
  CustomCode,
  DEFAULT_USER_GROUP_USERNAME,
  DEFAULT_USER_GROUP_PERMISSIONS,
  Permission,
  type IamPrincipal,
} from "@quyan/shared";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import {
  platformUserArn,
  platformUserGroupArn,
  platformUserDirectoryArn,
  isPlatformUserId,
} from "@/iam/resources/platform-user-resources";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { projectScopedPolicyForDelegation } from "@/iam/delegation/scoped-policy";
import { checkIamDelegation } from "@/iam/delegation/delegation-check";
import { legacyPermissionsToPolicy } from "@/iam/legacy-policy";
import { createUserBodySchema } from "@/api/schema/users/user.schema";
import { PlatformResourceReadIamService } from "@/services/system/platform-resource-read-iam.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import { PlatformUserCreateRepository } from "@/store/users/platform-user-create.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import type {
  PlatformUserCreateStore,
  PlatformUserCreateGuard,
  PlatformUserCreateGroup,
} from "@/store/users/platform-user-create.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { BadRequestError, ForbiddenError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
const action = "quyan:user:CreateUser",
  permission = Permission.USER_CREATE;
// Only the password resolver may supply this server-side bcrypt value. Never hash an already-hashed value again.
const persistenceSchema = createUserBodySchema
  .innerType()
  .omit({ password: true, passwordCredential: true })
  .extend({
    password: z.string().regex(/^\$2[aby]\$12\$[A-Za-z0-9./]{53}$/),
  });
export class PlatformUserCreateIamService {
  private static instance: PlatformUserCreateIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany" | "loadGroupPolicies" | "loadDelegatablePolicies"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformUserCreateStore = PlatformUserCreateRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformUserCreateIamService());
  }
  private async groupProof(
    principal: IamPrincipal,
    destination: PlatformUserCreateGroup,
    createdId: string,
    implicitDefault: boolean,
  ) {
    const candidates = await this.iam.loadGroupPolicies(createdId, destination.id, { allowGlobalManaged: true });
    const grants = await this.iam.loadDelegatablePolicies(principal);
    const denies = grants.flatMap((document) => {
      const Statement = document.Statement.filter((statement) => statement.Effect === "Deny");
      return Statement.length ? [{ Version: "1" as const, Statement }] : [];
    });
    const baseline = legacyPermissionsToPolicy(DEFAULT_USER_GROUP_PERMISSIONS, createdId)!;
    const defaultException =
      implicitDefault &&
      destination.username === DEFAULT_USER_GROUP_USERNAME &&
      JSON.stringify([...destination.permissions].sort()) ===
        JSON.stringify([...DEFAULT_USER_GROUP_PERMISSIONS].sort()) &&
      candidates.length === 1 &&
      candidates[0]!.policyId === "legacy:group:" + destination.id &&
      !candidates[0]!.scope &&
      JSON.stringify(candidates[0]!.document) === JSON.stringify(baseline);
    const proofGrants = defaultException
      ? [baseline, ...denies]
      : destination.recoveryBootstrap
        ? [
            { Version: "1" as const, Statement: [{ Effect: "Allow" as const, Action: ["*"], Resource: ["*"] }] },
            ...denies,
          ]
        : grants;
    if (!((defaultException || destination.recoveryBootstrap) && denies.length === 0)) {
      for (const candidate of candidates) {
        const projected = projectScopedPolicyForDelegation(candidate, { purpose: "candidate" });
        if (projected && !checkIamDelegation(projected, proofGrants).allowed) throw iamAccountDenied();
      }
    }
    return fingerprintIamPolicies(candidates);
  }
  private async prepare(input: unknown, actorId: string, request?: TypedRequest) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      principal.subjectUserId !== actorId ||
      principal.principalUserId !== actorId ||
      request.oauthAccessToken
    )
      throw iamAccountDenied();
    if (request.user?.impersonatorId && request.user.impersonationMode === "view")
      throw new ForbiddenError(
        "Read-only impersonation cannot create users",
        CustomCode.IMPERSONATION_READONLY_VIOLATION,
        { messageKey: "errors.impersonationReadonlyViolation" },
      );
    const parsed = persistenceSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid user creation", undefined, { messageKey: "errors.badRequest" });
    const identity = { ...principal },
      data = parsed.data;
    const reader = new PlatformResourceReadIamService(this.iam, this.snapshots);
    return reader.read(action, identity, request, platformUserDirectoryArn(), async (guard) => {
      const destination = await this.repository.destination(identity, data.groupId),
        additional: (() => Promise<void>)[] = [];
      const assign = async (resources: string[]) =>
        reader.read("quyan:user:AssignUserGroup", identity, request, resources[0]!, async (assignment) => {
          if ((await assignment.allowed(resources)).size !== resources.length) throw iamAccountDenied();
          additional.push(assignment.recheck);
        });
      if (data.groupId !== undefined) await assign([platformUserGroupArn(destination.id)]);
      const snapshot = await this.snapshots.snapshot(identity, permission),
        authorizationRevision = await this.repository.authorizationRevision(identity);
      let createdId: string | undefined, candidateHash: string | undefined;
      const prepared: PlatformUserCreateGuard = {
        data,
        destination,
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
            await this.repository.recheck(identity, destination, data.groupId);
            if ((await this.repository.authorizationRevision(identity)) !== authorizationRevision)
              throw iamAccountDenied();
          },
        },
        authorizeCreated: async (id) => {
          if (
            !isPlatformUserId(id) ||
            id === actorId ||
            id === identity.accountOwnerId ||
            (createdId !== undefined && id !== createdId)
          )
            throw iamAccountDenied();
          createdId = id;
          if (!(await guard.allowed([platformUserArn(id)])).has(platformUserArn(id))) throw iamAccountDenied();
          if (data.groupId !== undefined) await assign([platformUserArn(id), platformUserGroupArn(destination.id)]);
          const hash = await this.groupProof(identity, destination, id, data.groupId === undefined);
          if (candidateHash !== undefined && hash !== candidateHash) throw iamAccountDenied();
          candidateHash = hash;
          await prepared.users.recheck();
        },
      };
      guard.trackSource(() => this.repository.recheck(identity, destination, data.groupId));
      return prepared;
    });
  }
  async execute(input: unknown, actorId: string, request?: TypedRequest) {
    return this.repository.create(await this.prepare(input, actorId, request));
  }
  /** Shadow evaluates the real legacy-created ID without a second mutation or a fabricated resource. */
  async inspectCreated(id: string, input: unknown, actorId: string, request?: TypedRequest) {
    const guard = await this.prepare(input, actorId, request);
    const check = await this.repository.created(guard.users.principal, id, guard.data, guard.destination);
    await guard.authorizeCreated(id);
    await check();
    await guard.users.recheck();
  }
}
