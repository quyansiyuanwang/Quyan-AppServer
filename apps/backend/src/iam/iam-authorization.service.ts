import { isKnownIamAction } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS, isSafeIamResourceBatch } from "./authorization-limits";
import type { IamEvaluationResult, IamPrincipal } from "@quyan/shared";
import { UserRepository } from "@/store/users/user.repository";
import { RamRoleRepository } from "@/store/users/ram-role.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { UserStore } from "@/store/users/user.store";
import type { RamRoleStore } from "@/store/users/ram-role.store";
import type { PolicyBindingInfo, RamPolicyStore } from "@/store/users/ram-policy.store";
import { ForbiddenError } from "@/util/errors";
import { legacyPermissionsToPolicy } from "./legacy-policy";
import { parseIamPolicy } from "./parser/policy-parser";
import { evaluatePolicies } from "./evaluator/policy-evaluator";
import type { IamPolicyInput } from "./evaluator/policy-evaluator";

const deny = () =>
  new ForbiddenError("IAM authorization data unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });
export class IamAuthorizationService {
  private static instance: IamAuthorizationService;
  constructor(
    private readonly users: UserStore = UserRepository.getInstance(),
    private readonly roles: RamRoleStore = RamRoleRepository.getInstance(),
    private readonly policies: RamPolicyStore = RamPolicyRepository.getInstance(),
  ) {}
  static getInstance(): IamAuthorizationService {
    return (this.instance ??= new IamAuthorizationService());
  }
  /** No decision cache initially: every request reads current policy bindings and session state. */
  async loadPolicies(principal: IamPrincipal): Promise<IamPolicyInput[]> {
    const user = await this.users.findByIdWithGroup(principal.principalUserId);
    if (
      principal.subjectUserId !== principal.principalUserId ||
      !user ||
      user.status !== 1 ||
      (user.accountOwnerId || user.id) !== principal.accountOwnerId
    )
      throw deny();
    if (user.group?.accountOwnerId && user.group.accountOwnerId !== principal.accountOwnerId) throw deny();
    const result: IamPolicyInput[] = [];
    const addLegacy = (id: string, permissions: unknown, effect: "Allow" | "Deny" = "Allow") => {
      const document = legacyPermissionsToPolicy(permissions, principal.accountOwnerId, effect);
      if (document) result.push({ policyId: id, document });
    };
    // Preserve seeded administrator group grants; never manufacture broader bootstrap privileges.
    if (user.group && user.group.status === 1) addLegacy("legacy:group:" + user.group.id, user.group.permissions);
    addLegacy("legacy:user:adds:" + user.id, user.permissionAdds);
    addLegacy("legacy:user:removes:" + user.id, user.permissionRemoves, "Deny");
    const bindings = await this.roles.listRoleBindingsForUser(user.id, user.group?.status === 1 ? user.groupId : null);
    const roleIds = new Set(bindings.map((binding) => binding.roleId));
    if (principal.roleSessionId) {
      const session = await this.roles.findActiveRoleSession(principal.roleSessionId);
      if (
        !session ||
        session.status !== 1 ||
        session.revokedAt ||
        session.role.status !== 1 ||
        session.expiresAt.getTime() <= Date.now() ||
        session.subjectUserId !== principal.principalUserId ||
        session.roleId !== principal.assumedRoleId ||
        session.accountOwnerId !== principal.accountOwnerId ||
        session.role.accountOwnerId !== principal.accountOwnerId
      )
        throw deny();
      roleIds.add(session.roleId);
    } else if (principal.assumedRoleId || principal.subjectType === "assumed_role") throw deny();
    for (const roleId of roleIds) {
      const role = await this.roles.findRoleById(roleId);
      if (!role || role.status !== 1 || role.accountOwnerId !== principal.accountOwnerId) throw deny();
    }
    const attached = [
      ...(await this.policies.listPoliciesForTarget("user", user.id)),
      ...(user.group?.status === 1 && user.groupId
        ? await this.policies.listPoliciesForTarget("group", user.groupId)
        : []),
      ...(await this.policies.listPoliciesForTargets("role", [...roleIds])),
    ];
    const validated = new Map<string, IamPolicyInput>();
    for (const binding of attached) {
      if (binding.accountOwnerId !== principal.accountOwnerId) throw deny();
      // Validate every attachment before deduplication; an invalid duplicate must not disappear.
      const entries: IamPolicyInput[] = [];
      this.addBinding(entries, binding, principal.accountOwnerId);
      for (const entry of entries) validated.set(entry.policyId, entry);
    }
    result.push(...validated.values());
    return result;
  }
  private addBinding(result: IamPolicyInput[], binding: PolicyBindingInfo, owner: string): void {
    if (binding.documentFormat === "iam-v1") {
      if (!binding.versionId || !binding.document || binding.validationState !== "valid") throw deny();
      const parsed = parseIamPolicy(binding.document);
      if (parsed.documentHash !== binding.documentHash) throw deny();
      result.push({ policyId: binding.policyId, versionId: binding.versionId, document: parsed.document });
    } else if (binding.documentFormat === "legacy") {
      const document = legacyPermissionsToPolicy(
        binding.legacyPermissions === undefined ? binding.permissions : binding.legacyPermissions,
        owner,
      );
      if (document) result.push({ policyId: binding.policyId, document });
    } else throw deny();
  }
  async authorize(input: { principal: IamPrincipal; action: string; resource: string }): Promise<IamEvaluationResult> {
    return evaluatePolicies(await this.loadPolicies(input.principal), input);
  }
  /** Batch mutations must authorize every resource before any write; list services can use this same evaluator. */
  async authorizeMany(input: {
    principal: IamPrincipal;
    action: string;
    resources: readonly string[];
  }): Promise<IamEvaluationResult[]> {
    if (!isKnownIamAction(input.action) || !isSafeIamResourceBatch(input.resources)) throw deny();
    const policies = await this.loadPolicies(input.principal);
    return input.resources.map((resource) => evaluatePolicies(policies, { action: input.action, resource }));
  }
  /** Apply to an already account-scoped database page. Do not expose an unfiltered total as an authorized total. */
  async filterAuthorizedPage<T>(input: {
    principal: IamPrincipal;
    action: string;
    items: readonly T[];
    resource: (item: T) => string | undefined;
  }): Promise<T[]> {
    if (!isKnownIamAction(input.action) || input.items.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
      throw deny();
    if (!input.items.length) return [];
    const resources = input.items.map(input.resource);
    if (!isSafeIamResourceBatch(resources)) throw deny();
    const results = await this.authorizeMany({ principal: input.principal, action: input.action, resources });
    return input.items.filter((_, index) => results[index].decision === "Allow");
  }
}
