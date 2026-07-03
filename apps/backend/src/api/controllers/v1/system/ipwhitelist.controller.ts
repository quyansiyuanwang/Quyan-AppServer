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
import { RequirePermission } from "@/util/permission/permission-decorator";
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
  @RequirePermission(Permission.IP_WHITELIST_READ, "jwt")
  @Middlewares(validateQuery(ipWhitelistListQuerySchema))
  public async getAllIPWhitelists(
    @Query() limit?: number,
    @Query() offset?: number,
  ): Promise<GetAllIPWhitelistsResponse> {
    const { whitelists, total } = await this.service.list(limit, offset);
    return { whitelists: whitelists.map((whitelist) => this.toDto(whitelist)), total };
  }

  /** 检查 IP 是否在白名单 */
  @Get("/exists/{ip}")
  @Security("jwt")
  @RequirePermission(Permission.IP_WHITELIST_READ, "jwt")
  @Middlewares(validateParams(ipWhitelistIpParamsSchema))
  public async isExistsWhiteIp(@Path() ip: string): Promise<CheckIPWhitelistResponse> {
    const isWhitelisted = await this.service.isWhitelisted(ip);
    return { isWhitelisted };
  }

  /** 添加 IP 到白名单 */
  @Post("/add")
  @Security("jwt")
  @SuccessResponse(HttpStatusCode.Created, "Created")
  @RequirePermission(Permission.IP_WHITELIST_CREATE, "jwt")
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
    if (!body.ipAddress) throw new BadRequestError("IP 地址不能为空");
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
    const record = await this.service.add(body.ipAddress, body.reason ?? "", request.user!.userId, expiresAt, request);
    this.setStatus(HttpStatusCode.Created);
    return { whitelist: this.toDto(record) };
  }

  /** 从白名单移除 IP */
  @Delete("/remove/{ip}")
  @Security("jwt")
  @RequirePermission(Permission.IP_WHITELIST_DELETE, "jwt")
  @TwoFactorChallengeProtected({ purpose: "stepup", method: "code" })
  @Middlewares(
    twoFactorChallengeMiddleware({ purpose: "stepup", method: "code" }),
    replayProtectionMiddleware,
    validateParams(ipWhitelistIpParamsSchema),
  )
  public async removeWhiteIp(@Path() ip: string, @Request() request: TypedRequest): Promise<DeleteIPWhitelistResponse> {
    const success = await this.service.remove(ip, request.user!.userId, request);
    if (!success) throw new NotFoundError(`IP ${ip} 不在白名单中`);
    return { success };
  }
}
