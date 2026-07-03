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
import { Permission } from "@/constant/permission";
import { NotFoundError, BadRequestError } from "@/util/errors";
import type { ValidationErrorResponse } from "@/api/dto/common/common.dto";
import type { TypedRequest } from "@/types/express";
import { getLogger, LogCategory } from "@/util/logger";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { IPBlackListService } from "@/services/system/ipblacklist.service";
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
  private ipBlacklistService = IPBlackListService.getInstance();

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
  @RequirePermission(Permission.IP_BLACKLIST_READ)
  @Middlewares(validateQuery(ipBlacklistListQuerySchema))
  public async getAllIPBlacklists(
    @Request() request: TypedRequest,
    @Query() limit?: number,
    @Query() offset?: number,
  ): Promise<GetAllIPBlacklistsResponse> {
    const result = await this.ipBlacklistService.getBlacklist({
      limit: limit || 100,
      offset: offset || 0,
    });

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
  @RequirePermission(Permission.IP_BLACKLIST_READ)
  @Middlewares(validateParams(ipBlacklistIdParamsSchema))
  public async getIPBlacklistById(
    @Path() _id: string,
    @Request() _request: TypedRequest,
  ): Promise<GetIPBlacklistByIdResponse> {
    // Note: This would require adding a findById method to the repository
    // For now, we'll throw an error indicating this needs to be implemented
    throw new BadRequestError("请使用 /check/:ip 端点检查特定 IP", undefined, {
      messageKey: "ipBlacklist.useCheckEndpoint",
    });
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
  @RequirePermission(Permission.IP_BLACKLIST_CREATE)
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

    const blacklist = await this.ipBlacklistService.manualBan(
      body.ipAddress,
      body.duration,
      body.reason || "手动封禁",
      userId,
      request,
    );

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
  @RequirePermission(Permission.IP_BLACKLIST_UPDATE)
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
    // Get the repository directly for update operation
    const { IPBlackListRepository } = await import("@/store/security/ipblacklist");
    const repository = IPBlackListRepository.getInstance();

    // 先通过IP地址查找记录
    const record = await repository.findByIpAnyStatus(ipAddress);
    if (!record)
      throw new NotFoundError(`IP ${ipAddress} 不在黑名单中`, undefined, {
        messageKey: "ipBlacklist.notFoundByIp",
        messageParams: { ip: ipAddress },
      });

    const updateData: any = {};
    if (body.banReason !== undefined) updateData.reason = body.banReason;
    if (body.expireTime !== undefined) updateData.ExpireTime = new Date(body.expireTime);

    const updated = await repository.update(record.id, updateData);

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
  @RequirePermission(Permission.IP_BLACKLIST_DELETE)
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

    const result = await this.ipBlacklistService.unban(ipAddress, userId, request);

    if (!result)
      throw new NotFoundError(`IP ${ipAddress} 不在黑名单中`, undefined, {
        messageKey: "ipBlacklist.notFoundByIp",
        messageParams: { ip: ipAddress },
      });

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
  @RequirePermission(Permission.IP_BLACKLIST_READ)
  @Middlewares(validateParams(ipParamsSchema))
  public async checkIPBlacklist(
    @Path() ip: string,
    @Request() _request: TypedRequest,
  ): Promise<CheckIPBlacklistResponse> {
    const isBlacklisted = await this.ipBlacklistService.isIpBlacklisted(ip);
    const blacklistInfo = isBlacklisted ? await this.ipBlacklistService.getBlacklistInfo(ip) : null;

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
  @RequirePermission(Permission.IP_BLACKLIST_READ)
  @Middlewares(validateParams(ipParamsSchema))
  public async getIpErrorStatus(@Path() ip: string, @Request() _request: TypedRequest): Promise<IPErrorStatusResponse> {
    return await this.ipBlacklistService.getIpErrorStatus(ip);
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
  @RequirePermission(Permission.IP_BLACKLIST_UPDATE)
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
    await this.ipBlacklistService.resetIpErrorWeight(ip);
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
  @RequirePermission(Permission.IP_BLACKLIST_UPDATE)
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
    await this.ipBlacklistService.setIpErrorWeight(ip, body.weight);
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
  @RequirePermission(Permission.IP_BLACKLIST_READ)
  public async getMonitoringDashboard(@Request() _request: TypedRequest): Promise<MonitoringDashboardResponse> {
    return await this.ipBlacklistService.getMonitoringDashboard();
  }
}
