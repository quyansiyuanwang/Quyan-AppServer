import { platformTerminalEntitlementAssignResource } from "@/iam/request/platform-terminal-entitlement-assign-resource-resolver";
import { terminalInstallTokenResource } from "@/iam/request/terminal-install-token-resource-resolver";
import {
  terminalPersonalRegistrationRotationResource,
  terminalManagementRegistrationRotationResource,
} from "@/iam/request/terminal-registration-rotation-resource-resolvers";
import { terminalPersonalUnbindResource } from "@/iam/request/terminal-personal-unbind-resource-resolver";
import {
  platformTerminalRevokeBindingResource,
  platformTerminalDeleteEntitlementResource,
  platformTerminalResetUnbindResource,
} from "@/iam/request/platform-terminal-management-mutation-resource-resolvers";
import {
  Body,
  Controller,
  Delete,
  Get,
  Middlewares,
  Path,
  Post,
  Put,
  Query,
  Request,
  Route,
  Security,
  Tags,
} from "@tsoa/runtime";
import type {
  AssignRemoteTerminalEntitlementRequest,
  ClaimRemoteTerminalProductTemplateRequest,
  CreateRemoteTerminalProductTemplateRequest,
  RemoteTerminalBoundDeviceListResponse,
  RemoteTerminalFilterOptionsDto,
  RemoteTerminalInstallTokenDto,
  RemoteTerminalProductTemplateDto,
  RemoteTerminalProductTemplateListResponse,
  RemoteTerminalRegistrationTokenDto,
  RemoteTerminalUnbindReminderDto,
  RemoteTerminalUserEntitlementDto,
  RemoteTerminalUserEntitlementListResponse,
  RotateRemoteTerminalRegistrationTokenRequest,
  UpdateRemoteTerminalEntitlementRequest,
  UpdateRemoteTerminalProductTemplateRequest,
} from "@/api/dto/remote-terminal/remote-terminal.dto";
import {
  assignRemoteTerminalEntitlementBodySchema,
  claimRemoteTerminalProductTemplateBodySchema,
  entitlementIdParamsSchema,
  listRemoteTerminalDevicesQuerySchema,
  listRemoteTerminalEntitlementsQuerySchema,
  listRemoteTerminalTemplatesQuerySchema,
  listRemoteTerminalTemplateOptionsQuerySchema,
  remoteTerminalDeviceBindingIdParamsSchema,
  remoteTerminalTemplateIdParamsSchema,
  rotateRemoteTerminalRegistrationTokenBodySchema,
  updateRemoteTerminalEntitlementBodySchema,
  updateRemoteTerminalProductTemplateBodySchema,
  createRemoteTerminalProductTemplateBodySchema,
} from "@/api/schema/remote-terminal/remote-terminal.schema";
import {
  platformTerminalTemplateCreateResource,
  platformTerminalTemplateWriteResource,
} from "@/iam/request/platform-terminal-template-write-resource-resolvers";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import type { TypedRequest } from "@/types/express";
import {
  iamAuthenticatedAuthorizationMiddleware,
  iamCollectionAuthorizationMiddleware,
} from "@/iam/middleware/iam-authorization.middleware";
import { iamAuthenticatedUserResourceResolver, ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import { setResponseMessageKey } from "@/util/response-wrapper";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";

@Route("v1/remote-terminal/products")
@Tags("RemoteTerminalProduct")
export class RemoteTerminalProductController extends Controller {
  private readonly remoteTerminalProductService = RemoteTerminalProductService.getInstance();

  @Get("filter-options")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:remote_terminal:ListTemplateOptions",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
    validateQuery(listRemoteTerminalTemplateOptionsQuerySchema),
  )
  public async getFilterOptions(
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() keyword?: string,
    @Request() request?: TypedRequest,
  ): Promise<RemoteTerminalFilterOptionsDto> {
    return this.remoteTerminalProductService.getFilterOptions(page, pageSize, keyword, request);
  }

  @Get("templates/published")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:ListPublishedTemplates",
      resourceKind: "single-resource",
      resource: ramAccountResourceResolver,
    }),
  )
  public async listPublishedTemplates(): Promise<RemoteTerminalProductTemplateDto[]> {
    return this.remoteTerminalProductService.listPublishedTemplates();
  }

  @Get("templates")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:remote_terminal:ListTemplates",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @Middlewares(validateQuery(listRemoteTerminalTemplatesQuerySchema))
  public async listTemplates(
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() status?: number,
    @Query() keyword?: string,
    @Request() request?: TypedRequest,
  ): Promise<RemoteTerminalProductTemplateListResponse> {
    return this.remoteTerminalProductService.listTemplates(page, pageSize, status, keyword, request);
  }

  @Post("templates")
  @Security("jwt")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:CreateTemplate",
      resourceKind: "single-resource",
      resource: platformTerminalTemplateCreateResource,
    }),
  )
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createRemoteTerminalProductTemplateBodySchema),
  )
  public async createTemplate(
    @Body() body: CreateRemoteTerminalProductTemplateRequest,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalProductTemplateDto> {
    return this.remoteTerminalProductService.createTemplate(body, request.user!.userId, request);
  }

  @Put("templates/{id}")
  @Security("jwt")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:UpdateTemplate",
      resourceKind: "single-resource",
      resource: platformTerminalTemplateWriteResource,
    }),
  )
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(remoteTerminalTemplateIdParamsSchema),
    validateBody(updateRemoteTerminalProductTemplateBodySchema),
  )
  public async updateTemplate(
    @Path() id: string,
    @Body() body: UpdateRemoteTerminalProductTemplateRequest,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalProductTemplateDto> {
    return this.remoteTerminalProductService.updateTemplate(id, body, request.user!.userId, request);
  }

  @Post("templates/{id}/publish")
  @Security("jwt")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:PublishTemplate",
      resourceKind: "single-resource",
      resource: platformTerminalTemplateWriteResource,
    }),
  )
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(remoteTerminalTemplateIdParamsSchema),
  )
  public async publishTemplate(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalProductTemplateDto> {
    return this.remoteTerminalProductService.publishTemplate(id, request.user!.userId, request);
  }

  @Post("templates/{id}/unpublish")
  @Security("jwt")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:UnpublishTemplate",
      resourceKind: "single-resource",
      resource: platformTerminalTemplateWriteResource,
    }),
  )
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(remoteTerminalTemplateIdParamsSchema),
  )
  public async unpublishTemplate(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalProductTemplateDto> {
    return this.remoteTerminalProductService.unpublishTemplate(id, request.user!.userId, request);
  }

  @Delete("templates/{id}")
  @Security("jwt")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:DeleteTemplate",
      resourceKind: "single-resource",
      resource: platformTerminalTemplateWriteResource,
    }),
  )
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(remoteTerminalTemplateIdParamsSchema),
  )
  public async deleteTemplate(@Path() id: string, @Request() request: TypedRequest): Promise<{ message: string }> {
    await this.remoteTerminalProductService.deleteTemplate(id, request.user!.userId, request);
    setResponseMessageKey(request, "remoteTerminalProduct.templateDeleted");
    return { message: "Remote terminal product template deleted" };
  }

  @Get("entitlements")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:remote_terminal:ListEntitlements",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
    validateQuery(listRemoteTerminalEntitlementsQuerySchema),
  )
  public async listEntitlements(
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() userId?: string,
    @Query() templateId?: string,
    @Query() status?: number,
    @Request() request?: TypedRequest,
  ): Promise<RemoteTerminalUserEntitlementListResponse> {
    return this.remoteTerminalProductService.listEntitlements(page, pageSize, userId, templateId, status, request);
  }

  @Get("me/entitlements")
  @Security("jwt")
  @Middlewares(
    validateQuery(listRemoteTerminalEntitlementsQuerySchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:ListMyEntitlements",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  public async listCurrentUserEntitlements(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() status?: number,
  ): Promise<RemoteTerminalUserEntitlementListResponse> {
    return this.remoteTerminalProductService.listCurrentUserEntitlements(request.user!.userId, page, pageSize, status);
  }

  @Post("entitlements")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:AssignEntitlement",
      resourceKind: "single-resource",
      resource: platformTerminalEntitlementAssignResource,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(assignRemoteTerminalEntitlementBodySchema),
  )
  public async assignEntitlement(
    @Body() body: AssignRemoteTerminalEntitlementRequest,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalUserEntitlementDto> {
    return this.remoteTerminalProductService.assignEntitlement(body, request.user!.userId, request);
  }

  @Post("me/entitlements/claim")
  @Security("jwt")
  @Middlewares(replayProtectionMiddleware, validateBody(claimRemoteTerminalProductTemplateBodySchema))
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:ClaimPublishedTemplate",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  public async claimPublishedTemplate(
    @Body() body: ClaimRemoteTerminalProductTemplateRequest,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalUserEntitlementDto> {
    return this.remoteTerminalProductService.claimPublishedTemplate(body, request.user!.userId, request);
  }

  @Put("entitlements/{id}")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:UpdateEntitlement",
      resourceKind: "single-resource",
      resource: platformTerminalDeleteEntitlementResource,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(entitlementIdParamsSchema),
    validateBody(updateRemoteTerminalEntitlementBodySchema),
  )
  public async updateEntitlement(
    @Path() id: string,
    @Body() body: UpdateRemoteTerminalEntitlementRequest,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalUserEntitlementDto> {
    return this.remoteTerminalProductService.updateEntitlement(id, body, request.user!.userId, request);
  }

  @Post("entitlements/{id}/reset-unbind-count")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:ResetUnbindCount",
      resourceKind: "single-resource",
      resource: platformTerminalResetUnbindResource,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(entitlementIdParamsSchema),
  )
  public async resetUnbindCount(@Path() id: string, @Request() request: TypedRequest): Promise<{ message: string }> {
    await this.remoteTerminalProductService.resetUnbindCount(id, request.user!.userId, request);
    setResponseMessageKey(request, "remoteTerminalProduct.unbindCountReset");
    return { message: "Device unbind count reset" };
  }

  @Delete("entitlements/{id}")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:DeleteEntitlement",
      resourceKind: "single-resource",
      resource: platformTerminalDeleteEntitlementResource,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(entitlementIdParamsSchema),
  )
  public async deleteEntitlement(@Path() id: string, @Request() request: TypedRequest): Promise<{ message: string }> {
    await this.remoteTerminalProductService.deleteEntitlement(id, request.user!.userId, request);
    setResponseMessageKey(request, "remoteTerminalProduct.entitlementDeleted");
    return { message: "Remote terminal entitlement deleted" };
  }

  @Post("entitlements/{id}/registration-token")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:RotateRegistrationToken",
      resourceKind: "single-resource",
      resource: terminalManagementRegistrationRotationResource,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(entitlementIdParamsSchema),
    validateBody(rotateRemoteTerminalRegistrationTokenBodySchema),
  )
  public async rotateRegistrationToken(
    @Path() id: string,
    @Body() body: RotateRemoteTerminalRegistrationTokenRequest,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalRegistrationTokenDto> {
    return this.remoteTerminalProductService.rotateRegistrationToken(id, body, request.user!.userId, request);
  }

  @Post("me/entitlements/{id}/registration-token")
  @Security("jwt")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(entitlementIdParamsSchema),
    validateBody(rotateRemoteTerminalRegistrationTokenBodySchema),
  )
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:RotateMyRegistrationToken",
      resourceKind: "single-resource",
      resource: terminalPersonalRegistrationRotationResource,
    }),
  )
  public async rotateCurrentUserRegistrationToken(
    @Path() id: string,
    @Body() body: RotateRemoteTerminalRegistrationTokenRequest,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalRegistrationTokenDto> {
    return this.remoteTerminalProductService.rotateCurrentUserRegistrationToken(
      request.user!.userId,
      id,
      body,
      request,
    );
  }

  @Get("me/entitlements/{id}/install-token")
  @Security("jwt")
  @Middlewares(
    validateParams(entitlementIdParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:GetMyInstallToken",
      resourceKind: "single-resource",
      resource: terminalInstallTokenResource,
    }),
  )
  public async getMyInstallToken(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalInstallTokenDto> {
    return this.remoteTerminalProductService.issueInstallToken(request.user!.userId, id, request);
  }

  @Get("devices")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:remote_terminal:ListDeviceBindings",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
    validateQuery(listRemoteTerminalDevicesQuerySchema),
  )
  public async listDevices(
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() userId?: string,
    @Query() entitlementId?: string,
    @Query() status?: number,
    @Request() request?: TypedRequest,
  ): Promise<RemoteTerminalBoundDeviceListResponse> {
    return this.remoteTerminalProductService.listDevices(page, pageSize, userId, entitlementId, status, request);
  }

  @Get("me/devices")
  @Security("jwt")
  @Middlewares(
    validateQuery(listRemoteTerminalDevicesQuerySchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:ListMyDevices",
      resourceKind: "single-resource",
      resource: iamAuthenticatedUserResourceResolver,
    }),
  )
  public async listCurrentUserDevices(
    @Request() request: TypedRequest,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() status?: number,
  ): Promise<RemoteTerminalBoundDeviceListResponse> {
    return this.remoteTerminalProductService.listCurrentUserDevices(request.user!.userId, page, pageSize, status);
  }

  @Get("me/devices/{id}/unbind-reminder")
  @Security("jwt")
  @Middlewares(
    validateParams(remoteTerminalDeviceBindingIdParamsSchema),
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:GetMyUnbindReminder",
      resourceKind: "single-resource",
      resource: terminalPersonalUnbindResource,
    }),
  )
  public async getCurrentUserDeviceUnbindReminder(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalUnbindReminderDto> {
    return this.remoteTerminalProductService.getCurrentUserDeviceUnbindReminder(request.user!.userId, id, request);
  }

  @Delete("devices/{id}")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:RevokeDeviceBinding",
      resourceKind: "single-resource",
      resource: platformTerminalRevokeBindingResource,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(remoteTerminalDeviceBindingIdParamsSchema),
  )
  public async revokeDevice(@Path() id: string, @Request() request: TypedRequest): Promise<{ message: string }> {
    await this.remoteTerminalProductService.adminRevokeDevice(id, request.user!.userId, request);
    setResponseMessageKey(request, "remoteTerminalProduct.deviceRevoked");
    return { message: "Remote terminal device revoked" };
  }

  @Delete("me/devices/{id}")
  @Security("jwt")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:remote_terminal:RevokeMyDeviceBinding",
      resourceKind: "single-resource",
      resource: terminalPersonalUnbindResource,
    }),
  )
  @Middlewares(validateParams(remoteTerminalDeviceBindingIdParamsSchema))
  public async revokeCurrentUserDevice(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ message: string }> {
    await this.remoteTerminalProductService.revokeCurrentUserDevice(request.user!.userId, id, request);
    setResponseMessageKey(request, "remoteTerminalProduct.deviceRevoked");
    return { message: "Remote terminal device revoked" };
  }
}
