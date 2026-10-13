import { PlatformIpMonitoringDashboardIamService } from "@/services/system/platform-ip-monitoring-dashboard-iam.service";
import { PlatformIpBlacklistMutationIamService } from "@/services/system/platform-ip-blacklist-mutation-iam.service";
import { PlatformIpErrorWeightMutationIamService } from "@/services/system/platform-ip-error-weight-mutation-iam.service";
import { PlatformIPBlacklistRecordReadIamService } from "@/services/system/platform-ip-blacklist-record-read-iam.service";
import { PlatformIPBlacklistListIamService } from "@/services/system/platform-ip-blacklist-list-iam.service";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import { PlatformIpAddressReadIamService } from "@/services/system/platform-ip-address-read-iam.service";
import {
  platformIpAddressResourceResolver,
  platformIpBlacklistMutationResourceResolver,
  platformIpBlacklistCreateResourceResolver,
  platformIpBlacklistRecordResourceResolver,
} from "@/iam/request/platform-ip-address-resource-resolvers";
import { iamAuthenticatedAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import {
  Get,
  Path,
  Route,
  Security,
  SuccessResponse,
  Response,
  Tags,
  Controller,
  Request,
  Post,
  Body,
  Put,
  Delete,
  Query,
  Middlewares,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import type {
  CreateIPBlacklistDto,
  UpdateIPBlacklistDto,
  GetAllIPBlacklistsResponse,
  GetIPBlacklistByIdResponse,
  CreateIPBlacklistResponse,
  UpdateIPBlacklistResponse,
  DeleteIPBlacklistResponse,
  CheckIPBlacklistResponse,
  IPBlacklistDto,
  MonitoringDashboardResponse,
  IPErrorStatusResponse,
  SetIpErrorWeightRequest,
} from "@/api/dto/system/ipblacklist.dto";
import { BadRequestError } from "@/util/errors";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import type { TypedRequest } from "@/types/express";
import { getLogger, LogCategory } from "@/util/logger";
import { IPBlackList } from "@/store/security/ipblacklist";
import type { ErrorResponse } from "@/api/response";
import {
  createIPBlacklistBodySchema,
  ipAddressParamsSchema,
  ipBlacklistIdParamsSchema,
  ipBlacklistListQuerySchema,
  ipParamsSchema,
  setIpErrorWeightBodySchema,
  updateIPBlacklistBodySchema,
} from "@/api/schema/system/ipblacklist.schema";
import { validateBody, validateParams, validateQuery } from "@/middleware/validation";
import { replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";
import { TwoFactorChallengeProtected, twoFactorChallengeMiddleware } from "@/util/two-factor-challenge-decorator";
import { setResponseMessageKey } from "@/util/response-wrapper";

const logger = getLogger("IPBlacklistController", LogCategory.BUSINESS);

/**
 * IP 黑名单管理相关接口
 */
@Route("v1/ip-blacklist")
@Tags("IP Blacklist")
@Response<ValidationErrorResponse>(HttpStatusCode.UnprocessableEntity, "参数验证失败")
export class IPBlacklistController extends Controller {
  /**
   * 将 Prisma 模型转换为 DTO
   */
  private toDto(blacklist: IPBlackList): IPBlacklistDto {
    return {
      id: blacklist.id,
      ipAddress: blacklist.ipAddress,
      expireTime: blacklist.ExpireTime?.toISOString() || "",
      banLevel: blacklist.banLevel,
      banReason: blacklist.reason || "",
      bannedBy: blacklist.bannedBy,
      errorCount: 0,
      metadata: {},
      status: blacklist.status,
      createTime: blacklist.createTime.toISOString(),
      updateTime: blacklist.updateTime.toISOString(),
    };
  }

  /**
   * 获取所有 IP 黑名单
   * @summary 获取 IP 黑名单列表
   * @returns IP 黑名单列表和总数
   */
  @Get("")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:ip_blacklist:ListBlacklists",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
    validateQuery(ipBlacklistListQuerySchema),
  )
  public async getAllIPBlacklists(
    @Request() request: TypedRequest,
    @Query() limit?: number,
    @Query() offset?: number,
  ): Promise<GetAllIPBlacklistsResponse> {
    const result = await PlatformIPBlacklistListIamService.getInstance().list(limit ?? 100, offset ?? 0, request);

    return {
      blacklists: result.blacklists.map((b) => this.toDto(b)),
      total: result.total,
    };
  }

  /**
   * 根据 ID 获取 IP 黑名单
   * @summary 获取 IP 黑名单详情
   * @param id IP 黑名单 ID
   * @returns IP 黑名单详情
   */
  @Get("{id}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "IP 黑名单不存在")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:ip_blacklist:GetBlacklist",
      resourceKind: "single-resource",
      resource: platformIpBlacklistRecordResourceResolver,
    }),
    validateParams(ipBlacklistIdParamsSchema),
  )
  public async getIPBlacklistById(
    @Path("id") id: string,
    @Request() request: TypedRequest,
  ): Promise<GetIPBlacklistByIdResponse> {
    return this.toDto(await PlatformIPBlacklistRecordReadIamService.getInstance().read(id, request));
  }

  /**
   * 手动封禁 IP
   * @summary 手动封禁 IP 地址
   * @param body 封禁信息
   * @returns 创建的黑名单记录
   */
  @Post("")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Created, "Created")
  @Response<ErrorResponse>(HttpStatusCode.BadRequest, "请求参数错误")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:ip_blacklist:CreateBlacklist",
      resourceKind: "single-resource",
      resource: platformIpBlacklistCreateResourceResolver,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateBody(createIPBlacklistBodySchema),
  )
  public async createIPBlacklist(
    @Body() body: CreateIPBlacklistDto,
    @Request() request: TypedRequest,
  ): Promise<CreateIPBlacklistResponse> {
    const userId = request.user?.userId;
    if (!userId) throw new BadRequestError("无法获取用户信息", undefined, { messageKey: "ipBlacklist.userMissing" });

    const blacklist = await PlatformIpBlacklistMutationIamService.getInstance().create(body, request);

    logger.info(`IP ${body.ipAddress} manually banned by user ${userId}`);

    this.setStatus(HttpStatusCode.Created);
    return this.toDto(blacklist);
  }

  /**
   * 更新 IP 黑名单
   * @summary 更新 IP 黑名单信息
   * @param ipAddress IP 地址
   * @param body 更新信息
   * @returns 更新后的黑名单记录
   */
  @Put("{ipAddress}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "IP 黑名单不存在")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:ip_blacklist:UpdateBlacklist",
      resourceKind: "single-resource",
      resource: platformIpBlacklistMutationResourceResolver,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ipAddressParamsSchema),
    validateBody(updateIPBlacklistBodySchema),
  )
  public async updateIPBlacklist(
    @Path() ipAddress: string,
    @Body() body: UpdateIPBlacklistDto,
    @Request() request: TypedRequest,
  ): Promise<UpdateIPBlacklistResponse> {
    const updated = await PlatformIpBlacklistMutationIamService.getInstance().update(ipAddress, body, request);

    logger.info(`IP blacklist ${ipAddress} updated by user ${request.user?.userId}`);

    return this.toDto(updated);
  }

  /**
   * 解除 IP 封禁
   * @summary 解除 IP 封禁
   * @param ipAddress IP 地址
   * @returns 删除结果
   */
  @Delete("{ipAddress}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.NotFound, "IP 黑名单不存在")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:ip_blacklist:DeleteBlacklist",
      resourceKind: "single-resource",
      resource: platformIpBlacklistMutationResourceResolver,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ipAddressParamsSchema),
  )
  public async deleteIPBlacklist(
    @Path() ipAddress: string,
    @Request() request: TypedRequest,
  ): Promise<DeleteIPBlacklistResponse> {
    const userId = request.user?.userId;
    if (!userId) throw new BadRequestError("无法获取用户信息", undefined, { messageKey: "ipBlacklist.userMissing" });

    await PlatformIpBlacklistMutationIamService.getInstance().remove(ipAddress, request);

    logger.info(`IP ${ipAddress} unbanned by user ${userId}`);

    setResponseMessageKey(request, "common.success");
    return { success: true };
  }

  /**
   * 检查 IP 是否被封禁
   * @summary 检查 IP 是否在黑名单中
   * @param ip IP 地址
   * @returns 封禁状态和详情
   */
  @Get("check/{ip}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:ip_blacklist:CheckIPAddress",
      resourceKind: "single-resource",
      resource: platformIpAddressResourceResolver,
    }),
    validateParams(ipParamsSchema),
  )
  public async checkIPBlacklist(
    @Path() ip: string,
    @Request() request: TypedRequest,
  ): Promise<CheckIPBlacklistResponse> {
    const { isBlacklisted, blacklistInfo } = await PlatformIpAddressReadIamService.getInstance().check(ip, request);

    return {
      isBlacklisted,
      blacklistInfo: blacklistInfo ? this.toDto(blacklistInfo) : null,
    };
  }

  /**
   * 获取 IP 实时错误状态
   * @summary 查询 IP 当前错误权重和等级
   * @param ip IP 地址
   * @returns IP 错误状态
   */
  @Get("error-status/{ip}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:ip_blacklist:GetIPAddressErrorStatus",
      resourceKind: "single-resource",
      resource: platformIpAddressResourceResolver,
    }),
    validateParams(ipParamsSchema),
  )
  public async getIpErrorStatus(@Path() ip: string, @Request() request: TypedRequest): Promise<IPErrorStatusResponse> {
    return PlatformIpAddressReadIamService.getInstance().errorStatus(ip, request);
  }

  /**
   * 重置 IP 错误权重
   * @summary 清除 IP 的错误权重计数
   * @param ip IP 地址
   */
  @Delete("error-status/{ip}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:ip_blacklist:ResetIPAddressErrorWeight",
      resourceKind: "single-resource",
      resource: platformIpAddressResourceResolver,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ipParamsSchema),
  )
  public async resetIpErrorWeight(
    @Path() ip: string,
    @Request() request: TypedRequest,
  ): Promise<DeleteIPBlacklistResponse> {
    await PlatformIpErrorWeightMutationIamService.getInstance().reset(ip, request);
    setResponseMessageKey(request, "common.success");
    return { success: true };
  }

  /**
   * 设置 IP 错误权重
   * @summary 将 IP 的错误权重设置为指定值
   * @param ip IP 地址
   * @param body 权重值
   */
  @Put("error-status/{ip}")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:ip_blacklist:SetIPAddressErrorWeight",
      resourceKind: "single-resource",
      resource: platformIpAddressResourceResolver,
    }),
  )
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ipParamsSchema),
    validateBody(setIpErrorWeightBodySchema),
  )
  public async setIpErrorWeight(
    @Path() ip: string,
    @Body() body: SetIpErrorWeightRequest,
    @Request() request: TypedRequest,
  ): Promise<DeleteIPBlacklistResponse> {
    await PlatformIpErrorWeightMutationIamService.getInstance().set(ip, body.weight, request);
    setResponseMessageKey(request, "common.success");
    return { success: true };
  }

  /**
   * 获取监控面板数据
   * @summary 获取 IP 封禁监控面板数据
   * @returns 监控面板数据
   */
  @Get("monitoring/dashboard")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Ok, "Success")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(
    iamAuthenticatedAuthorizationMiddleware({
      action: "quyan:system:ip_blacklist:GetMonitoringDashboard",
      resourceKind: "collection",
      resource: ramAccountResourceResolver,
    }),
  )
  public async getMonitoringDashboard(@Request() request: TypedRequest): Promise<MonitoringDashboardResponse> {
    return PlatformIpMonitoringDashboardIamService.getInstance().read(request);
  }
}
