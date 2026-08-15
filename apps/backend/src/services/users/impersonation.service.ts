import { Permission } from "@/constant/permission";
import { randomUUID } from "crypto";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/util/errors";
import { CustomCode } from "@/constant/custom-code";
import { JWTAccessIns, IMPERSONATION_TOKEN_TTL_SECONDS } from "@/util/auth";
import { PermissionService } from "@/services/users/permission.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { UserRepository } from "@/store/users/user.repository";
import type { UserStore } from "@/store/users/user.store";
import type { TypedRequest } from "@/types/express";
import type { StartImpersonationResponse } from "@/api/dto/users/impersonation.dto";
import { extractClientIp } from "@/util/ip-extractor";
import type { Request } from "express";
import {
  clearImpersonationHandoffCookie,
  extractImpersonationHandoffCookie,
  setImpersonationHandoffCookie,
} from "@/util/impersonation-cookie";
import { validateAccountStatus } from "@/util/auth/account-status";
import { RedisService } from "@/services/infrastructure/redis.service";

const IMPERSONATION_HANDOFF_KEY_PREFIX = "auth:impersonation_handoff:";

export class ImpersonationService {
  private readonly userRepository: UserStore = UserRepository.getInstance();
  private readonly permissionService = PermissionService.getInstance();
  private readonly businessLogService = BusinessLogService.getInstance();
  private readonly redisService = RedisService.getInstance();

  private getClientIP(req?: TypedRequest): string {
    if (!req) return "unknown";
    return extractClientIp(req);
  }

  async startImpersonation(
    impersonatorId: string,
    targetUserId: string,
    request?: TypedRequest,
  ): Promise<StartImpersonationResponse> {
    // 防止链式模拟（已在模拟会话中的 token 携带 impersonatorId）
    if (request?.user?.impersonatorId)
      throw new ForbiddenError("不能在模拟会话中发起另一个模拟", CustomCode.IMPERSONATION_NOT_ALLOWED);

    // 防止自我模拟
    if (impersonatorId === targetUserId) throw new BadRequestError("不能模拟自己");

    // 加载双方用户（含 group 信息）
    const [impersonator, target] = await Promise.all([
      this.userRepository.findByIdWithGroup(impersonatorId),
      this.userRepository.findByIdWithGroup(targetUserId),
    ]);

    if (!impersonator) throw new NotFoundError("操作者用户不存在");
    if (!target) throw new NotFoundError("目标用户不存在");

    // 特权层级检查：group.level 数值越小权限越高
    // 若目标 level <= 操作者 level，说明目标权限不低于操作者，禁止模拟
    if ((target.group?.level ?? Infinity) <= (impersonator.group?.level ?? -1))
      throw new ForbiddenError("无法模拟权限等级不低于自身的用户", CustomCode.IMPERSONATION_NOT_ALLOWED);

    // 确定模拟模式：优先授予 act，其次 view
    const [hasAct, hasView] = await Promise.all([
      this.permissionService.hasAnyPermission(impersonatorId, [Permission.USER_IMPERSONATE_ACT]),
      this.permissionService.hasAnyPermission(impersonatorId, [Permission.USER_IMPERSONATE_VIEW]),
    ]);

    let mode: "view" | "act";
    if (hasAct) mode = "act";
    else if (hasView) mode = "view";
    else throw new ForbiddenError("无模拟权限", CustomCode.IMPERSONATION_NOT_ALLOWED);

    // 签发模拟 token（短期，无 refresh）
    const token = JWTAccessIns.generateToken(
      {
        userId: target.id,
        updatedAt: target.updateTime.toISOString(),
        status: target.status,
        impersonatorId: impersonatorId,
        impersonationMode: mode,
      },
      IMPERSONATION_TOKEN_TTL_SECONDS,
    );

    // 审计日志（fire-and-forget）
    void this.businessLogService.logOperation({
      operationType: OperationType.IMPERSONATION_START,
      operationCategory: OperationCategory.USER_MANAGEMENT,
      actorUserId: impersonatorId,
      targetUserId: targetUserId,
      description: `用户 ${impersonator.username} 以${mode === "act" ? "操作" : "只读"}模式模拟进入用户 ${target.username} 的账户`,
      metadata: { mode, impersonatorUsername: impersonator.username, targetUsername: target.username },
      success: true,
      ipAddress: this.getClientIP(request),
      userAgent: request?.headers["user-agent"],
    });

    return {
      access_token: token,
      expires_in: IMPERSONATION_TOKEN_TTL_SECONDS,
      targetUser: {
        id: target.id,
        username: target.username,
        name: target.name,
      },
      mode,
    };
  }

  async issueCrossSiteHandoff(request: Request, token: string): Promise<void> {
    // Access tokens stay out of browser persistence. Only an opaque random
    // handle reaches the HttpOnly cookie; its matching token lives in Redis.
    if (!this.redisService.isRedisAvailable()) return;
    const handoffId = randomUUID();
    await this.redisService.set(
      `${IMPERSONATION_HANDOFF_KEY_PREFIX}${handoffId}`,
      token,
      IMPERSONATION_TOKEN_TTL_SECONDS,
    );
    setImpersonationHandoffCookie(request, handoffId);
  }

  async restoreImpersonation(request: Request): Promise<StartImpersonationResponse | null> {
    const handoffId = extractImpersonationHandoffCookie(request);
    if (!handoffId) return null;
    const token = await this.redisService.get(`${IMPERSONATION_HANDOFF_KEY_PREFIX}${handoffId}`);
    if (!token) {
      clearImpersonationHandoffCookie(request);
      return null;
    }

    let payload: Awaited<ReturnType<typeof JWTAccessIns.verifyToken>>;
    try {
      payload = await JWTAccessIns.verifyToken(token);
    } catch {
      clearImpersonationHandoffCookie(request);
      return null;
    }

    if (!payload?.userId || !payload.impersonatorId || !payload.impersonationMode) {
      clearImpersonationHandoffCookie(request);
      return null;
    }

    const target = await this.userRepository.findById(payload.userId);
    if (!target || !payload.updatedAt || payload.updatedAt !== target.updateTime.toISOString()) {
      clearImpersonationHandoffCookie(request);
      return null;
    }
    try {
      validateAccountStatus(target.status, target.id, "impersonation restore");
    } catch {
      clearImpersonationHandoffCookie(request);
      return null;
    }

    return {
      access_token: token,
      expires_in: Math.max(1, (payload.exp ?? 0) - Math.floor(Date.now() / 1000)),
      targetUser: { id: target.id, username: target.username, name: target.name },
      mode: payload.impersonationMode,
    };
  }
}
