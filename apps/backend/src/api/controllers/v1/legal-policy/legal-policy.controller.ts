import { iamCollectionAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import {
  platformLegalPolicyDetailResource,
  platformLegalPolicyCreateResource,
  platformLegalPolicyUpdateResource,
  platformLegalPolicyDeleteResource,
  platformLegalPolicyPublishResources,
  platformLegalPolicyUnpublishResources,
} from "@/iam/request/platform-legal-policy-resource-resolvers";
import {
  Body,
  Controller,
  Delete,
  Get,
  Middlewares,
  Path,
  Post,
  Put,
  Request,
  Route,
  Security,
  Tags,
} from "@tsoa/runtime";
import type { TypedRequest } from "@/types/express.d";
import { CheckPermission, PermissionCheckMode } from "@/util/permission/permission-decorator";
import { Permission } from "@/constant/permission";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams } from "@/middleware/validation";
import {
  createLegalPolicyBodySchema,
  legalPolicyIdParamsSchema,
  updateLegalPolicyBodySchema,
} from "@/api/schema/legal-policy/legal-policy.schema";
import type {
  CreateLegalPolicyDto,
  LegalPolicyDto,
  LegalPolicyListItemDto,
  UpdateLegalPolicyDto,
} from "@/api/dto/legal-policy/legal-policy.dto";
import { LegalPolicyService } from "@/services/legal-policy/legal-policy.service";

@Route("v1/legal-policies")
@Tags("Legal Policy Management")
export class LegalPolicyController extends Controller {
  private service = LegalPolicyService.getInstance();

  @Post("")
  @Security("jwt")
  @CheckPermission(Permission.LEGAL_POLICY_CREATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:legal_policy:CreateVersion",
    resourceKind: "collection",
    resource: platformLegalPolicyCreateResource,
  })
  @Middlewares(replayProtectionMiddleware, validateBody(createLegalPolicyBodySchema))
  public async createPolicy(
    @Body() body: CreateLegalPolicyDto,
    @Request() request: TypedRequest,
  ): Promise<LegalPolicyDto> {
    return this.service.createPolicy(body, request.user!.userId, request);
  }

  @Get("")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:legal_policy:ListVersions",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  public async listPolicies(@Request() request: TypedRequest): Promise<LegalPolicyListItemDto[]> {
    return this.service.listManagedPolicies(request);
  }

  @Get("{id}")
  @Security("jwt")
  @CheckPermission(Permission.LEGAL_POLICY_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:legal_policy:GetVersion",
    resourceKind: "single-resource",
    resource: platformLegalPolicyDetailResource,
  })
  @Middlewares(validateParams(legalPolicyIdParamsSchema))
  public async getPolicy(@Path() id: string, @Request() request: TypedRequest): Promise<LegalPolicyDto> {
    return this.service.getManagedPolicy(id, request);
  }

  @Put("{id}")
  @Security("jwt")
  @CheckPermission(Permission.LEGAL_POLICY_UPDATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:legal_policy:UpdateVersion",
    resourceKind: "single-resource",
    resource: platformLegalPolicyUpdateResource,
  })
  @Middlewares(
    replayProtectionMiddleware,
    validateParams(legalPolicyIdParamsSchema),
    validateBody(updateLegalPolicyBodySchema),
  )
  public async updatePolicy(
    @Path() id: string,
    @Body() body: UpdateLegalPolicyDto,
    @Request() request: TypedRequest,
  ): Promise<LegalPolicyDto> {
    return this.service.updatePolicy(id, body, request.user!.userId, request);
  }

  @Delete("{id}")
  @Security("jwt")
  @CheckPermission(Permission.LEGAL_POLICY_DELETE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:legal_policy:DeleteVersion",
    resourceKind: "single-resource",
    resource: platformLegalPolicyDeleteResource,
  })
  @Middlewares(replayProtectionMiddleware, validateParams(legalPolicyIdParamsSchema))
  public async deletePolicy(@Path() id: string, @Request() request: TypedRequest): Promise<{ success: boolean }> {
    await this.service.deletePolicy(id, request.user!.userId, request);
    return { success: true };
  }

  @Post("{id}/publish")
  @Security("jwt")
  @CheckPermission(Permission.LEGAL_POLICY_PUBLISH, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:legal_policy:PublishVersion",
    resourceKind: "batch",
    resource: platformLegalPolicyPublishResources,
  })
  @Middlewares(replayProtectionMiddleware, validateParams(legalPolicyIdParamsSchema))
  public async publishPolicy(@Path() id: string, @Request() request: TypedRequest): Promise<LegalPolicyDto> {
    return this.service.changeManagedPublication("PublishVersion", id, request.user!.userId, request);
  }

  @Post("{id}/unpublish")
  @Security("jwt")
  @CheckPermission(Permission.LEGAL_POLICY_PUBLISH, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:legal_policy:UnpublishVersion",
    resourceKind: "batch",
    resource: platformLegalPolicyUnpublishResources,
  })
  @Middlewares(replayProtectionMiddleware, validateParams(legalPolicyIdParamsSchema))
  public async unpublishPolicy(@Path() id: string, @Request() request: TypedRequest): Promise<LegalPolicyDto> {
    return this.service.changeManagedPublication("UnpublishVersion", id, request.user!.userId, request);
  }
}
