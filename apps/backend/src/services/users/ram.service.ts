import { isIamResourceInAccount } from "@quyan/shared";
import { parseIdentityPolicyDraft } from "@/iam/simulation/draft-simulation";
import type { ChatTextGenerationOptions } from "@/services/chat/chat.service";
import {
  parseIamTrustPolicy,
  evaluateIamTrustPolicy,
  combineIamIdentityAndTrust,
  IAM_ASSUME_ROLE_ACTION,
} from "@/iam/trust/trust-policy";
import { principalConditionContext } from "@/iam/request/condition-context";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { performance } from "node:perf_hooks";
import { auditIamManagement } from "@/iam/audit/iam-audit.service";
import { iamManagementPaginationSchema } from "@/iam/management-pagination";
import { requestConditionContext } from "@/iam/request/condition-context";
import {
  createIamAuthorizationBodySchema,
  createRamResourceGroupBodySchema,
  addRamResourceGroupMemberBodySchema,
  iamAuthorizationQuerySchema,
  assumeRamRoleBodySchema,
  ramGroupPageQuerySchema,
  ramSessionPageQuerySchema,
  ramRoleBindingPageQuerySchema,
  generateIamPolicyDraftBodySchema,
} from "@/api/schema/users/ram.schema";
import { iamAuthorizationScopeKey } from "@/iam/authorization-scope";
import { projectScopedPolicyForDelegation } from "@/iam/delegation/scoped-policy";
import { checkIamDelegation } from "@/iam/delegation/delegation-check";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { getRequestContext } from "@/util/request-context";
import { assertIamPolicyAccount } from "@/iam/parser/policy-account";
import { diagnoseIamPolicy } from "@/iam/diagnostics/policy-diagnostics";
import { randomBytes } from "crypto";
import { buildAcsResource, getCredentialPrefix } from "@quyan/shared";
import type { RamRole, User } from "@prisma/client";
import { Permission } from "@/constant/permission";
import { AccountStatus } from "@/util/auth/account-status";
import { BadRequestError, ForbiddenError, NotFoundError, ConflictError } from "@/util/errors";
import { hashPassword } from "@/util/crypto";
import { JWTAccessIns } from "@/util/auth";
import { isValidPermission } from "@/util/permission/validation";
import { PermissionService } from "@/services/users/permission.service";
import { UserRepository } from "@/store/users/user.repository";
import { GroupService } from "@/services/users/group.service";
import { GroupRepository } from "@/store/users/group.repository";
import { RamRoleRepository } from "@/store/users/ram-role.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { RamAuthorizationRepository } from "@/store/users/ram-authorization.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { AccessKeyRepository } from "@/store/users/accesskey.repository";
import { NotificationPreferenceRepository } from "@/store/notification/notification-preference.repository";
import { NotificationService } from "@/services/notification/notification.service";
import type { NotificationTemplateInput } from "@/services/notification/notification-template";
import { NotificationEvent } from "@/constant/notification-event";
import { env } from "@/config/env";
import type { UserStore } from "@/store/users/user.store";
import type { GroupStore } from "@/store/users/group.store";
import type { AccessKeyStore } from "@/store/users/accesskey.store";
import type { RamRoleStore, RamRoleBindingRecord, ActiveRamRoleSession } from "@/store/users/ram-role.store";
import type { RamPolicyWithVersion, UpdateRamPolicyInput } from "@/store/users/ram-policy.store";
import { iamVersionPaginationSchema } from "@/iam/policy-version-pagination";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { IamPolicyDraftService } from "@/iam/ai/policy-draft.service";
import {
  IAM_ACTION_CATALOG,
  getIamResourcePatternTypes,
  getIamResourceType,
  isKnownIamAction,
  isValidIamResource,
} from "@quyan/shared";
import type { IamPolicyDocument } from "@quyan/shared";
import type { RamPolicyStore } from "@/store/users/ram-policy.store";
import type { RamAuthorizationStore } from "@/store/users/ram-authorization.store";
import type { RamResourceGroupStore } from "@/store/users/ram-resource-group.store";
import type {
  AssumeRamRoleDto,
  AssumeRamRoleResponseDto,
  AttachPolicyBodyDto,
  CreateRamPolicyDto,
  CreateRamRoleDto,
  CreateRamUserDto,
  EffectivePermissionDto,
  RamGroupDto,
  RamVisibleGroupPageDto,
  RamPolicyAttachmentDto,
  RamPolicyAttachmentPageDto,
  RamPolicyDto,
  RamRoleBindingDto,
  RamRoleBindingPageDto,
  RamRoleDto,
  RamRolePageDto,
  RamPolicyPageDto,
  RamRoleSessionDto,
  RamUserDto,
  RamUserPageDto,
  RamRoleSessionPageDto,
  UpdateRamPolicyDto,
  UpdateRamRoleDto,
  UpdateRamUserDto,
  AddRamResourceGroupMemberDto,
  CreateRamAuthorizationDto,
  CreateRamResourceGroupDto,
  RamAuthorizationDto,
  RamAuthorizationPageDto,
  RamResourceGroupPageDto,
  RamResourceGroupMemberPageDto,
  RamResourceGroupDto,
  GenerateIamPolicyDraftDto,
  GenerateIamPolicyDraftResponseDto,
} from "@/api/dto/users/ram.dto";

const DEFAULT_ROLE_SESSION_DURATION_SECONDS = 3600;

type AccountScopedUser = User & {
  accountOwnerId?: string | null;
  userType?: string | null;
};

function normalizeJsonStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export class RamService {
  constructor(
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly groupRepository: GroupStore = GroupRepository.getInstance(),
    private readonly ramRoleRepository: RamRoleStore = RamRoleRepository.getInstance(),
    private readonly ramPolicyRepository: RamPolicyStore = RamPolicyRepository.getInstance(),
    private readonly accessKeyRepository: AccessKeyStore = AccessKeyRepository.getInstance(),
    private readonly permissionService: PermissionService = PermissionService.getInstance(),
    private readonly authorizationRepository: RamAuthorizationStore = RamAuthorizationRepository.getInstance(),
    private readonly resourceGroupRepository: RamResourceGroupStore = RamResourceGroupRepository.getInstance(),
    private readonly groupManagementService: Pick<GroupService, "getVisibleGroupsPage"> = GroupService.getInstance(),
  ) {}

  private static instance: RamService;

  static getInstance(): RamService {
    if (!RamService.instance) RamService.instance = new RamService();
    return RamService.instance;
  }

  private resolveAccountOwnerId(user: AccountScopedUser): string {
    return user.accountOwnerId || user.id;
  }

  private async getActor(actorUserId: string): Promise<AccountScopedUser> {
    const actor = await this.userRepository.findById(actorUserId);
    if (!actor) throw new NotFoundError("操作者用户不存在", undefined, { messageKey: "permission.operatorNotFound" });
    if (actor.status !== AccountStatus.ACTIVE)
      throw new ForbiddenError("操作者账户不可用", undefined, { messageKey: "ram.actorUnavailable" });
    return actor as AccountScopedUser;
  }

  private async getAccountOwnerId(actorUserId: string): Promise<string> {
    const actor = await this.getActor(actorUserId);
    return this.resolveAccountOwnerId(actor);
  }

  private assertSameAccount(accountOwnerId: string, resourceAccountOwnerId?: string | null): void {
    const normalized = resourceAccountOwnerId || undefined;
    if (normalized && normalized !== accountOwnerId)
      throw new ForbiddenError("无权访问其他主账号下的资源", undefined, {
        messageKey: "ram.crossAccountResourceForbidden",
      });
  }

  private authorizationScopeKey(
    data: Pick<CreateRamAuthorizationDto, "scopeType" | "scopeResourceId" | "scopeArn">,
  ): string {
    return iamAuthorizationScopeKey(data.scopeType, data.scopeResourceId, data.scopeArn);
  }
  private mapAuthorization(
    record: Awaited<ReturnType<RamAuthorizationStore["findById"]>> extends infer T ? Exclude<T, null> : never,
  ): RamAuthorizationDto {
    return {
      id: record.id,
      accountOwnerId: record.accountOwnerId,
      principalType: record.principalType as RamAuthorizationDto["principalType"],
      principalId: record.principalId,
      policyId: record.policyId,
      scopeType: record.scopeType as RamAuthorizationDto["scopeType"],
      scopeResourceId: record.scopeResourceId,
      scopeArn: record.scopeArn,
      description: record.description,
      status: record.status,
      createdBy: record.createdBy,
      createTime: record.createTime.toISOString(),
      updateTime: record.updateTime.toISOString(),
    };
  }
  private mapResourceGroup(
    record: Awaited<ReturnType<RamResourceGroupStore["findById"]>> extends infer T ? Exclude<T, null> : never,
  ): RamResourceGroupDto {
    return {
      id: record.id,
      accountOwnerId: record.accountOwnerId,
      name: record.name,
      description: record.description,
      status: record.status,
      createTime: record.createTime.toISOString(),
      updateTime: record.updateTime.toISOString(),
      members: record.members.map((member) => ({
        id: member.id,
        resourceGroupId: member.resourceGroupId,
        resourceArn: member.resourceArn,
        service: member.service,
        resourceType: member.resourceType,
        resourceId: member.resourceId,
        status: member.status,
        createTime: member.createTime.toISOString(),
        updateTime: member.updateTime.toISOString(),
      })),
    };
  }
  private async assertAuthorizationPrincipal(
    owner: string,
    type: CreateRamAuthorizationDto["principalType"],
    id: string,
  ): Promise<void> {
    if (!["user", "group", "role"].includes(type))
      throw new BadRequestError("Invalid IAM principal type", undefined, {
        messageKey: "iam.authorizationScopeInvalid",
      });
    if (type === "user") {
      const user = await this.userRepository.findById(id);
      if (!user || user.status !== AccountStatus.ACTIVE)
        throw new NotFoundError("Authorization principal not found", undefined, { messageKey: "user.notFound" });
      this.assertSameAccount(owner, user.accountOwnerId || user.parentUserId || user.id);
    } else if (type === "group") {
      const group = await this.groupRepository.findById(id);
      if (!group || group.status !== AccountStatus.ACTIVE)
        throw new NotFoundError("Authorization principal not found", undefined, { messageKey: "group.notFound" });
      this.assertSameAccount(owner, group.accountOwnerId);
    } else if (type === "role") {
      const role = await this.ramRoleRepository.findRoleById(id);
      if (!role || role.status !== AccountStatus.ACTIVE)
        throw new NotFoundError("Authorization principal not found", undefined, { messageKey: "ram.roleNotFound" });
      this.assertSameAccount(owner, role.accountOwnerId);
    }
  }
  private async assertAuthorizationScope(owner: string, data: CreateRamAuthorizationDto): Promise<void> {
    if (data.scopeType === "account") {
      if (data.scopeResourceId || data.scopeArn)
        throw new BadRequestError("Invalid account scope", undefined, { messageKey: "iam.authorizationScopeInvalid" });
      return;
    }
    if (data.scopeType === "resource-group") {
      if (!data.scopeResourceId || data.scopeArn)
        throw new BadRequestError("Invalid resource group scope", undefined, {
          messageKey: "iam.authorizationScopeInvalid",
        });
      const group = await this.resourceGroupRepository.findById(data.scopeResourceId);
      if (!group)
        throw new NotFoundError("Resource group not found", undefined, { messageKey: "iam.resourceGroupNotFound" });
      this.assertSameAccount(owner, group.accountOwnerId);
      return;
    }
    if (data.scopeType !== "resource" || !data.scopeArn || data.scopeResourceId || data.scopeArn === "*")
      throw new BadRequestError("Invalid resource scope", undefined, { messageKey: "iam.authorizationScopeInvalid" });
    const types = getIamResourcePatternTypes(data.scopeArn);
    const account = data.scopeArn.split(":")[3];
    if (!types.length || (account !== "*" && account !== owner))
      throw new BadRequestError("Invalid resource scope", undefined, { messageKey: "iam.authorizationScopeInvalid" });
  }
  /** The controller checks collection access; every HTTP row is then evaluated independently. */
  private async filterManagementPage<T extends { id: string }>(
    actorUserId: string,
    owner: string,
    action: string,
    type: "authorization" | "resource-group" | "role" | "policy",
    items: T[],
  ): Promise<T[]> {
    const request = getRequestContext();
    if (!request) return items; // Existing internal management queries are account-scoped and bounded.
    return this.filterIamEntityPage(actorUserId, owner, action, type, items);
  }
  /** Entity pages enforce row grants for HTTP and internal callers alike. */
  private async filterIamEntityPage<T extends { id: string }>(
    actorUserId: string,
    owner: string,
    action: string,
    type: "authorization" | "resource-group" | "role" | "policy" | "user" | "role-session",
    items: T[],
  ): Promise<T[]> {
    const { principal, context } = await this.actorIamContext(actorUserId);
    if (!principal || principal.principalUserId !== actorUserId || principal.accountOwnerId !== owner)
      throw new ForbiddenError("Invalid IAM list context", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    return IamAuthorizationService.getInstance().filterAuthorizedPage({
      principal,
      action,
      items,
      context,
      resource: (item) =>
        buildAcsResource({ service: "quyan", region: "*", accountId: owner, path: type + "/" + item.id }),
    });
  }
  async listAuthorizations(
    actorUserId: string,
    query: { principalType?: string; principalId?: string; page?: number; pageSize?: number } = {},
  ): Promise<RamAuthorizationDto[]> {
    const parsed = iamAuthorizationQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestError("Invalid authorization query", undefined, {
        messageKey: "iam.authorizationScopeInvalid",
      });
    const owner = await this.getAccountOwnerId(actorUserId);
    const records = await this.authorizationRepository.list(
      owner,
      parsed.data.principalType,
      parsed.data.principalId,
      parsed.data,
    );
    return (
      await this.filterManagementPage(actorUserId, owner, "quyan:ram:ListAuthorizations", "authorization", records)
    ).map((record) => this.mapAuthorization(record));
  }
  async listAuthorizationPage(
    actorUserId: string,
    query: { principalType?: string; principalId?: string; page?: number; pageSize?: number } = {},
  ): Promise<RamAuthorizationPageDto> {
    const parsed = iamAuthorizationQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestError("Invalid authorization query", undefined, {
        messageKey: "iam.authorizationScopeInvalid",
      });
    const owner = await this.getAccountOwnerId(actorUserId);
    const result = await this.authorizationRepository.listPage(owner, parsed.data);
    const records = await this.filterManagementPage(
      actorUserId,
      owner,
      "quyan:ram:ListAuthorizations",
      "authorization",
      result.items,
    );
    return { ...result, items: records.map((record) => this.mapAuthorization(record)) };
  }
  async listResourceGroupPage(
    actorUserId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<RamResourceGroupPageDto> {
    const parsed = iamManagementPaginationSchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestError("Invalid resource group query", undefined, {
        messageKey: "iam.authorizationScopeInvalid",
      });
    const owner = await this.getAccountOwnerId(actorUserId);
    const result = await this.resourceGroupRepository.listSummaryPage(owner, parsed.data);
    const records = await this.filterManagementPage(
      actorUserId,
      owner,
      "quyan:ram:ListResourceGroups",
      "resource-group",
      result.items,
    );
    return {
      ...result,
      items: records.map((record) => ({
        id: record.id,
        accountOwnerId: record.accountOwnerId,
        name: record.name,
        description: record.description,
        status: record.status,
        createTime: record.createTime.toISOString(),
        updateTime: record.updateTime.toISOString(),
      })),
    };
  }
  async listResourceGroupMemberPage(
    actorUserId: string,
    groupId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<RamResourceGroupMemberPageDto> {
    const parsed = iamManagementPaginationSchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestError("Invalid resource group query", undefined, {
        messageKey: "iam.authorizationScopeInvalid",
      });
    const owner = await this.getAccountOwnerId(actorUserId);
    const group = await this.resourceGroupRepository.findSummaryById(groupId);
    if (!group)
      throw new NotFoundError("Resource group missing", undefined, { messageKey: "iam.resourceGroupNotFound" });
    this.assertSameAccount(owner, group.accountOwnerId);
    const result = await this.resourceGroupRepository.listMemberPage(owner, groupId, parsed.data);
    return {
      ...result,
      items: result.items.map((member) => ({
        id: member.id,
        resourceGroupId: member.resourceGroupId,
        resourceArn: member.resourceArn,
        service: member.service,
        resourceType: member.resourceType,
        resourceId: member.resourceId,
        status: member.status,
        createTime: member.createTime.toISOString(),
        updateTime: member.updateTime.toISOString(),
      })),
    };
  }
  async createAuthorization(actorUserId: string, data: CreateRamAuthorizationDto): Promise<RamAuthorizationDto> {
    const validatedInput = createIamAuthorizationBodySchema.safeParse(data);
    if (!validatedInput.success)
      throw new BadRequestError("Invalid authorization", undefined, { messageKey: "iam.authorizationScopeInvalid" });
    data = validatedInput.data;
    const owner = await this.getAccountOwnerId(actorUserId);
    const policy = await this.ramPolicyRepository.findPolicyById(data.policyId);
    if (!policy) throw new NotFoundError("Policy not found", undefined, { messageKey: "ram.policyNotFound" });
    this.assertSameAccount(owner, policy.accountOwnerId);
    await this.assertAuthorizationPrincipal(owner, data.principalType, data.principalId);
    await this.assertAuthorizationScope(owner, data);
    const scopedGroup =
      data.scopeType === "resource-group"
        ? await this.resourceGroupRepository.findById(data.scopeResourceId!)
        : undefined;
    if (data.scopeType === "resource-group" && !scopedGroup)
      throw new NotFoundError("Resource group not found", undefined, { messageKey: "iam.resourceGroupNotFound" });
    if (policy.policyKind !== "identity")
      throw new BadRequestError("Identity policy required", undefined, { messageKey: "iam.invalidPolicy" });
    if (policy.documentFormat === "iam-v1") {
      if (
        !policy.defaultVersion ||
        policy.defaultVersion.status !== AccountStatus.ACTIVE ||
        policy.defaultVersion.validationState !== "valid" ||
        policy.defaultVersion.policyId !== policy.id ||
        parseIamPolicy(policy.defaultVersion.document).documentHash !== policy.defaultVersion.documentHash
      )
        throw new BadRequestError("Invalid policy version", undefined, { messageKey: "iam.invalidPolicy" });
      const document = parseIamPolicy(policy.defaultVersion.document).document;
      await this.assertRecoveryTarget(actorUserId, data.principalType, data.principalId, document);
      if (env.security.iamAuthorizationMode !== "enforce")
        throw new ForbiddenError("IAM rollout required", undefined, { messageKey: "iam.rolloutRequired" });
      assertIamPolicyAccount(document, owner);
      const scope =
        data.scopeType === "account"
          ? { type: "account" as const }
          : data.scopeType === "resource"
            ? { type: "resource" as const, arn: data.scopeArn! }
            : {
                type: "resource-group" as const,
                id: data.scopeResourceId!,
                resources: scopedGroup!.members.map((member) => member.resourceArn),
              };
      const projected = projectScopedPolicyForDelegation({ policyId: policy.id, document, scope });
      if (projected && !(await this.checkPolicyDelegation(actorUserId, projected)).allowed)
        throw new ForbiddenError("Authorization delegation denied", undefined, { messageKey: "iam.delegationDenied" });
    } else {
      await this.assertRecoveryTarget(actorUserId, data.principalType, data.principalId);
      await this.assertCanUsePolicyPermissions(actorUserId, normalizeJsonStringArray(policy.permissions));
    }
    const created = await this.authorizationRepository.create({
      accountOwnerId: owner,
      principalType: data.principalType,
      principalId: data.principalId,
      policyId: data.policyId,
      scopeType: data.scopeType,
      scopeResourceId: data.scopeResourceId,
      scopeArn: data.scopeArn,
      scopeKey: this.authorizationScopeKey(data),
      description: data.description,
      createdBy: actorUserId,
      expectedGroupUpdateTime: scopedGroup?.updateTime,
      expectedVersionId: policy.defaultVersionId,
      expectedDocumentHash: policy.defaultVersion?.documentHash ?? null,
    });
    auditIamManagement({
      actorUserId,
      accountOwnerId: owner,
      operation: "create-authorization",
      targetId: created.id,
      policyId: created.policyId,
      scopeType: created.scopeType,
      resourceArn: created.scopeArn ?? undefined,
      requestId: getRequestContext()?.res?.locals.requestId,
    });
    return this.mapAuthorization(created);
  }
  async deleteAuthorization(actorUserId: string, authorizationId: string): Promise<void> {
    const owner = await this.getAccountOwnerId(actorUserId);
    const record = await this.authorizationRepository.findById(authorizationId);
    if (!record)
      throw new NotFoundError("Authorization not found", undefined, { messageKey: "iam.authorizationNotFound" });
    this.assertSameAccount(owner, record.accountOwnerId);
    await this.assertRecoveryTarget(actorUserId, record.principalType, record.principalId);
    await this.authorizationRepository.delete(authorizationId);
    auditIamManagement({
      actorUserId,
      accountOwnerId: owner,
      operation: "delete-authorization",
      targetId: authorizationId,
      policyId: record.policyId,
      scopeType: record.scopeType,
      requestId: getRequestContext()?.res?.locals.requestId,
    });
  }
  async listResourceGroups(
    actorUserId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<RamResourceGroupDto[]> {
    const page = iamManagementPaginationSchema.safeParse(query);
    if (!page.success)
      throw new BadRequestError("Invalid resource group query", undefined, {
        messageKey: "iam.authorizationScopeInvalid",
      });
    const owner = await this.getAccountOwnerId(actorUserId);
    const records = await this.resourceGroupRepository.list(owner, page.data);
    return (
      await this.filterManagementPage(actorUserId, owner, "quyan:ram:ListResourceGroups", "resource-group", records)
    ).map((record) => this.mapResourceGroup(record));
  }
  async createResourceGroup(actorUserId: string, data: CreateRamResourceGroupDto): Promise<RamResourceGroupDto> {
    const validated = createRamResourceGroupBodySchema.safeParse(data);
    if (!validated.success)
      throw new BadRequestError("Invalid resource group", undefined, { messageKey: "iam.authorizationScopeInvalid" });
    const owner = await this.getAccountOwnerId(actorUserId);
    let group;
    try {
      group = await this.resourceGroupRepository.create({ accountOwnerId: owner, ...validated.data });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002")
        throw new BadRequestError("Resource group already exists", undefined, {
          messageKey: "iam.resourceGroupNameConflict",
        });
      throw error;
    }
    auditIamManagement({
      actorUserId,
      accountOwnerId: owner,
      operation: "create-resource-group",
      targetId: group.id,
      requestId: getRequestContext()?.res?.locals.requestId,
    });
    return this.mapResourceGroup({ ...group, members: [] });
  }
  private async assertResourceGroupMutation(
    actorUserId: string,
    groupId: string,
    resourceArn: string,
    adding: boolean,
  ): Promise<void> {
    for (const relation of await this.authorizationRepository.listForResourceGroup(groupId)) {
      await this.assertRecoveryTarget(actorUserId, relation.principalType, relation.principalId);
      if (!adding) continue;
      const policy = relation.policy;
      if (policy.documentFormat !== "iam-v1" || !policy.defaultVersion) {
        await this.assertCanUsePolicyPermissions(actorUserId, normalizeJsonStringArray(policy.permissions));
        continue;
      }
      const document = parseIamPolicy(policy.defaultVersion.document).document;
      const projected = projectScopedPolicyForDelegation({
        policyId: policy.id,
        document,
        scope: { type: "resource-group", id: groupId, resources: [resourceArn] },
      });
      if (projected && !(await this.checkPolicyDelegation(actorUserId, projected)).allowed)
        throw new ForbiddenError("Resource group membership expands delegation scope", undefined, {
          messageKey: "iam.delegationDenied",
        });
    }
  }
  async addResourceGroupMember(
    actorUserId: string,
    groupId: string,
    data: AddRamResourceGroupMemberDto,
  ): Promise<RamResourceGroupDto> {
    const validated = addRamResourceGroupMemberBodySchema.safeParse(data);
    if (!validated.success)
      throw new BadRequestError("Invalid resource group member", undefined, {
        messageKey: "iam.resourceGroupMemberInvalid",
      });
    data = validated.data;
    const owner = await this.getAccountOwnerId(actorUserId);
    const group = await this.resourceGroupRepository.findById(groupId);
    if (!group)
      throw new NotFoundError("Resource group not found", undefined, { messageKey: "iam.resourceGroupNotFound" });
    this.assertSameAccount(owner, group.accountOwnerId);
    const type = getIamResourceType(data.resourceArn);
    if (!type || !(await this.resourceGroupRepository.resourceExistsInAccount(data.resourceArn, owner)))
      throw new BadRequestError("Invalid resource group member", undefined, {
        messageKey: "iam.resourceGroupMemberInvalid",
      });
    await this.assertResourceGroupMutation(actorUserId, groupId, data.resourceArn, true);
    const parts = data.resourceArn.split(":")[4].split("/");
    await this.resourceGroupRepository.addMember({
      accountOwnerId: owner,
      resourceGroupId: groupId,
      resourceArn: data.resourceArn,
      service: type.service,
      resourceType: type.type,
      resourceId: parts.slice(1).join("/"),
      expectedGroupUpdateTime: group.updateTime,
    });
    auditIamManagement({
      actorUserId,
      accountOwnerId: owner,
      operation: "add-resource-group-member",
      targetId: groupId,
      resourceArn: data.resourceArn,
      requestId: getRequestContext()?.res?.locals.requestId,
    });
    const full = await this.resourceGroupRepository.findById(groupId);
    if (!full)
      throw new NotFoundError("Resource group not found", undefined, { messageKey: "iam.resourceGroupNotFound" });
    return this.mapResourceGroup(full);
  }
  async removeResourceGroupMember(actorUserId: string, groupId: string, memberId: string): Promise<void> {
    const owner = await this.getAccountOwnerId(actorUserId);
    const group = await this.resourceGroupRepository.findById(groupId);
    if (!group)
      throw new NotFoundError("Resource group not found", undefined, { messageKey: "iam.resourceGroupNotFound" });
    this.assertSameAccount(owner, group.accountOwnerId);
    const member = group.members.find((member) => member.id === memberId);
    if (!member)
      throw new NotFoundError("Resource group member not found", undefined, {
        messageKey: "iam.resourceGroupMemberInvalid",
      });
    await this.assertResourceGroupMutation(actorUserId, groupId, member.resourceArn, false);
    await this.resourceGroupRepository.removeMember(groupId, memberId, group.updateTime);
    auditIamManagement({
      actorUserId,
      accountOwnerId: owner,
      operation: "remove-resource-group-member",
      targetId: groupId,
      resourceArn: member.resourceArn,
      requestId: getRequestContext()?.res?.locals.requestId,
    });
  }

  private normalizePolicyPermissions(permissions: string[]): Permission[] {
    const invalidPermissions = permissions.filter((permission) => !isValidPermission(permission));
    if (invalidPermissions.length > 0)
      throw new BadRequestError(`无效的权限: ${invalidPermissions.join(", ")}`, undefined, {
        messageKey: "permission.invalidPermissions",
        messageParams: { permissions: invalidPermissions.join(", ") },
      });
    return [...new Set(permissions as Permission[])];
  }

  private async assertCanUsePolicyPermissions(actorUserId: string, permissions: string[]): Promise<Permission[]> {
    const normalizedPermissions = this.normalizePolicyPermissions(permissions);
    await this.permissionService.assertCanGrantPermissions(actorUserId, normalizedPermissions);
    return normalizedPermissions;
  }

  private async assertPolicyTargetInAccount(
    accountOwnerId: string,
    targetType: AttachPolicyBodyDto["targetType"],
    targetId: string,
  ): Promise<void> {
    if (targetType === "user") {
      const user = await this.userRepository.findById(targetId);
      if (!user) throw new NotFoundError("用户不存在", undefined, { messageKey: "user.notFound" });
      if (user.status !== AccountStatus.ACTIVE)
        throw new NotFoundError("用户不存在", undefined, { messageKey: "user.notFound" });
      this.assertSameAccount(accountOwnerId, user.accountOwnerId || user.parentUserId || user.id);
      return;
    }

    if (targetType === "group") {
      const group = await this.groupRepository.findById(targetId);
      if (!group) throw new NotFoundError("用户组不存在", undefined, { messageKey: "group.notFound" });
      if (group.status !== AccountStatus.ACTIVE)
        throw new NotFoundError("用户组不存在", undefined, { messageKey: "group.notFound" });
      this.assertSameAccount(accountOwnerId, group.accountOwnerId);
      return;
    }

    const role = await this.ramRoleRepository.findRoleById(targetId);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);
  }

  private async assertPolicyAttachmentScope(actorUserId: string, data: AttachPolicyBodyDto) {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const policy = await this.ramPolicyRepository.findPolicyById(data.policyId);
    if (!policy) throw new NotFoundError("权限策略不存在", undefined, { messageKey: "ram.policyNotFound" });
    this.assertSameAccount(accountOwnerId, policy.accountOwnerId);
    await this.assertPolicyTargetInAccount(accountOwnerId, data.targetType, data.targetId);
    return { accountOwnerId, policy };
  }

  private async dispatchNotification(
    actorUserId: string,
    event: NotificationEvent,
    payload: NotificationTemplateInput,
  ): Promise<void> {
    try {
      const prefRepo = NotificationPreferenceRepository.getInstance();
      const pref = await prefRepo.findByUserId(actorUserId);
      if (!pref) return;

      const subscribedEvents = (pref.subscribedEvents as string[]) ?? [];
      if (!subscribedEvents.includes(event)) return;

      NotificationService.getInstance().dispatch(actorUserId, event, payload);
    } catch {
      // non-fatal
    }
  }

  private mapUserToDto(
    user: AccountScopedUser,
    accessKeyId?: string | null,
    accessKeySecret?: string | null,
  ): RamUserDto {
    return {
      id: user.id,
      username: user.username,
      ramUsername: user.ramUsername ?? null,
      displayName: user.displayName ?? null,
      email: user.email,
      name: user.name,
      status: user.status,
      groupId: user.groupId,
      accountOwnerId: user.accountOwnerId ?? null,
      parentUserId: user.parentUserId ?? null,
      userType: user.userType ?? null,
      createdAt: user.createTime.toISOString(),
      updatedAt: user.updateTime.toISOString(),
      accessKeyId: accessKeyId ?? null,
      accessKeySecret: accessKeySecret ?? null,
      forcePasswordChange: ((user as Record<string, unknown>).forcePasswordChange as boolean | null) ?? null,
    };
  }

  private mapRoleToDto(role: RamRole, permissions: string[]): RamRoleDto {
    let trustPolicyHash: string | undefined;
    try {
      if (role.trustPolicy) trustPolicyHash = parseIamTrustPolicy(role.trustPolicy).documentHash;
    } catch {
      /* Legacy invalid trust can still be diagnosed; it never authorizes enforce-mode assumption. */
    }
    return {
      ...(trustPolicyHash ? { trustPolicyHash } : {}),
      id: role.id,
      accountOwnerId: role.accountOwnerId,
      name: role.name,
      description: role.description,
      permissions,
      trustPolicy: (role.trustPolicy as Record<string, unknown> | null) ?? null,
      maxSessionDuration: role.maxSessionDuration,
      status: role.status,
      createdAt: role.createTime.toISOString(),
      updatedAt: role.updateTime.toISOString(),
    };
  }

  private mapBindingToDto(binding: RamRoleBindingRecord): RamRoleBindingDto {
    return {
      id: binding.id,
      roleId: binding.roleId,
      roleName: binding.roleName,
      permissions: binding.permissions,
      source: binding.source,
      principalId: binding.principalId,
    };
  }

  private mapSessionToDto(session: ActiveRamRoleSession): RamRoleSessionDto {
    return {
      id: session.id,
      accountOwnerId: session.accountOwnerId,
      subjectUserId: session.subjectUserId,
      roleId: session.roleId,
      roleName: session.role.name,
      sessionName: session.sessionName,
      expiresAt: session.expiresAt.toISOString(),
      status: session.status,
      createdAt: session.createTime.toISOString(),
    };
  }

  async listRamUserPage(
    actorUserId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<RamUserPageDto> {
    const parsed = iamManagementPaginationSchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestError("Invalid RAM user page", undefined, {
        messageKey: "validation.fieldInvalidValue",
        messageParams: { field: "pagination" },
      });
    const actor = await this.getActor(actorUserId),
      owner = this.resolveAccountOwnerId(actor);
    const actorGroup = actor.groupId ? await this.groupRepository.findById(actor.groupId) : null;
    const isAdmin = actorGroup?.username === env.security.superAdminGroupUsername;
    const { page, pageSize } = parsed.data;
    const filters = { accountOwnerId: owner, userType: "ram_user", skip: (page - 1) * pageSize, take: pageSize + 1 };
    const candidates =
      isAdmin || (env.security.iamAuthorizationMode === "enforce" && !actorGroup)
        ? await this.userRepository.listNonDeletedPaginated(filters)
        : await this.userRepository.listNonDeletedByGroupLevelGtePaginated(actorGroup?.level ?? 0, filters);
    const items = candidates.slice(0, pageSize);
    const records =
      env.security.iamAuthorizationMode === "enforce"
        ? await this.filterIamEntityPage(actorUserId, owner, "quyan:ram:ReadUser", "user", items)
        : items;
    return {
      items: records.map((user) => this.mapUserToDto(user as AccountScopedUser)),
      page,
      pageSize,
      hasNext: candidates.length > pageSize,
    };
  }

  async listRamUsers(actorUserId: string): Promise<RamUserDto[]> {
    if (env.security.iamAuthorizationMode === "enforce") return (await this.listRamUserPage(actorUserId)).items;
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const actor = await this.getActor(actorUserId);
    const actorGroup = actor.groupId ? await this.groupRepository.findById(actor.groupId) : null;
    const isAdmin = actorGroup?.username === env.security.superAdminGroupUsername;

    const users = isAdmin
      ? await this.userRepository.listNonDeleted()
      : await this.userRepository.listNonDeletedByGroupLevelGte(actorGroup?.level ?? 0);

    return users
      .filter(
        (user) =>
          user.userType === "ram_user" &&
          (user.accountOwnerId === accountOwnerId || user.parentUserId === accountOwnerId),
      )
      .map((user) => this.mapUserToDto(user as AccountScopedUser));
  }

  async listVisibleGroupPage(
    actorUserId: string,
    options: { page?: number; pageSize?: number; keyword?: string } = {},
  ): Promise<RamVisibleGroupPageDto> {
    const parsed = ramGroupPageQuerySchema.safeParse(options);
    if (!parsed.success)
      throw new BadRequestError("Invalid RAM group page", undefined, {
        messageKey: "validation.fieldInvalidValue",
        messageParams: { field: "pagination" },
      });
    const { page, pageSize, keyword } = parsed.data;
    if (env.security.iamAuthorizationMode === "enforce") {
      const result = await this.groupManagementService.getVisibleGroupsPage({ actorUserId, page, pageSize, keyword });
      const items = result.groups.map((group) => {
        if (!group.createdAt || !group.updatedAt)
          throw new ForbiddenError("Invalid group summary", undefined, {
            messageKey: "permission.insufficientPermission",
          });
        return { ...group, createdAt: group.createdAt, updatedAt: group.updatedAt };
      });
      return { items, page: result.page, pageSize: result.pageSize, hasNext: result.hasMore };
    }
    const actor = await this.getActor(actorUserId);
    const actorGroup = actor.groupId ? await this.groupRepository.findById(actor.groupId) : null;
    const candidates = await this.groupRepository.listActiveWithUserCountPaginated({
      ...(actorGroup?.username === env.security.superAdminGroupUsername ? {} : { minLevel: actorGroup?.level ?? 0 }),
      keyword,
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
    });
    return {
      items: candidates.slice(0, pageSize).map((group) => ({
        id: group.id,
        username: group.username,
        name: group.name,
        permissions: normalizeJsonStringArray(group.permissions),
        level: group.level,
        description: group.description,
        userCount: group._count.users,
        createdAt: group.createTime.toISOString(),
        updatedAt: group.updateTime.toISOString(),
      })),
      page,
      pageSize,
      hasNext: candidates.length > pageSize,
    };
  }

  async listVisibleGroups(
    actorUserId: string,
    options?: { page?: number; pageSize?: number; keyword?: string },
  ): Promise<RamGroupDto[]> {
    if (env.security.iamAuthorizationMode === "enforce")
      return (await this.listVisibleGroupPage(actorUserId, options)).items;
    const actor = await this.getActor(actorUserId);
    const actorGroup = actor.groupId ? await this.groupRepository.findById(actor.groupId) : null;
    const isAdmin = actorGroup?.username === env.security.superAdminGroupUsername;

    const groups = isAdmin
      ? await this.groupRepository.listActiveWithUserCount()
      : await this.groupRepository.listVisibleWithUserCount(actorGroup?.level ?? 0);

    const filtered = options?.keyword
      ? groups.filter(
          (g) => (g.name && g.name.includes(options.keyword!)) || (g.username && g.username.includes(options.keyword!)),
        )
      : groups;

    return filtered.map((g) => ({
      id: g.id,
      username: g.username,
      name: g.name,
      permissions: normalizeJsonStringArray(g.permissions),
      level: g.level,
      description: g.description,
      userCount: g._count?.users,
      createdAt: g.createTime.toISOString(),
      updatedAt: g.updateTime.toISOString(),
    }));
  }

  async createRamUser(actorUserId: string, data: CreateRamUserDto): Promise<RamUserDto> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const enableConsole = data.enableConsole !== false; // 默认 true
    const enableAccessKey = data.enableAccessKey === true; // 默认 false

    if (!enableConsole && !enableAccessKey)
      throw new BadRequestError("至少需要启用一种访问方式（控制台或 AccessKey）", undefined, {
        messageKey: "ram.consoleOrAccessKeyRequired",
      });

    const existing = await this.userRepository.findByUsername(data.username);
    if (existing) throw new BadRequestError("用户名已存在", undefined, { messageKey: "user.usernameExists" });

    if (data.groupId) {
      const group = await this.groupRepository.findById(data.groupId);
      if (!group) throw new NotFoundError("用户组不存在", undefined, { messageKey: "group.notFound" });
      this.assertSameAccount(accountOwnerId, group.accountOwnerId);
      await this.assertGroupDelegation(actorUserId, data.groupId);
    }

    // 仅 AccessKey 或无密码时生成随机密码
    const rawPassword = data.password ?? randomBytes(12).toString("hex");
    const password = await hashPassword(rawPassword);

    const user = await this.userRepository.create({
      username: data.username,
      password,
      email: data.email ?? null,
      name: data.name ?? null,
      groupId: data.groupId ?? null,
      permissionAdds: [],
      permissionRemoves: [],
      accountOwnerId,
      parentUserId: accountOwnerId,
      userType: "ram_user",
      ramUsername: data.ramUsername ?? data.username,
      displayName: data.displayName ?? data.name ?? data.username,
      forcePasswordChange: data.passwordResetRequired ?? false,
    });

    // AccessKey 为该用户创建 AccessKey
    if (enableAccessKey) {
      const key = `${getCredentialPrefix("accessKey")}${randomBytes(32).toString("hex")}`;
      const accessKey = await this.accessKeyRepository.create({
        userId: user.id,
        key,
        name: `RAM-${data.ramUsername ?? data.username}`,
      });
      void this.dispatchNotification(actorUserId, NotificationEvent.RAM_USER_CREATED, {
        subject: "RAM用户已创建",
        summary: `RAM用户 "${data.ramUsername || data.username}" 已成功创建（含 AccessKey）。`,
        userId: user.id,
        ramUsername: data.ramUsername || data.username,
      });
      return this.mapUserToDto(user as AccountScopedUser, accessKey.id, key);
    }

    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_USER_CREATED, {
      subject: "RAM用户已创建",
      summary: `RAM用户 "${data.ramUsername || data.username}" 已成功创建。`,
      userId: user.id,
      ramUsername: data.ramUsername || data.username,
    });
    return this.mapUserToDto(user as AccountScopedUser);
  }

  async updateRamUser(actorUserId: string, userId: string, data: UpdateRamUserDto): Promise<RamUserDto> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError("RAM用户不存在", undefined, { messageKey: "ram.ramUserNotFound" });
    this.assertSameAccount(accountOwnerId, user.accountOwnerId || user.parentUserId);

    if (data.groupId) {
      const group = await this.groupRepository.findById(data.groupId);
      if (!group) throw new NotFoundError("用户组不存在", undefined, { messageKey: "group.notFound" });
      this.assertSameAccount(accountOwnerId, group.accountOwnerId);
      await this.assertGroupDelegation(actorUserId, data.groupId);
    }

    const updateData: Record<string, unknown> = {};
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.name !== undefined) updateData.name = data.name;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.groupId !== undefined) updateData.groupId = data.groupId;

    const updated = await this.userRepository.updateById(userId, updateData);
    return this.mapUserToDto(updated as AccountScopedUser);
  }

  async deleteRamUser(actorUserId: string, userId: string): Promise<void> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError("RAM用户不存在", undefined, { messageKey: "ram.ramUserNotFound" });
    if (user.id === accountOwnerId)
      throw new BadRequestError("不能删除主账号", undefined, { messageKey: "ram.cannotDeleteAccountOwner" });
    this.assertSameAccount(accountOwnerId, user.accountOwnerId || user.parentUserId);
    await this.userRepository.softDelete(userId);

    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_USER_DELETED, {
      subject: "RAM用户已删除",
      summary: `RAM用户 "${user.ramUsername || user.username}" 已被删除。`,
      userId,
      ramUsername: user.ramUsername,
    });
  }

  async listRolesPage(actorUserId: string, query: { page?: number; pageSize?: number } = {}): Promise<RamRolePageDto> {
    const parsed = iamManagementPaginationSchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestError("Invalid IAM entity page", undefined, {
        messageKey: "validation.fieldInvalidValue",
        messageParams: { field: "pagination" },
      });
    const owner = await this.getAccountOwnerId(actorUserId);
    const page = await this.ramRoleRepository.listRolesPage(owner, parsed.data);
    const records =
      env.security.iamAuthorizationMode === "enforce"
        ? await this.filterIamEntityPage(actorUserId, owner, "quyan:ram:role:Read", "role", page.items)
        : page.items;
    const permissions = await this.aggregateRolePermissionsFromPolicies(
      records.map((record) => record.id),
      owner,
    );
    return { ...page, items: records.map((record) => this.mapRoleToDto(record, permissions.get(record.id) ?? [])) };
  }

  async listRoles(actorUserId: string): Promise<RamRoleDto[]> {
    if (env.security.iamAuthorizationMode === "enforce") return (await this.listRolesPage(actorUserId)).items;
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const roles = await this.ramRoleRepository.listRoles(accountOwnerId);
    const roleIds = roles.map((r) => r.id);
    const permissionsMap = await this.aggregateRolePermissionsFromPolicies(roleIds, accountOwnerId);
    return roles.map((role) => this.mapRoleToDto(role, permissionsMap.get(role.id) || []));
  }

  private async aggregateRolePermissionsFromPolicies(
    roleIds: string[],
    accountOwnerId: string,
  ): Promise<Map<string, string[]>> {
    if (roleIds.length === 0) return new Map();
    const attachments = await this.ramPolicyRepository.listPoliciesForTargets("role", roleIds, accountOwnerId);
    const map = new Map<string, string[]>();
    for (const a of attachments) {
      const existing = map.get(a.targetId) || [];
      map.set(a.targetId, [...existing, ...a.permissions]);
    }
    // Deduplicate
    for (const [roleId, perms] of map) {
      map.set(roleId, [...new Set(perms)]);
    }
    return map;
  }

  private async actorIamContext(actorUserId: string) {
    const actor = await this.getActor(actorUserId),
      accountOwnerId = this.resolveAccountOwnerId(actor);
    const request = getRequestContext();
    const principal = request
      ? getIamPrincipal(request)
      : {
          subjectUserId: actor.id,
          principalUserId: actor.id,
          accountOwnerId,
          subjectType: actor.id === accountOwnerId ? ("root" as const) : ("sub_user" as const),
        };
    if (!principal || principal.principalUserId !== actorUserId || principal.accountOwnerId !== accountOwnerId)
      throw new ForbiddenError("Invalid IAM actor context", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    return {
      principal,
      context: request ? requestConditionContext(request, principal) : principalConditionContext(principal),
    };
  }
  private async assertTrustManagementAction(actorUserId: string, roleId?: string): Promise<void> {
    const { principal, context } = await this.actorIamContext(actorUserId);
    const resource = buildAcsResource({
      service: "quyan",
      region: "*",
      accountId: principal.accountOwnerId,
      path: roleId ? "role/" + roleId : "account",
    });
    const result = await IamAuthorizationService.getInstance().authorize({
      principal,
      action: "quyan:ram:UpdateRoleTrustPolicy",
      resource,
      context,
    });
    if (result.decision !== "Allow")
      throw new ForbiddenError("Role trust management denied", undefined, {
        messageKey: "permission.insufficientPermission",
      });
  }
  private async prepareRoleTrust(
    actorUserId: string,
    input: unknown,
    roleId?: string,
  ): Promise<Record<string, unknown>> {
    let parsed;
    try {
      parsed = parseIamTrustPolicy(input);
    } catch {
      throw new BadRequestError("Invalid role trust policy", undefined, { messageKey: "iam.invalidPolicy" });
    }
    const owner = await this.getAccountOwnerId(actorUserId);
    await this.assertTrustManagementAction(actorUserId, roleId);
    try {
      assertIamPolicyAccount(parsed.document, owner);
    } catch {
      throw new BadRequestError("Invalid trust account", undefined, { messageKey: "iam.invalidPolicy" });
    }
    for (const statement of parsed.document.Statement) {
      for (const arn of statement.Principal.RAM) {
        const principalOwner = arn.split(":")[3],
          id = arn.split(":")[4].slice("user/".length);
        const user = await this.userRepository.findById(id);
        if (
          principalOwner !== owner ||
          !user ||
          user.status !== AccountStatus.ACTIVE ||
          (user.accountOwnerId || user.parentUserId || user.id) !== owner
        )
          throw new BadRequestError("Invalid trust principal", undefined, { messageKey: "iam.invalidPolicy" });
      }
    }
    const identity = {
      Version: "1" as const,
      Statement: parsed.document.Statement.map(({ Principal: _principal, ...fields }) => fields),
    };
    if (!(await this.checkPolicyDelegation(actorUserId, identity)).allowed)
      throw new ForbiddenError("Role trust delegation denied", undefined, { messageKey: "iam.delegationDenied" });
    if (roleId) {
      await this.assertRecoveryTarget(actorUserId, "role", roleId, identity);
      await this.assertRoleDelegation(actorUserId, roleId);
    }
    return parsed.document as unknown as Record<string, unknown>;
  }
  async createRole(actorUserId: string, data: CreateRamRoleDto): Promise<RamRoleDto> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const existing = await this.ramRoleRepository.findRoleByName(accountOwnerId, data.name);
    if (existing) throw new BadRequestError("角色名称已存在", undefined, { messageKey: "ram.roleNameExists" });

    const trustPolicy = data.trustPolicy ? await this.prepareRoleTrust(actorUserId, data.trustPolicy) : null;
    const role = await this.ramRoleRepository.createRole({
      accountOwnerId,
      name: data.name,
      description: data.description ?? null,
      trustPolicy,
      maxSessionDuration: data.maxSessionDuration ?? DEFAULT_ROLE_SESSION_DURATION_SECONDS,
    });
    if (trustPolicy)
      auditIamManagement({ actorUserId, accountOwnerId, operation: "create-role-trust", targetId: role.id });
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_ROLE_CREATED, {
      subject: "RAM角色已创建",
      summary: `角色 "${data.name}" 已成功创建。`,
      roleId: role.id,
      roleName: data.name,
    });
    return this.mapRoleToDto(role, []);
  }

  async updateRole(actorUserId: string, roleId: string, data: UpdateRamRoleDto): Promise<RamRoleDto> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const role = await this.ramRoleRepository.findRoleById(roleId);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);

    if (data.expectedTrustPolicyHash !== undefined) {
      let hash: string | null = null;
      try {
        hash = role.trustPolicy ? parseIamTrustPolicy(role.trustPolicy).documentHash : null;
      } catch {
        /* invalid legacy trust is not a valid optimistic baseline */
      }
      if (hash !== data.expectedTrustPolicyHash)
        throw new ConflictError("Role trust policy changed", undefined, { messageKey: "iam.versionConflict" });
    }
    let trustPolicy = data.trustPolicy;
    if (trustPolicy !== undefined) {
      if (trustPolicy === null) {
        if (env.security.iamAuthorizationMode === "enforce")
          throw new BadRequestError("Trust policy required in enforce mode", undefined, {
            messageKey: "iam.invalidPolicy",
          });
        await this.assertTrustManagementAction(actorUserId, roleId);
      } else trustPolicy = await this.prepareRoleTrust(actorUserId, trustPolicy, roleId);
    }
    const { expectedTrustPolicyHash: _expectedHash, ...updates } = data;
    const updated = await this.ramRoleRepository.updateRole(roleId, {
      ...updates,
      ...(trustPolicy === undefined ? {} : { trustPolicy }),
      expectedUpdateTime: role.updateTime,
    });
    if (trustPolicy !== undefined)
      auditIamManagement({ actorUserId, accountOwnerId, operation: "update-role-trust", targetId: roleId });
    const permissions = await this.ramPolicyRepository.listPoliciesForTarget("role", roleId, accountOwnerId);
    return this.mapRoleToDto(
      updated,
      permissions.flatMap((p) => p.permissions),
    );
  }

  async deleteRole(actorUserId: string, roleId: string): Promise<void> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const role = await this.ramRoleRepository.findRoleById(roleId);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);
    await this.ramRoleRepository.softDeleteRole(roleId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_ROLE_DELETED, {
      subject: "RAM角色已删除",
      summary: `角色 "${role.name}" 已被删除。`,
      roleId,
      roleName: role.name,
    });
  }

  async bindRoleToUser(actorUserId: string, roleId: string, userId: string): Promise<void> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const [role, user] = await Promise.all([
      this.ramRoleRepository.findRoleById(roleId),
      this.userRepository.findById(userId),
    ]);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    if (!user) throw new NotFoundError("用户不存在", undefined, { messageKey: "user.notFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);
    this.assertSameAccount(accountOwnerId, user.accountOwnerId || user.parentUserId);
    await this.assertRoleDelegation(actorUserId, roleId, "user", userId);
    await this.ramRoleRepository.bindRoleToUser(accountOwnerId, roleId, userId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_ROLE_BINDING_UPDATED, {
      subject: "角色已绑定到用户",
      summary: `角色 "${role.name}" 已成功绑定到用户。`,
      roleId,
      userId,
    });
  }

  async unbindRoleFromUser(actorUserId: string, roleId: string, userId: string): Promise<void> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const role = await this.ramRoleRepository.findRoleById(roleId);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);
    await this.assertAuthorizationPrincipal(accountOwnerId, "user", userId);
    await this.assertRecoveryTarget(actorUserId, "user", userId);
    await this.ramRoleRepository.unbindRoleFromUser(roleId, userId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_ROLE_BINDING_UPDATED, {
      subject: "角色已从用户解绑",
      summary: `角色 "${role.name}" 已从用户解绑。`,
      roleId,
      userId,
    });
  }

  async bindRoleToGroup(actorUserId: string, roleId: string, groupId: string): Promise<void> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const [role, group] = await Promise.all([
      this.ramRoleRepository.findRoleById(roleId),
      this.groupRepository.findById(groupId),
    ]);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    if (!group) throw new NotFoundError("用户组不存在", undefined, { messageKey: "group.notFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);
    this.assertSameAccount(accountOwnerId, group.accountOwnerId);
    await this.assertRoleDelegation(actorUserId, roleId, "group", groupId);
    await this.ramRoleRepository.bindRoleToGroup(accountOwnerId, roleId, groupId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_ROLE_BINDING_UPDATED, {
      subject: "角色已绑定到用户组",
      summary: `角色 "${role.name}" 已成功绑定到用户组。`,
      roleId,
      groupId,
    });
  }

  async unbindRoleFromGroup(actorUserId: string, roleId: string, groupId: string): Promise<void> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const role = await this.ramRoleRepository.findRoleById(roleId);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);
    await this.assertAuthorizationPrincipal(accountOwnerId, "group", groupId);
    await this.assertRecoveryTarget(actorUserId, "group", groupId);
    await this.ramRoleRepository.unbindRoleFromGroup(roleId, groupId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_ROLE_BINDING_UPDATED, {
      subject: "角色已从用户组解绑",
      summary: `角色 "${role.name}" 已从用户组解绑。`,
      roleId,
      groupId,
    });
  }

  async listRoleBindingPage(
    actorUserId: string,
    roleId: string,
    query: { page?: number; pageSize?: number; userId?: string } = {},
  ): Promise<RamRoleBindingPageDto> {
    const parsed = ramRoleBindingPageQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestError("Invalid role binding page", undefined, {
        messageKey: "validation.fieldInvalidValue",
        messageParams: { field: "pagination" },
      });
    const owner = await this.getAccountOwnerId(actorUserId),
      role = await this.ramRoleRepository.findRoleById(roleId);
    if (!role) throw new NotFoundError("Role missing", undefined, { messageKey: "ram.roleNotFound" });
    this.assertSameAccount(owner, role.accountOwnerId);
    const { page, pageSize, userId } = parsed.data;
    const targetUser = userId ? await this.userRepository.findById(userId) : undefined;
    if (userId && !targetUser) throw new NotFoundError("User missing", undefined, { messageKey: "user.notFound" });
    if (targetUser)
      this.assertSameAccount(owner, targetUser.accountOwnerId || targetUser.parentUserId || targetUser.id);
    const result = await this.ramRoleRepository.listRoleBindingPage(
      owner,
      roleId,
      { page, pageSize },
      targetUser ? { userId: targetUser.id, groupId: targetUser.groupId } : undefined,
    );
    let records = result.items;
    if (env.security.iamAuthorizationMode === "enforce") {
      const { principal, context } = await this.actorIamContext(actorUserId),
        authorization = IamAuthorizationService.getInstance();
      const parent = await authorization.authorize({
        principal,
        action: "quyan:ram:binding:Read",
        context,
        resource: buildAcsResource({ service: "quyan", region: "*", accountId: owner, path: "role/" + roleId }),
      });
      if (parent.decision !== "Allow")
        throw new ForbiddenError("Role binding collection denied", undefined, {
          messageKey: "permission.insufficientPermission",
        });
      records = await authorization.filterAuthorizedPage({
        principal,
        action: "quyan:ram:binding:Read",
        context,
        items: records,
        resource: (binding) =>
          buildAcsResource({
            service: "quyan",
            region: "*",
            accountId: owner,
            path: binding.source + "/" + binding.principalId,
          }),
      });
    }
    const permissions = records.length
      ? ((await this.aggregateRolePermissionsFromPolicies([roleId], owner)).get(roleId) ?? [])
      : [];
    return { ...result, items: records.map((binding) => this.mapBindingToDto({ ...binding, permissions })) };
  }

  async listRoleBindings(actorUserId: string, roleId: string, userId?: string): Promise<RamRoleBindingDto[]> {
    if (env.security.iamAuthorizationMode === "enforce")
      return (await this.listRoleBindingPage(actorUserId, roleId, { userId })).items;
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const role = await this.ramRoleRepository.findRoleById(roleId);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);

    if (!userId) {
      const roleWithBindings = await this.ramRoleRepository.listRoleBindingsByRole(roleId);
      if (!roleWithBindings) return [];
      const policyBindings = await this.ramPolicyRepository.listPoliciesForTarget("role", roleId, accountOwnerId);
      const permissions = [...new Set(policyBindings.flatMap((b) => b.permissions))];
      return [
        ...roleWithBindings.userBindings.map((binding) =>
          this.mapBindingToDto({
            id: binding.id,
            roleId,
            roleName: roleWithBindings.name,
            permissions,
            source: "user",
            principalId: binding.userId,
          }),
        ),
        ...roleWithBindings.groupBindings.map((binding) =>
          this.mapBindingToDto({
            id: binding.id,
            roleId,
            roleName: roleWithBindings.name,
            permissions,
            source: "group",
            principalId: binding.groupId,
          }),
        ),
      ];
    }

    const targetUser = userId
      ? await this.userRepository.findById(userId)
      : await this.userRepository.findById(actorUserId);
    if (!targetUser) throw new NotFoundError("用户不存在", undefined, { messageKey: "user.notFound" });
    this.assertSameAccount(accountOwnerId, targetUser.accountOwnerId || targetUser.parentUserId || targetUser.id);
    const bindings = await this.ramRoleRepository.listRoleBindingsForUser(targetUser.id, targetUser.groupId);
    return bindings.filter((binding) => binding.roleId === roleId).map((binding) => this.mapBindingToDto(binding));
  }

  async assumeRole(actorUserId: string, data: AssumeRamRoleDto): Promise<AssumeRamRoleResponseDto> {
    const validated = assumeRamRoleBodySchema.safeParse(data);
    if (!validated.success)
      throw new BadRequestError("Invalid role session request", undefined, {
        messageKey: "validation.fieldInvalidValue",
        messageParams: { field: "roleSession" },
      });
    data = validated.data;
    const actor = await this.getActor(actorUserId);
    const accountOwnerId = this.resolveAccountOwnerId(actor);
    const role = await this.ramRoleRepository.findRoleById(data.roleId);
    if (!role) throw new NotFoundError("角色不存在", undefined, { messageKey: "ram.roleNotFound" });
    this.assertSameAccount(accountOwnerId, role.accountOwnerId);

    if (env.security.iamAuthorizationMode === "enforce") {
      const { principal, context } = await this.actorIamContext(actorUserId);
      const resource = buildAcsResource({
        service: "quyan",
        region: "*",
        accountId: accountOwnerId,
        path: "role/" + role.id,
      });
      if (principal.subjectType === "assumed_role" || !role.trustPolicy)
        throw new ForbiddenError("Role trust required", undefined, { messageKey: "permission.insufficientPermission" });
      const started = performance.now();
      const identity = await IamAuthorizationService.getInstance().authorize({
        principal,
        action: IAM_ASSUME_ROLE_ACTION,
        resource,
        context,
      });
      let trust;
      try {
        trust = evaluateIamTrustPolicy(role.trustPolicy, { principal, roleArn: resource, context });
      } catch {
        throw new ForbiddenError("Invalid saved role trust", undefined, {
          messageKey: "permission.insufficientPermission",
        });
      }
      const combined = combineIamIdentityAndTrust(identity, trust);
      auditIamDecision({
        principal,
        action: IAM_ASSUME_ROLE_ACTION,
        resource,
        result: combined,
        evaluationLatencyMs: performance.now() - started,
        authorizationMode: "enforce",
        requestId: getRequestContext()?.res?.locals.requestId,
      });
      if (combined.decision !== "Allow")
        throw new ForbiddenError("Role assumption denied", undefined, {
          messageKey: "permission.insufficientPermission",
        });
    } else {
      const bindings = await this.ramRoleRepository.listRoleBindingsForUser(actor.id, actor.groupId);
      if (!bindings.some((binding) => binding.roleId === role.id) && actor.id !== accountOwnerId)
        throw new ForbiddenError("Cannot assume an unbound role", undefined, {
          messageKey: "ram.cannotAssumeUnboundRole",
        });
    }

    const durationSeconds = Math.min(
      data.durationSeconds ?? DEFAULT_ROLE_SESSION_DURATION_SECONDS,
      role.maxSessionDuration,
    );
    const expiresAt = new Date(Date.now() + durationSeconds * 1000);
    const session = await this.ramRoleRepository.createRoleSession({
      accountOwnerId,
      subjectUserId: actor.id,
      roleId: role.id,
      sessionName: data.sessionName ?? `${role.name}-${Date.now()}`,
      expiresAt,
      expectedRoleUpdateTime: role.updateTime,
    });
    auditIamManagement({ actorUserId, accountOwnerId, operation: "assume-role", targetId: session.id });

    const accessToken = JWTAccessIns.generateToken(
      {
        userId: actor.id,
        updatedAt: actor.updateTime.toISOString(),
        status: actor.status,
        principalUserId: actor.id,
        accountOwnerId,
        subjectType: actor.id === accountOwnerId ? "root" : "sub_user",
        assumedRoleId: role.id,
        roleSessionId: session.id,
      },
      durationSeconds,
    );

    return {
      accessToken,
      expiresAt: expiresAt.toISOString(),
      session: this.mapSessionToDto(session),
    };
  }

  async listRoleSessionPage(
    actorUserId: string,
    query: { page?: number; pageSize?: number; principalUserId?: string } = {},
  ): Promise<RamRoleSessionPageDto> {
    const parsed = ramSessionPageQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestError("Invalid role session page", undefined, {
        messageKey: "validation.fieldInvalidValue",
        messageParams: { field: "pagination" },
      });
    const owner = await this.getAccountOwnerId(actorUserId);
    const { page, pageSize, principalUserId } = parsed.data;
    const result = await this.ramRoleRepository.listActiveRoleSessionsPage(owner, { page, pageSize }, principalUserId);
    const records =
      env.security.iamAuthorizationMode === "enforce"
        ? await this.filterIamEntityPage(actorUserId, owner, "quyan:ram:session:Read", "role-session", result.items)
        : result.items;
    return { ...result, items: records.map((session) => this.mapSessionToDto(session)) };
  }

  async listRoleSessions(actorUserId: string, principalUserId?: string): Promise<RamRoleSessionDto[]> {
    if (env.security.iamAuthorizationMode === "enforce")
      return (await this.listRoleSessionPage(actorUserId, { principalUserId })).items;
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const sessions = await this.ramRoleRepository.listActiveRoleSessions(accountOwnerId, principalUserId);
    return sessions.map((session) => this.mapSessionToDto(session));
  }

  async revokeRoleSession(actorUserId: string, sessionId: string): Promise<void> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const session = await this.ramRoleRepository.findActiveRoleSession(sessionId);
    if (!session)
      throw new NotFoundError("角色会话不存在或已过期", undefined, { messageKey: "ram.roleSessionNotFound" });
    this.assertSameAccount(accountOwnerId, session.accountOwnerId);
    await this.ramRoleRepository.revokeRoleSession(sessionId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_ROLE_BINDING_UPDATED, {
      subject: "角色会话已撤销",
      summary: `角色 "${session.role.name}" 的会话已被撤销。`,
      sessionId,
      roleId: session.roleId,
    });
  }

  async getAssumedRoleSession(sessionId: string): Promise<ActiveRamRoleSession | null> {
    return this.ramRoleRepository.findActiveRoleSession(sessionId);
  }

  // ── 权限策略 ──

  private mapPolicyToDto(policy: RamPolicyWithVersion): RamPolicyDto {
    return {
      ...(policy.defaultVersion
        ? {
            document: parseIamPolicy(policy.defaultVersion.document).document,
            defaultVersion: policy.defaultVersion.version,
            documentHash: policy.defaultVersion.documentHash,
          }
        : {}),
      id: policy.id,
      accountOwnerId: policy.accountOwnerId,
      name: policy.name,
      description: policy.description ?? undefined,
      permissions: normalizeJsonStringArray(policy.permissions).filter((permission): permission is Permission =>
        isValidPermission(permission),
      ),
      type: policy.type,
      status: policy.status,
      createTime: policy.createTime.toISOString(),
      updateTime: policy.updateTime.toISOString(),
    };
  }

  private async assertGroupDelegation(actorUserId: string, groupId: string): Promise<void> {
    if (env.security.iamAuthorizationMode !== "enforce") return;
    const owner = await this.getAccountOwnerId(actorUserId);
    for (const policy of await IamAuthorizationService.getInstance().loadGroupPolicies(owner, groupId)) {
      const document = projectScopedPolicyForDelegation(policy);
      if (document && !(await this.checkPolicyDelegation(actorUserId, document)).allowed)
        throw new ForbiddenError("Group membership delegation denied", undefined, {
          messageKey: "iam.delegationDenied",
        });
    }
  }
  private async assertRoleDelegation(
    actorUserId: string,
    roleId: string,
    targetType?: string,
    targetId?: string,
  ): Promise<void> {
    if (env.security.iamAuthorizationMode !== "enforce") return;
    const owner = await this.getAccountOwnerId(actorUserId);
    for (const policy of await IamAuthorizationService.getInstance().loadRolePolicies(owner, roleId)) {
      const projected = projectScopedPolicyForDelegation(policy);
      if (!projected) continue;
      if (targetType && targetId) await this.assertRecoveryTarget(actorUserId, targetType, targetId, projected);
      if (!(await this.checkPolicyDelegation(actorUserId, projected)).allowed)
        throw new ForbiddenError("Role delegation denied", undefined, { messageKey: "iam.delegationDenied" });
    }
    if (targetType && targetId) await this.assertRecoveryTarget(actorUserId, targetType, targetId);
  }
  private async isRecoveryTarget(owner: string, targetType: string, targetId: string): Promise<boolean> {
    if (targetType === "user") return targetId === owner;
    const root = await this.getActor(owner);
    if (targetType === "group") return Boolean(root.groupId && targetId === root.groupId);
    if (targetType === "role")
      return (await this.ramRoleRepository.listRoleBindingsForUser(owner, root.groupId)).some(
        (binding) => binding.roleId === targetId,
      );
    return false;
  }
  private async assertRecoveryTarget(
    actorUserId: string,
    targetType: string,
    targetId: string,
    document?: IamPolicyDocument,
  ): Promise<void> {
    if (env.security.iamAuthorizationMode !== "enforce") return;
    const owner = await this.getAccountOwnerId(actorUserId);
    if (!(await this.isRecoveryTarget(owner, targetType, targetId))) return;
    const principal = getRequestContext() ? getIamPrincipal(getRequestContext()!) : undefined;
    const actingAsOwner = actorUserId === owner && (!getRequestContext() || principal?.subjectType === "root");
    const hasDeny =
      document && parseIamPolicy(document).document.Statement.some((statement) => statement.Effect === "Deny");
    if (!actingAsOwner || hasDeny)
      throw new ForbiddenError("Account recovery authorization cannot be removed or denied", undefined, {
        messageKey: "iam.delegationDenied",
      });
  }
  private async assertRecoveryPolicyMutation(
    actorUserId: string,
    policyId: string,
    document?: IamPolicyDocument,
  ): Promise<void> {
    if (env.security.iamAuthorizationMode !== "enforce") return;
    for (const attachment of await this.ramPolicyRepository.listAttachmentsByPolicy(policyId))
      await this.assertRecoveryTarget(actorUserId, attachment.targetType, attachment.targetId, document);
    for (const relation of await this.authorizationRepository.listForPolicy(policyId))
      await this.assertRecoveryTarget(actorUserId, relation.principalType, relation.principalId, document);
  }
  private async prepareIamVersion(actorUserId: string, document: IamPolicyDocument, policyId?: string) {
    let parsed;
    try {
      parsed = parseIamPolicy(document);
    } catch {
      throw new BadRequestError("Invalid IAM policy", undefined, { messageKey: "iam.invalidPolicy" });
    }
    if (env.security.iamAuthorizationMode !== "enforce")
      throw new ForbiddenError("IAM document management is disabled outside enforce mode", undefined, {
        messageKey: "iam.rolloutRequired",
      });
    if (policyId) await this.assertRecoveryPolicyMutation(actorUserId, policyId, parsed.document);
    if (!(await this.checkPolicyDelegation(actorUserId, parsed.document)).allowed)
      throw new ForbiddenError("IAM document delegation denied", undefined, { messageKey: "iam.delegationDenied" });
    return { document: parsed.document, documentHash: parsed.documentHash, createdBy: actorUserId };
  }
  async checkPolicyDelegation(actorUserId: string, document: IamPolicyDocument) {
    const actor = await this.getActor(actorUserId);
    const owner = this.resolveAccountOwnerId(actor);
    let parsed;
    try {
      parsed = parseIamPolicy(document);
      assertIamPolicyAccount(parsed.document, owner);
    } catch {
      throw new BadRequestError("Invalid policy for delegation", undefined, { messageKey: "iam.invalidPolicy" });
    }
    const request = getRequestContext();
    const principal = request
      ? getIamPrincipal(request)
      : {
          subjectUserId: actor.id,
          principalUserId: actor.id,
          accountOwnerId: owner,
          subjectType: actor.id === owner ? ("root" as const) : ("sub_user" as const),
        };
    if (!principal || principal.principalUserId !== actor.id || principal.accountOwnerId !== owner)
      throw new ForbiddenError("Invalid delegation context", undefined, { messageKey: "iam.delegationDenied" });
    if (principal.subjectType === "root" && actor.userType === "root" && actor.id === owner)
      return { allowed: true, issues: [] };
    const grants = await IamAuthorizationService.getInstance().loadDelegatablePolicies(principal);
    return checkIamDelegation(parsed.document, grants);
  }
  async diagnosePolicy(actorUserId: string, documentText: string, policyKind: "identity" | "trust" = "identity") {
    return diagnoseIamPolicy(documentText, await this.getAccountOwnerId(actorUserId), policyKind);
  }
  async generatePolicyDraft(
    actorUserId: string,
    data: GenerateIamPolicyDraftDto,
    metadata: Pick<ChatTextGenerationOptions, "ipAddress" | "requestId" | "signal"> = {},
  ): Promise<GenerateIamPolicyDraftResponseDto> {
    const validated = generateIamPolicyDraftBodySchema.safeParse(data);
    if (!validated.success)
      throw new BadRequestError("Invalid draft request", undefined, {
        messageKey: "validation.fieldInvalidValue",
        messageParams: { field: "policyDraft" },
      });
    data = validated.data;
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const draftService = IamPolicyDraftService.getInstance();
    const delegationCheck =
      data.policyKind === "trust"
        ? undefined
        : async (document: unknown) => this.checkPolicyDelegation(actorUserId, document as IamPolicyDocument);
    return draftService.generate(actorUserId, accountOwnerId, data, delegationCheck, metadata);
  }

  async validatePolicy(document: IamPolicyDocument) {
    let parsed;
    try {
      parsed = parseIamPolicy(document);
    } catch {
      throw new BadRequestError("Invalid IAM policy", undefined, { messageKey: "iam.invalidPolicy" });
    }
    return {
      valid: true,
      document: parsed.document,
      documentHash: parsed.documentHash,
      broadWildcard: parsed.document.Statement.some(
        (statement) => statement.Action.includes("*") && statement.Resource.includes("*"),
      ),
    };
  }
  async listPolicyVersions(actorUserId: string, policyId: string, options: { page?: number; pageSize?: number } = {}) {
    const pagination = iamVersionPaginationSchema.safeParse(options);
    if (!pagination.success)
      throw new BadRequestError("Invalid IAM history pagination", undefined, {
        messageKey: "validation.fieldInvalidValue",
        messageParams: { field: "pagination" },
      });
    const owner = await this.getAccountOwnerId(actorUserId),
      policy = await this.ramPolicyRepository.findPolicyById(policyId);
    if (!policy) throw new NotFoundError("Policy not found", undefined, { messageKey: "ram.policyNotFound" });
    this.assertSameAccount(owner, policy.accountOwnerId);
    const result = await this.ramPolicyRepository.listVersions(policyId, pagination.data);
    const items = result.items.map((version) => {
      const parsed = parseIamPolicy(version.document);
      if (version.validationState !== "valid" || parsed.documentHash !== version.documentHash)
        throw new ForbiddenError("IAM version integrity check failed", undefined, { messageKey: "iam.invalidPolicy" });
      return {
        id: version.id,
        version: version.version,
        document: parsed.document,
        documentHash: version.documentHash,
        isDefault: version.id === policy.defaultVersionId,
        createdBy: version.createdBy,
        createTime: version.createTime.toISOString(),
      };
    });
    return {
      items,
      total: result.total,
      ...pagination.data,
      defaultVersionId: policy.defaultVersionId ?? undefined,
      defaultDocumentHash: policy.defaultVersion?.documentHash,
    };
  }
  async setDefaultPolicyVersion(
    actorUserId: string,
    policyId: string,
    versionId: string,
    expectedDocumentHash: string,
  ): Promise<void> {
    const owner = await this.getAccountOwnerId(actorUserId),
      policy = await this.ramPolicyRepository.findPolicyById(policyId);
    if (!policy) throw new NotFoundError("Policy not found", undefined, { messageKey: "ram.policyNotFound" });
    this.assertSameAccount(owner, policy.accountOwnerId);
    if (policy.type !== "custom")
      throw new ForbiddenError("Managed policy cannot be changed", undefined, {
        messageKey: "ram.systemManagedPolicyNotModifiable",
      });
    const version = await this.ramPolicyRepository.findVersion(policyId, versionId);
    if (!version) throw new NotFoundError("Policy version not found", undefined, { messageKey: "ram.policyNotFound" });
    await this.prepareIamVersion(actorUserId, parseIamPolicy(version.document).document, policyId);
    await this.ramPolicyRepository.setDefaultVersion(policyId, versionId, expectedDocumentHash);
  }
  async simulatePolicy(
    actorUserId: string,
    principalId: string,
    action: string,
    resource: string,
    documentText?: string,
  ) {
    if (!isKnownIamAction(action) || !isValidIamResource(resource))
      throw new BadRequestError("Invalid IAM simulation input", undefined, { messageKey: "iam.invalidPolicy" });
    const owner = await this.getAccountOwnerId(actorUserId),
      user = await this.getActor(principalId);
    this.assertSameAccount(owner, user.accountOwnerId || user.id);
    const principal = {
      subjectUserId: user.id,
      principalUserId: user.id,
      accountOwnerId: owner,
      subjectType: user.id === owner ? ("root" as const) : ("sub_user" as const),
    };
    const draft = documentText === undefined ? undefined : parseIdentityPolicyDraft(documentText, owner);
    const identity = !isIamResourceInAccount(resource, owner)
      ? { decision: "ImplicitDeny" as const, reason: "invalid-request" as const, matchedStatements: [] }
      : draft === undefined
        ? await IamAuthorizationService.getInstance().authorize({ principal, action, resource })
        : (
            await IamAuthorizationService.getInstance().evaluateLoadedPolicies({
              principal,
              action,
              resources: [resource],
              policies: [{ policyId: "simulation:draft", document: draft }],
            })
          )[0];
    if (action !== IAM_ASSUME_ROLE_ACTION) return identity;
    if (getIamResourceType(resource)?.id !== "quyan/role" || resource.split(":")[4].includes("*"))
      return { decision: "ImplicitDeny" as const, reason: "invalid-request" as const, matchedStatements: [] };
    const role = await this.ramRoleRepository.findRoleById(resource.split(":")[4].slice("role/".length));
    if (!role || role.accountOwnerId !== owner || !role.trustPolicy)
      return {
        decision: "ImplicitDeny" as const,
        reason: "no-matching-allow" as const,
        matchedStatements: identity.matchedStatements,
      };
    try {
      return combineIamIdentityAndTrust(
        identity,
        evaluateIamTrustPolicy(role.trustPolicy, {
          principal,
          roleArn: resource,
          context: principalConditionContext(principal),
        }),
      );
    } catch {
      throw new ForbiddenError("Invalid role trust data", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    }
  }

  getIamActionCatalog(): readonly string[] {
    return IAM_ACTION_CATALOG;
  }

  async listPoliciesPage(
    actorUserId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<RamPolicyPageDto> {
    const parsed = iamManagementPaginationSchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestError("Invalid IAM entity page", undefined, {
        messageKey: "validation.fieldInvalidValue",
        messageParams: { field: "pagination" },
      });
    const owner = await this.getAccountOwnerId(actorUserId);
    const page = await this.ramPolicyRepository.listPoliciesPage(owner, parsed.data);
    const records =
      env.security.iamAuthorizationMode === "enforce"
        ? await this.filterIamEntityPage(actorUserId, owner, "quyan:ram:ReadPolicy", "policy", page.items)
        : page.items;
    return { ...page, items: records.map((record) => this.mapPolicyToDto(record)) };
  }

  async listPolicies(actorUserId: string): Promise<RamPolicyDto[]> {
    if (env.security.iamAuthorizationMode === "enforce") return (await this.listPoliciesPage(actorUserId)).items;
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const policies = await this.ramPolicyRepository.listPolicies(accountOwnerId);
    return policies.map((p) => this.mapPolicyToDto(p));
  }

  async createPolicy(actorUserId: string, data: CreateRamPolicyDto): Promise<RamPolicyDto> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const existing = await this.ramPolicyRepository.findPolicyByName(accountOwnerId, data.name);
    if (existing) throw new BadRequestError("权限策略名称已存在", undefined, { messageKey: "ram.policyNameExists" });
    if ((data.permissions !== undefined) === (data.document !== undefined))
      throw new BadRequestError("Exactly one policy format is required", undefined, {
        messageKey: "iam.invalidPolicy",
      });
    const iamVersion = data.document ? await this.prepareIamVersion(actorUserId, data.document) : undefined;
    const permissions = data.permissions ? await this.assertCanUsePolicyPermissions(actorUserId, data.permissions) : [];

    const policy = await this.ramPolicyRepository.createPolicy({
      accountOwnerId,
      name: data.name,
      description: data.description ?? null,
      permissions,
      iamVersion,
    });
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_POLICY_CREATED, {
      subject: "权限策略已创建",
      summary: `策略 "${data.name}" 已成功创建。`,
      policyId: policy.id,
      policyName: data.name,
    });
    return this.mapPolicyToDto(policy);
  }

  async updatePolicy(actorUserId: string, policyId: string, data: UpdateRamPolicyDto): Promise<RamPolicyDto> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const policy = await this.ramPolicyRepository.findPolicyById(policyId);
    if (!policy) throw new NotFoundError("权限策略不存在", undefined, { messageKey: "ram.policyNotFound" });
    this.assertSameAccount(accountOwnerId, policy.accountOwnerId);
    if (policy.type !== "custom")
      throw new ForbiddenError("System managed policies cannot be modified", undefined, {
        messageKey: "ram.systemManagedPolicyNotModifiable",
      });

    await this.assertRecoveryPolicyMutation(actorUserId, policyId);
    const updateData: UpdateRamPolicyInput = {};
    if (data.description !== undefined) updateData.description = data.description;
    if (data.document !== undefined && data.permissions !== undefined)
      throw new BadRequestError("Cannot mix IAM and legacy policy formats", undefined, {
        messageKey: "iam.invalidPolicy",
      });
    if (data.permissions !== undefined) {
      if (policy.documentFormat === "iam-v1")
        throw new BadRequestError("IAM policy cannot be downgraded to legacy permissions", undefined, {
          messageKey: "iam.invalidPolicy",
        });
      updateData.permissions = await this.assertCanUsePolicyPermissions(actorUserId, data.permissions);
    }
    if (data.document !== undefined) {
      updateData.iamVersion = await this.prepareIamVersion(actorUserId, data.document, policyId);
      updateData.expectedDocumentHash = data.expectedDocumentHash;
      // Preserve legacy shadow permissions for explicit rollback; enforce ignores them for IAM versions.
    }
    if (data.status !== undefined) updateData.status = data.status;

    const updated = await this.ramPolicyRepository.updatePolicy(policyId, updateData);
    return this.mapPolicyToDto(updated);
  }

  async deletePolicy(actorUserId: string, policyId: string): Promise<void> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const policy = await this.ramPolicyRepository.findPolicyById(policyId);
    if (!policy) throw new NotFoundError("权限策略不存在", undefined, { messageKey: "ram.policyNotFound" });
    this.assertSameAccount(accountOwnerId, policy.accountOwnerId);
    if (policy.type === "managed_product_owner")
      throw new ForbiddenError("系统托管的产品所有者策略不可删除", undefined, {
        messageKey: "ram.systemManagedPolicyNotDeletable",
      });
    await this.assertRecoveryPolicyMutation(actorUserId, policyId);
    await this.ramPolicyRepository.softDeletePolicy(policyId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_POLICY_DELETED, {
      subject: "权限策略已删除",
      summary: `策略 "${policy.name}" 已被删除。`,
      policyId,
      policyName: policy.name,
    });
  }

  async attachPolicy(actorUserId: string, data: AttachPolicyBodyDto): Promise<void> {
    const { accountOwnerId, policy } = await this.assertPolicyAttachmentScope(actorUserId, data);
    if (policy.type === "managed_product_owner")
      throw new ForbiddenError("系统托管的产品所有者策略不可重新绑定", undefined, {
        messageKey: "ram.systemManagedPolicyNotRebindable",
      });
    if (policy.documentFormat === "iam-v1") {
      if (
        !policy.defaultVersion ||
        policy.defaultVersionId !== policy.defaultVersion.id ||
        policy.defaultVersion.policyId !== policy.id ||
        policy.defaultVersion.status !== AccountStatus.ACTIVE ||
        policy.defaultVersion.validationState !== "valid" ||
        parseIamPolicy(policy.defaultVersion.document).documentHash !== policy.defaultVersion.documentHash
      )
        throw new BadRequestError("Invalid stored policy", undefined, { messageKey: "iam.invalidPolicy" });
      await this.assertRecoveryTarget(
        actorUserId,
        data.targetType,
        data.targetId,
        parseIamPolicy(policy.defaultVersion.document).document,
      );
      await this.prepareIamVersion(actorUserId, parseIamPolicy(policy.defaultVersion.document).document);
    } else {
      await this.assertRecoveryTarget(actorUserId, data.targetType, data.targetId);
      await this.assertCanUsePolicyPermissions(actorUserId, normalizeJsonStringArray(policy.permissions));
    }

    await this.ramPolicyRepository.attachPolicy(accountOwnerId, data.policyId, data.targetType, data.targetId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_POLICY_ATTACHED, {
      subject: "权限策略已绑定",
      summary: `权限策略 "${policy.name}" 已成功绑定。`,
      policyId: data.policyId,
      targetType: data.targetType,
      targetId: data.targetId,
    });
  }

  async detachPolicy(actorUserId: string, data: AttachPolicyBodyDto): Promise<void> {
    const { policy } = await this.assertPolicyAttachmentScope(actorUserId, data);
    if (policy.type === "managed_product_owner")
      throw new ForbiddenError("系统托管的产品所有者策略不可解绑", undefined, {
        messageKey: "ram.systemManagedPolicyNotUnbindable",
      });

    await this.assertRecoveryTarget(actorUserId, data.targetType, data.targetId);
    await this.ramPolicyRepository.detachPolicy(data.policyId, data.targetType, data.targetId);
    void this.dispatchNotification(actorUserId, NotificationEvent.RAM_POLICY_DETACHED, {
      subject: "权限策略已解绑",
      summary: `权限策略 "${policy.name}" 已成功解绑。`,
      policyId: data.policyId,
      targetType: data.targetType,
      targetId: data.targetId,
    });
  }

  async listPolicyAttachmentPage(
    actorUserId: string,
    policyId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<RamPolicyAttachmentPageDto> {
    const parsed = iamManagementPaginationSchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestError("Invalid policy attachment page", undefined, {
        messageKey: "validation.fieldInvalidValue",
        messageParams: { field: "pagination" },
      });
    const owner = await this.getAccountOwnerId(actorUserId),
      policy = await this.ramPolicyRepository.findPolicyById(policyId);
    if (!policy) throw new NotFoundError("Policy missing", undefined, { messageKey: "ram.policyNotFound" });
    this.assertSameAccount(owner, policy.accountOwnerId);
    const iam = env.security.iamAuthorizationMode === "enforce" ? await this.actorIamContext(actorUserId) : undefined;
    const authorization = IamAuthorizationService.getInstance();
    if (iam) {
      const parent = await authorization.authorize({
        ...iam,
        action: "quyan:ram:ReadPolicy",
        resource: buildAcsResource({ service: "quyan", region: "*", accountId: owner, path: "policy/" + policyId }),
      });
      if (parent.decision !== "Allow")
        throw new ForbiddenError("Policy attachment collection denied", undefined, {
          messageKey: "permission.insufficientPermission",
        });
    }
    const result = await this.ramPolicyRepository.listAttachmentPage(owner, policyId, parsed.data);
    const candidates = await Promise.all(
      result.items.map(async (record) => {
        const target =
          record.targetType === "user"
            ? await this.userRepository.findById(record.targetId)
            : record.targetType === "group"
              ? await this.groupRepository.findById(record.targetId)
              : record.targetType === "role"
                ? await this.ramRoleRepository.findRoleById(record.targetId)
                : undefined;
        if (!target || (record.targetType === "user" ? target.status < 0 : target.status !== 1)) return undefined;
        const targetOwner =
          record.targetType === "user"
            ? target.accountOwnerId || ("parentUserId" in target ? target.parentUserId : undefined) || target.id
            : target.accountOwnerId;
        if (targetOwner !== owner) return undefined;
        const name =
          record.targetType === "user"
            ? ("displayName" in target && target.displayName) ||
              ("ramUsername" in target && target.ramUsername) ||
              ("username" in target && target.username) ||
              target.id
            : target.name || ("username" in target && target.username) || target.id;
        return { ...record, targetName: name as string };
      }),
    );
    const valid = candidates.filter((item): item is NonNullable<typeof item> => Boolean(item));
    let records = valid;
    if (iam) {
      const visible = new Set<string>();
      for (const [type, action] of [
        ["user", "quyan:ram:ReadUser"],
        ["group", "quyan:group:Read"],
        ["role", "quyan:ram:role:Read"],
      ] as const) {
        const items = valid.filter((record) => record.targetType === type);
        const allowed = await authorization.filterAuthorizedPage({
          ...iam,
          action,
          items,
          resource: (record) =>
            buildAcsResource({ service: "quyan", region: "*", accountId: owner, path: type + "/" + record.targetId }),
        });
        allowed.forEach((record) => visible.add(record.id));
      }
      records = valid.filter((record) => visible.has(record.id));
    }
    return {
      ...result,
      items: records.map((record) => ({
        id: record.id,
        accountOwnerId: owner,
        policyId: record.policyId,
        policyName: record.policyName,
        targetType: record.targetType,
        targetId: record.targetId,
        targetName: record.targetName,
        createTime: record.createTime.toISOString(),
      })),
    };
  }

  async listPolicyAttachments(actorUserId: string, policyId: string): Promise<RamPolicyAttachmentDto[]> {
    if (env.security.iamAuthorizationMode === "enforce")
      return (await this.listPolicyAttachmentPage(actorUserId, policyId)).items;
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const policy = await this.ramPolicyRepository.findPolicyById(policyId);
    if (!policy) throw new NotFoundError("权限策略不存在", undefined, { messageKey: "ram.policyNotFound" });
    this.assertSameAccount(accountOwnerId, policy.accountOwnerId);

    const attachments = await this.ramPolicyRepository.listAttachmentsByPolicy(policyId);
    return attachments.map((a) => ({
      id: a.id,
      accountOwnerId,
      policyId: a.policyId,
      policyName: a.policyName,
      targetType: a.targetType,
      targetId: a.targetId,
      targetName: a.targetName ?? undefined,
      createTime: a.createTime.toISOString(),
    }));
  }

  // ── 授权概览 ──

  async getUserEffectivePermissions(actorUserId: string, targetUserId: string): Promise<EffectivePermissionDto> {
    const accountOwnerId = await this.getAccountOwnerId(actorUserId);
    const user = await this.userRepository.findById(targetUserId);
    if (!user) throw new NotFoundError("用户不存在", undefined, { messageKey: "user.notFound" });
    this.assertSameAccount(accountOwnerId, user.accountOwnerId || user.parentUserId || user.id);

    if (env.security.iamAuthorizationMode === "enforce") {
      const projected = await this.permissionService.getUserFullPermissions(user.id);
      if (!projected) throw new NotFoundError("User missing", undefined, { messageKey: "user.notFound" });
      return {
        userId: user.id,
        username: user.username,
        ramUsername: user.ramUsername ?? user.username,
        directPermissions: projected.additionalPermissions,
        groupPermissions: projected.groupPermissions,
        rolePermissions: projected.rolePermissions ?? [],
        policyPermissions: projected.policyPermissions ?? [],
        permissionRemoves: projected.removedPermissions,
        effectivePermissions: projected.effectivePermissions,
        authorizationMode: "enforce",
      };
    }

    // 1. 用户直接权限
    const directPermissions = normalizeJsonStringArray(user.permissionAdds);

    // 2. 用户所属组的权限
    let groupPermissions: string[] = [];
    if (user.groupId) {
      const group = await this.groupRepository.findById(user.groupId);
      if (group && group.status === AccountStatus.ACTIVE)
        groupPermissions = normalizeJsonStringArray(group.permissions);
    }

    // 3. 通过角色绑定的权限
    const roleBindings = await this.ramRoleRepository.listRoleBindingsForUser(user.id, user.groupId);
    const rolePermissions = [...new Set(roleBindings.flatMap((b) => b.permissions))];

    // 4. 通过权限策略绑定的权限
    const policyBindings = await this.ramPolicyRepository.listPoliciesForTarget("user", user.id, accountOwnerId);
    let policyPermissions: string[] = [...new Set(policyBindings.flatMap((b) => b.permissions))];

    // 如果用户有所属组，追加组上绑定的策略权限
    if (user.groupId) {
      const groupPolicyBindings = await this.ramPolicyRepository.listPoliciesForTarget(
        "group",
        user.groupId,
        accountOwnerId,
      );
      policyPermissions = [...new Set([...policyPermissions, ...groupPolicyBindings.flatMap((b) => b.permissions)])];
    }

    // 5. 用户的排除权限
    const permissionRemoves = normalizeJsonStringArray(user.permissionRemoves);

    // 合并去重
    const allPerms = new Set([...directPermissions, ...groupPermissions, ...rolePermissions, ...policyPermissions]);
    const removeSet = new Set(permissionRemoves);
    const effectivePermissions = [...allPerms].filter((p) => !removeSet.has(p));

    return {
      userId: user.id,
      username: user.username,
      ramUsername: user.ramUsername ?? user.username,
      directPermissions,
      groupPermissions,
      rolePermissions,
      policyPermissions,
      permissionRemoves,
      effectivePermissions,
      authorizationMode: env.security.iamAuthorizationMode,
    };
  }
}
