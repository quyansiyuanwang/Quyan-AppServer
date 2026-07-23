import { NextFunction, Request, Response } from "express";
import { ResponseWrapper } from "../util/express-enhancer";
import { SuccessResponse, ErrorResponse } from "../api/response";
import type { PermissionCheckResult } from "@/services/users/permission.service";
import type { AccessKeyDto } from "@prisma/client";
import type { DeveloperProjectApiKey } from "@prisma/client";
import type { RelayTokenWithChannel } from "@/store/relay/relay-token.repository";
import { JWTPayload } from "@/util/auth";
import type { BackendLocale, MessageDescriptor } from "@/locales";

declare global {
  namespace Express {
    interface Request {
      locale?: BackendLocale;
    }

    interface Locals {
      locale?: BackendLocale;
      responseMessage?: string;
      responseMessageDescriptor?: MessageDescriptor;
      skipResponseWrapper?: boolean;
    }
  }
}

// 自定义类型别名
export interface TypedRequest<T = undefined> extends Request {
  body: T;
  user?: JWTPayload;
  authContext?: {
    principalUserId: string;
    accountOwnerId: string;
    subjectType: "root" | "sub_user" | "service" | "oauth" | "relay" | "access_key" | "project_key" | "impersonation";
    assumedRoleId?: string;
    roleSessionId?: string;
  };
  res: ResponseWrapper; // 使用增强后的 Response 类型
  relayToken?: RelayTokenWithChannel; // 添加 relayToken 属性
  accessKey?: AccessKeyDto; // 可选的 accessKey 属性
  projectApiKey?: DeveloperProjectApiKey;
  oauthAccessToken?: {
    id: string;
    oauthClientId: string;
    clientId: string;
    clientName: string;
    userId: string;
    scopes: string[];
    expiresAt: string;
  };
  permissions?: PermissionCheckResult;
}

export interface TypedResponse<T> extends Response {
  json(data: SuccessResponse<T> | ErrorResponse): Response;
}

export interface TypedNextFunction<T> extends NextFunction {
  (err?: T): void;
}

export type ViewHandler<RQ, RS, NT> = (
  req: TypedRequest<RQ>,
  res: TypedResponse<RS>,
  next: TypedNextFunction<NT>,
) => void;
