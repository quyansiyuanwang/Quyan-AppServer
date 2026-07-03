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
  remoteTerminalDeviceBindingIdParamsSchema,
  remoteTerminalTemplateIdParamsSchema,
  rotateRemoteTerminalRegistrationTokenBodySchema,
  updateRemoteTerminalEntitlementBodySchema,
  updateRemoteTerminalProductTemplateBodySchema,
  createRemoteTerminalProductTemplateBodySchema,
} from "@/api/schema/remote-terminal/remote-terminal.schema";
import { Permission } from "@/constant/permission";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import type { TypedRequest } from "@/types/express";
import { RequireAnyPermission, RequirePermission } from "@/util/permission/permission-decorator";
import { setResponseMessage } from "@/util/response-wrapper";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";

@Route("v1/remote-terminal/products")
@Tags("RemoteTerminalProduct")
export class RemoteTerminalProductController extends Controller {
  private readonly remoteTerminalProductService = RemoteTerminalProductService.getInstance();

  @Get("filter-options")
  @Security("jwt")
  @RequireAnyPermission([
    Permission.REMOTE_TERMINAL_PRODUCT_READ,
    Permission.REMOTE_TERMINAL_ASSIGNMENT_READ,
    Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ,
  ])
  public async getFilterOptions(): Promise<RemoteTerminalFilterOptionsDto> {
    return this.remoteTerminalProductService.getFilterOptions();
  }

  @Get("templates/published")
  @Security("jwt")
  public async listPublishedTemplates(): Promise<RemoteTerminalProductTemplateDto[]> {
    return this.remoteTerminalProductService.listPublishedTemplates();
  }

  @Get("templates")
  @Security("jwt")
  @RequirePermission(Permission.REMOTE_TERMINAL_PRODUCT_READ)
  @Middlewares(validateQuery(listRemoteTerminalTemplatesQuerySchema))
  public async listTemplates(
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() status?: number,
    @Query() keyword?: string,
  ): Promise<RemoteTerminalProductTemplateListResponse> {
    return this.remoteTerminalProductService.listTemplates(page, pageSize, status, keyword);
  }

  @Post("templates")
  @Security("jwt")
  @RequirePermission(Permission.REMOTE_TERMINAL_PRODUCT_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
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
  @RequirePermission(Permission.REMOTE_TERMINAL_PRODUCT_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
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
  @RequirePermission(Permission.REMOTE_TERMINAL_PRODUCT_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
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
  @RequirePermission(Permission.REMOTE_TERMINAL_PRODUCT_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
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
  @RequirePermission(Permission.REMOTE_TERMINAL_PRODUCT_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(remoteTerminalTemplateIdParamsSchema),
  )
  public async deleteTemplate(@Path() id: string, @Request() request: TypedRequest): Promise<{ message: string }> {
    await this.remoteTerminalProductService.deleteTemplate(id, request.user!.userId, request);
    setResponseMessage(request, "Remote terminal product template deleted");
    return { message: "Remote terminal product template deleted" };
  }

  @Get("entitlements")
  @Security("jwt")
  @RequirePermission(Permission.REMOTE_TERMINAL_ASSIGNMENT_READ)
  @Middlewares(validateQuery(listRemoteTerminalEntitlementsQuerySchema))
  public async listEntitlements(
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() userId?: string,
    @Query() templateId?: string,
    @Query() status?: number,
  ): Promise<RemoteTerminalUserEntitlementListResponse> {
    return this.remoteTerminalProductService.listEntitlements(page, pageSize, userId, templateId, status);
  }

  @Get("me/entitlements")
  @Security("jwt")
  @Middlewares(validateQuery(listRemoteTerminalEntitlementsQuerySchema))
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
  @RequirePermission(Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE)
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
  public async claimPublishedTemplate(
    @Body() body: ClaimRemoteTerminalProductTemplateRequest,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalUserEntitlementDto> {
    return this.remoteTerminalProductService.claimPublishedTemplate(body, request.user!.userId, request);
  }

  @Put("entitlements/{id}")
  @Security("jwt")
  @RequirePermission(Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE)
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
  @RequirePermission(Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(entitlementIdParamsSchema),
  )
  public async resetUnbindCount(@Path() id: string, @Request() request: TypedRequest): Promise<{ message: string }> {
    await this.remoteTerminalProductService.resetUnbindCount(id, request.user!.userId, request);
    setResponseMessage(request, "Device unbind count reset");
    return { message: "Device unbind count reset" };
  }

  @Delete("entitlements/{id}")
  @Security("jwt")
  @RequirePermission(Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(entitlementIdParamsSchema),
  )
  public async deleteEntitlement(@Path() id: string, @Request() request: TypedRequest): Promise<{ message: string }> {
    await this.remoteTerminalProductService.deleteEntitlement(id, request.user!.userId, request);
    setResponseMessage(request, "Remote terminal entitlement deleted");
    return { message: "Remote terminal entitlement deleted" };
  }

  @Post("entitlements/{id}/registration-token")
  @Security("jwt")
  @RequirePermission(Permission.REMOTE_TERMINAL_REGISTRATION_TOKEN_WRITE)
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
  @Middlewares(validateParams(entitlementIdParamsSchema))
  public async getMyInstallToken(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalInstallTokenDto> {
    return this.remoteTerminalProductService.issueInstallToken(request.user!.userId, id);
  }

  @Get("devices")
  @Security("jwt")
  @RequirePermission(Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ)
  @Middlewares(validateQuery(listRemoteTerminalDevicesQuerySchema))
  public async listDevices(
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() userId?: string,
    @Query() entitlementId?: string,
    @Query() status?: number,
  ): Promise<RemoteTerminalBoundDeviceListResponse> {
    return this.remoteTerminalProductService.listDevices(page, pageSize, userId, entitlementId, status);
  }

  @Get("me/devices")
  @Security("jwt")
  @Middlewares(validateQuery(listRemoteTerminalDevicesQuerySchema))
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
  @Middlewares(validateParams(remoteTerminalDeviceBindingIdParamsSchema))
  public async getCurrentUserDeviceUnbindReminder(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalUnbindReminderDto> {
    return this.remoteTerminalProductService.getCurrentUserDeviceUnbindReminder(request.user!.userId, id);
  }

  @Delete("devices/{id}")
  @Security("jwt")
  @RequirePermission(Permission.REMOTE_TERMINAL_DEVICE_WRITE)
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(remoteTerminalDeviceBindingIdParamsSchema),
  )
  public async revokeDevice(@Path() id: string, @Request() request: TypedRequest): Promise<{ message: string }> {
    await this.remoteTerminalProductService.adminRevokeDevice(id, request.user!.userId, request);
    setResponseMessage(request, "Remote terminal device revoked");
    return { message: "Remote terminal device revoked" };
  }

  @Delete("me/devices/{id}")
  @Security("jwt")
  @RequireAnyPermission([
    Permission.REMOTE_TERMINAL_DEVICE_READ,
    Permission.REMOTE_TERMINAL_SESSION_CREATE,
    Permission.REMOTE_TERMINAL_SESSION_READ,
  ])
  @Middlewares(validateParams(remoteTerminalDeviceBindingIdParamsSchema))
  public async revokeCurrentUserDevice(
    @Path() id: string,
    @Request() request: TypedRequest,
  ): Promise<{ message: string }> {
    await this.remoteTerminalProductService.revokeCurrentUserDevice(request.user!.userId, id, request);
    setResponseMessage(request, "Remote terminal device revoked");
    return { message: "Remote terminal device revoked" };
  }
}
