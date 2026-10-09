import { GroupRepository } from "@/store/users/group.repository";
import type { GroupStore } from "@/store/users/group.store";
import { getIamResourcePatternTypes, isValidIamResource } from "@quyan/shared";
import { RamAuthorizationRepository } from "@/store/users/ram-authorization.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import type { RamAuthorizationStore, IamAuthorizationTarget } from "@/store/users/ram-authorization.store";
import type { RamResourceGroupStore } from "@/store/users/ram-resource-group.store";
import { assertIamPolicyAccount } from "./parser/policy-account";
import { isIamResourceInAccount } from "@quyan/shared";
import { isKnownIamAction, buildAcsResource, IAM_AUTHENTICATED_SELF_ACTIONS } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS, isSafeIamResourceBatch } from "./authorization-limits";
import type { IamEvaluationResult, IamPrincipal, IamConditionContext } from "@quyan/shared";
import { UserRepository } from "@/store/users/user.repository";
import { RamRoleRepository } from "@/store/users/ram-role.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { UserStore } from "@/store/users/user.store";
import type { RamRoleStore } from "@/store/users/ram-role.store";
import type { PolicyBindingInfo, RamPolicyStore } from "@/store/users/ram-policy.store";
import { ForbiddenError } from "@/util/errors";
import { legacyPermissionsToPolicy, legacyPermissionsToPrincipalPolicy } from "./legacy-policy";
import { IAM_BACKFILL_CREATOR, isGeneratedLegacyPolicyDocument } from "./migration/legacy-policy-provenance";
import { parseIamPolicy } from "./parser/policy-parser";
import { IamResourceConditionService } from "./condition/resource-condition.service";
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
    private readonly authorizations: RamAuthorizationStore = RamAuthorizationRepository.getInstance(),
    private readonly resourceGroups: RamResourceGroupStore = RamResourceGroupRepository.getInstance(),
    private readonly groups: GroupStore = GroupRepository.getInstance(),
    private readonly resourceConditions = IamResourceConditionService.getInstance(),
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
      const document = legacyPermissionsToPrincipalPolicy(
        permissions,
        principal.accountOwnerId,
        principal.principalUserId,
        effect,
      );
      if (document) result.push({ policyId: id, document });
    };
    const assumedSession = Boolean(principal.roleSessionId);
    if (assumedSession && principal.subjectType !== "assumed_role") throw deny();
    // Preserve seeded administrator group grants; never manufacture broader bootstrap privileges.
    if (!assumedSession && user.group && user.group.status === 1)
      addLegacy("legacy:group:" + user.group.id, user.group.permissions);
    if (!assumedSession) addLegacy("legacy:user:adds:" + user.id, user.permissionAdds);
    if (!assumedSession) addLegacy("legacy:user:removes:" + user.id, user.permissionRemoves, "Deny");
    const bindings = assumedSession
      ? []
      : await this.roles.listRoleBindingsForUser(user.id, user.group?.status === 1 ? user.groupId : null);
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
      ...(!assumedSession ? await this.policies.listPoliciesForTarget("user", user.id) : []),
      ...(!assumedSession && user.group?.status === 1 && user.groupId
        ? await this.policies.listPoliciesForTarget("group", user.groupId)
        : []),
      ...(await this.policies.listPoliciesForTargets("role", [...roleIds])),
    ];
    const targets: IamAuthorizationTarget[] = assumedSession ? [] : [{ principalType: "user", principalId: user.id }];
    if (!assumedSession && user.group?.status === 1 && user.groupId)
      targets.push({ principalType: "group", principalId: user.groupId });
    targets.push(...[...roleIds].map((principalId) => ({ principalType: "role", principalId })));
    // Self-service grants come from the shared catalog and only apply to this identity's user ARN.
    // They confer no account/group/admin authority; explicit Deny and validated sessions still apply.
    result.push({
      policyId: "system:self-service:" + user.id,
      document: {
        Version: "1",
        Statement: [
          {
            Sid: "AuthenticatedSelfService",
            Effect: "Allow",
            Action: [...IAM_AUTHENTICATED_SELF_ACTIONS],
            Resource: [
              buildAcsResource({
                service: "quyan",
                region: "*",
                accountId: principal.accountOwnerId,
                path: "user/" + user.id,
              }),
            ],
          },
        ],
      },
    });
    return result.concat(
      await this.loadAttachedPolicies(principal.accountOwnerId, attached, targets, principal.principalUserId),
    );
  }
  /** Candidate upper bound for delegation, not executable grants: unknown authors must never be underestimated. */
  async loadRolePolicies(accountOwnerId: string, roleId: string): Promise<IamPolicyInput[]> {
    const role = await this.roles.findRoleById(roleId);
    if (!role || role.status !== 1 || role.accountOwnerId !== accountOwnerId) throw deny();
    return this.loadAttachedPolicies(accountOwnerId, await this.policies.listPoliciesForTarget("role", roleId), [
      { principalType: "role", principalId: roleId },
    ]);
  }
  /** Candidate upper bound for membership delegation; actor grants come from subject-aware loadPolicies. */
  async loadGroupPolicies(accountOwnerId: string, groupId: string): Promise<IamPolicyInput[]> {
    const group = await this.groups.findById(groupId);
    if (!group || group.status !== 1 || group.accountOwnerId !== accountOwnerId) throw deny();
    const result = await this.loadAttachedPolicies(
      accountOwnerId,
      await this.policies.listPoliciesForTarget("group", groupId),
      [{ principalType: "group", principalId: groupId }],
    );
    const legacy = legacyPermissionsToPolicy(group.permissions, accountOwnerId);
    if (legacy) result.push({ policyId: "legacy:group:" + groupId, document: legacy });
    const roleIds = new Set((await this.roles.listRoleBindingsForUser("", groupId)).map((binding) => binding.roleId));
    for (const roleId of roleIds) result.push(...(await this.loadRolePolicies(accountOwnerId, roleId)));
    return result;
  }
  private async loadAttachedPolicies(
    accountOwnerId: string,
    attached: readonly PolicyBindingInfo[],
    targets: readonly IamAuthorizationTarget[],
    principalUserId?: string,
  ): Promise<IamPolicyInput[]> {
    const result: IamPolicyInput[] = [];
    const validated = new Map<string, IamPolicyInput>();
    for (const binding of attached) {
      if (binding.accountOwnerId !== accountOwnerId) throw deny();
      // Validate every attachment before deduplication; an invalid duplicate must not disappear.
      const entries: IamPolicyInput[] = [];
      this.addBinding(entries, binding, accountOwnerId, principalUserId);
      for (const entry of entries) validated.set(entry.policyId, entry);
    }

    const relations = await this.authorizations.listForPrincipals(accountOwnerId, targets);
    const projectedPolicyIds = new Set(
      relations.filter((relation) => relation.scopeType === "account").map((relation) => relation.policyId),
    );
    result.push(...[...validated.values()].filter((entry) => !projectedPolicyIds.has(entry.policyId)));
    for (const relation of relations) {
      if (
        relation.accountOwnerId !== accountOwnerId ||
        relation.policy.accountOwnerId !== accountOwnerId ||
        relation.policy.policyKind !== "identity"
      )
        throw deny();
      let scope: IamPolicyInput["scope"];
      if (relation.scopeType === "account") {
        if (relation.scopeArn || relation.scopeResourceId) throw deny();
        scope = { type: "account" };
      } else if (relation.scopeType === "resource") {
        if (
          !relation.scopeArn ||
          relation.scopeArn === "*" ||
          relation.scopeResourceId ||
          !getIamResourcePatternTypes(relation.scopeArn).length ||
          ![accountOwnerId, "*"].includes(relation.scopeArn.split(":")[3])
        )
          throw deny();
        scope = { type: "resource", arn: relation.scopeArn };
      } else if (relation.scopeType === "resource-group") {
        if (!relation.scopeResourceId || relation.scopeArn) throw deny();
        const group = await this.resourceGroups.findById(relation.scopeResourceId);
        if (!group || group.accountOwnerId !== accountOwnerId) throw deny();
        const resources: string[] = [];
        if (
          group.members.some(
            (member) =>
              member.accountOwnerId !== accountOwnerId ||
              !isValidIamResource(member.resourceArn) ||
              member.resourceArn === "*" ||
              !isIamResourceInAccount(member.resourceArn, accountOwnerId),
          )
        )
          throw deny();
        for (const member of group.members) {
          if (await this.resourceGroups.resourceExistsInAccount(member.resourceArn, accountOwnerId))
            resources.push(member.resourceArn);
        }
        scope = { type: "resource-group", id: group.id, resources };
      } else throw deny();
      const policy = relation.policy,
        version = policy.defaultVersion;
      const entries: IamPolicyInput[] = [];
      this.addBinding(
        entries,
        {
          policyId: policy.id,
          policyName: policy.name,
          accountOwnerId: policy.accountOwnerId,
          documentFormat: policy.documentFormat,
          versionId: version?.id,
          versionCreatedBy: version?.createdBy,
          document: version?.policyId === policy.id && version.status === 1 ? version.document : undefined,
          documentHash: version?.documentHash,
          validationState: version?.validationState,
          permissions: [],
          legacyPermissions: policy.permissions,
        },
        accountOwnerId,
        principalUserId,
      );
      result.push(...entries.map((entry) => ({ ...entry, authorizationId: relation.id, scope })));
    }
    return result;
  }
  private addBinding(
    result: IamPolicyInput[],
    binding: PolicyBindingInfo,
    owner: string,
    principalUserId?: string,
  ): void {
    const legacy = (permissions: unknown) =>
      principalUserId
        ? legacyPermissionsToPrincipalPolicy(permissions, owner, principalUserId)
        : legacyPermissionsToPolicy(permissions, owner);
    if (binding.documentFormat === "iam-v1") {
      if (!binding.versionId || !binding.document || binding.validationState !== "valid") throw deny();
      const parsed = parseIamPolicy(binding.document);
      if (parsed.documentHash !== binding.documentHash) throw deny();
      assertIamPolicyAccount(parsed.document, owner);
      // Backfilled versions retain legacy semantics; explicit later JSON versions are never rewritten.
      let document = parsed.document;
      if (binding.versionCreatedBy === IAM_BACKFILL_CREATOR) {
        if (!isGeneratedLegacyPolicyDocument(document, binding.legacyPermissions, owner)) throw deny();
        const projected = legacy(binding.legacyPermissions);
        if (!projected) throw deny();
        document = projected;
      }
      result.push({ policyId: binding.policyId, versionId: binding.versionId, document });
    } else if (binding.documentFormat === "legacy") {
      const document = legacy(
        binding.legacyPermissions === undefined ? binding.permissions : binding.legacyPermissions,
      );
      if (document) result.push({ policyId: binding.policyId, document });
    } else throw deny();
  }
  async authorize(input: {
    principal: IamPrincipal;
    action: string;
    resource: string;
    context?: IamConditionContext;
  }): Promise<IamEvaluationResult> {
    if (!isKnownIamAction(input.action) || !isIamResourceInAccount(input.resource, input.principal.accountOwnerId))
      return { decision: "ImplicitDeny", reason: "invalid-request", matchedStatements: [] };
    return (
      await this.evaluateLoadedPolicies({
        ...input,
        resources: [input.resource],
        policies: await this.loadPolicies(input.principal),
      })
    )[0];
  }
  /** Batch mutations must authorize every resource before any write; list services can use this same evaluator. */
  async authorizeMany(input: {
    principal: IamPrincipal;
    action: string;
    resources: readonly string[];
    context?: IamConditionContext;
  }): Promise<IamEvaluationResult[]> {
    if (
      !isKnownIamAction(input.action) ||
      !isSafeIamResourceBatch(input.resources) ||
      input.resources.some((resource) => !isIamResourceInAccount(resource, input.principal.accountOwnerId))
    )
      throw deny();
    const policies = await this.loadPolicies(input.principal);
    return this.evaluateLoadedPolicies({ ...input, policies });
  }
  /** Shared live and draft boundary: request attributes cannot impersonate the principal or resource owner. */
  async evaluateLoadedPolicies(input: {
    principal: IamPrincipal;
    policies: readonly IamPolicyInput[];
    action: string;
    resources: readonly string[];
    context?: IamConditionContext;
  }): Promise<IamEvaluationResult[]> {
    if (
      !isKnownIamAction(input.action) ||
      !isSafeIamResourceBatch(input.resources) ||
      input.resources.some((resource) => !isIamResourceInAccount(resource, input.principal.accountOwnerId))
    )
      throw deny();
    const contexts = await this.resourceConditions.contexts(input);
    return input.resources.map((resource, index) =>
      contexts[index] === undefined
        ? { decision: "ImplicitDeny", reason: "invalid-request", matchedStatements: [] }
        : evaluatePolicies(input.policies, { action: input.action, resource, context: contexts[index] }),
    );
  }
  /** Apply to an already account-scoped database page. Do not expose an unfiltered total as an authorized total. */
  async filterAuthorizedPage<T>(input: {
    principal: IamPrincipal;
    action: string;
    items: readonly T[];
    context?: IamConditionContext;
    resource: (item: T) => string | undefined;
  }): Promise<T[]> {
    if (!isKnownIamAction(input.action) || input.items.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
      throw deny();
    if (!input.items.length) return [];
    const resources = input.items.map(input.resource);
    if (!isSafeIamResourceBatch(resources)) throw deny();
    const results = await this.authorizeMany({
      principal: input.principal,
      action: input.action,
      resources,
      context: input.context,
    });
    return input.items.filter((_, index) => results[index].decision === "Allow");
  }
}
