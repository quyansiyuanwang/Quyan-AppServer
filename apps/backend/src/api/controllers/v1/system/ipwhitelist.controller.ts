import {
  Get,
  Route,
  Security,
  SuccessResponse,
  Response,
  Tags,
  Controller,
  Request,
  Post,
  Body,
  Delete,
  Query,
  Path,
  Middlewares,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import type {
  CreateIPWhitelistDto,
  GetAllIPWhitelistsResponse,
  CreateIPWhitelistResponse,
  DeleteIPWhitelistResponse,
  CheckIPWhitelistResponse,
  IPWhitelistDto,
} from "@/api/dto/system/ipwhitelist.dto";
import { Permission } from "@/constant/permission";
import { BadRequestError, NotFoundError } from "@/util/errors";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import type { TypedRequest } from "@/types/express";
import { CheckPermission, PermissionCheckMode } from "@/util/permission/permission-decorator";
import { iamCollectionAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import {
  platformIpWhitelistStatusResource,
  platformIpWhitelistCreateResource,
  platformIpWhitelistDeleteResource,
} from "@/iam/request/platform-ip-whitelist-resource-resolvers";
import { IPWhiteListService } from "@/services/system/ipwhitelist.service";
import { IPWhiteList } from "@/store/security/ipwhitelist";
import {
  createIPWhitelistBodySchema,
  ipWhitelistIpParamsSchema,
  ipWhitelistListQuerySchema,
} from "@/api/schema/system/ipwhitelist.schema";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";

@Route("v1/ip-whitelist")
@Tags("IP Whitelist")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class IPWhitelistController extends Controller {
  private service = IPWhiteListService.getInstance();

  private toDto(r: IPWhiteList): IPWhitelistDto {
    return {
      id: r.id,
      ipAddress: r.ipAddress,
      reason: r.reason ?? undefined,
      addedBy: r.addedBy ?? undefined,
      expiresAt: r.expiresAt?.toISOString(),
      createTime: r.createTime.toISOString(),
      updateTime: r.updateTime.toISOString(),
    };
  }

  /** 获取白名单列表 */
  @Get("/list")
  @Security("jwt")
  @Middlewares(
    iamCollectionAuthorizationMiddleware({
      action: "quyan:ip_whitelist:ListEntries",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  @Middlewares(validateQuery(ipWhitelistListQuerySchema))
  public async getAllIPWhitelists(
    @Request() request: TypedRequest,
    @Query() limit?: number,
    @Query() offset?: number,
  ): Promise<GetAllIPWhitelistsResponse> {
    const { whitelists, total } = await this.service.listManaged(limit, offset, request);
    return { whitelists: whitelists.map((whitelist) => this.toDto(whitelist)), total };
  }

  /** 检查 IP 是否在白名单 */
  @Get("/exists/{ip}")
  @Security("jwt")
  @CheckPermission(Permission.IP_WHITELIST_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ip_whitelist:GetStatus",
    resourceKind: "single-resource",
    resource: platformIpWhitelistStatusResource,
  })
  @Middlewares(validateParams(ipWhitelistIpParamsSchema))
  public async isExistsWhiteIp(
    @Path() ip: string,
    @Request() request: TypedRequest,
  ): Promise<CheckIPWhitelistResponse> {
    const isWhitelisted = await this.service.isManagedWhitelisted(ip, request);
    return { isWhitelisted };
  }

  /** 添加 IP 到白名单 */
  @Post("/add")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Created, "Created")
  @CheckPermission(Permission.IP_WHITELIST_CREATE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ip_whitelist:CreateEntry",
    resourceKind: "collection",
    resource: platformIpWhitelistCreateResource,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createIPWhitelistBodySchema),
  )
  public async addWhiteIp(
    @Body() body: CreateIPWhitelistDto,
    @Request() request: TypedRequest,
  ): Promise<CreateIPWhitelistResponse> {
    if (!body.ipAddress)
      throw new BadRequestError("IP 地址不能为空", undefined, { messageKey: "ipWhitelist.ipRequired" });
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
    const record = await this.service.addManaged(
      body.ipAddress,
      body.reason ?? "",
      request.user!.userId,
      expiresAt,
      request,
    );
    this.setStatus(HttpStatusCode.Created);
    return { whitelist: this.toDto(record) };
  }

  /** 从白名单移除 IP */
  @Delete("/remove/{ip}")
  @Security("jwt")
  @CheckPermission(Permission.IP_WHITELIST_DELETE, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ip_whitelist:DeleteEntry",
    resourceKind: "single-resource",
    resource: platformIpWhitelistDeleteResource,
  })
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ipWhitelistIpParamsSchema),
  )
  public async removeWhiteIp(@Path() ip: string, @Request() request: TypedRequest): Promise<DeleteIPWhitelistResponse> {
    const success = await this.service.removeManaged(ip, request.user!.userId, request);
    if (!success)
      throw new NotFoundError(`IP ${ip} 不在白名单中`, undefined, {
        messageKey: "ipWhitelist.notFoundByIp",
        messageParams: { ip },
      });
    return { success };
  }
}
