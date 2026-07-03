import {
  Body,
  Controller,
  Get,
  Middlewares,
  Post,
  Put,
  Query,
  Request,
  Response,
  Route,
  Security,
  Tags,
} from "@tsoa/runtime";
import { HttpStatusCode } from "axios";
import type { ErrorResponse } from "@/api/response";
import type {
  CreateRemoteTerminalSessionRequest,
  RemoteTerminalAgentPreferencesDto,
  RemoteTerminalDirectoryBrowseDto,
  RemoteTerminalDeviceListDto,
  RemoteTerminalDeviceProbeResponseDto,
  RemoteTerminalSessionDto,
  RemoteTerminalSessionListDto,
  RemoteTerminalUsageSummaryDto,
  UpdateRemoteTerminalAgentPreferencesRequest,
} from "@/api/dto/remote-terminal/remote-terminal.dto";
import {
  browseRemoteTerminalDirectoriesQuerySchema,
  createRemoteTerminalSessionBodySchema,
  remoteTerminalAgentPreferencesQuerySchema,
  updateRemoteTerminalAgentPreferencesBodySchema,
} from "@/api/schema/remote-terminal/remote-terminal.schema";
import { Permission } from "@/constant/permission";
import { validateBody, validateQuery } from "@/middleware/validation";
import { RemoteTerminalService } from "@/services/remote-terminal/remote-terminal.service";
import type { TypedRequest } from "@/types/express";
import { RequirePermission } from "@/util/permission/permission-decorator";
import { ReplayProtected, replayProtectionMiddleware } from "@/util/replay-protected-decorator";

function getFirstHeaderValue(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) return header[0]?.trim() || undefined;

  return header?.trim() || undefined;
}

function getForwardedDirective(header: string | string[] | undefined, directive: "host" | "proto"): string | undefined {
  const rawHeader = getFirstHeaderValue(header);
  if (!rawHeader) return undefined;

  const firstEntry = rawHeader.split(",")[0]?.trim();
  if (!firstEntry) return undefined;

  for (const segment of firstEntry.split(";")) {
    const [rawKey, ...rawValueParts] = segment.split("=");
    if (rawKey?.trim().toLowerCase() !== directive) continue;

    const rawValue = rawValueParts.join("=").trim();
    if (!rawValue) return undefined;

    return rawValue.replace(/^"|"$/g, "");
  }

  return undefined;
}

function getForwardedHost(request: TypedRequest): string | undefined {
  const forwardedHost = getForwardedDirective(request.headers.forwarded, "host");
  if (forwardedHost) return forwardedHost;

  const xForwardedHost = getFirstHeaderValue(request.headers["x-forwarded-host"]);
  if (!xForwardedHost) return undefined;

  return xForwardedHost.split(",")[0]?.trim() || undefined;
}

function getForwardedProto(request: TypedRequest): string {
  const forwardedProto = getForwardedDirective(request.headers.forwarded, "proto");
  if (forwardedProto) return forwardedProto.toLowerCase();

  const xForwardedProto = getFirstHeaderValue(request.headers["x-forwarded-proto"]);
  if (xForwardedProto) return xForwardedProto.split(",")[0]?.trim().toLowerCase() || "http";

  return String(request.protocol || "http").toLowerCase();
}

function getRemoteTerminalWebSocketBaseUrl(request: TypedRequest): string {
  const forwardedProto = getForwardedProto(request);
  const wsProtocol = forwardedProto === "https" ? "wss" : "ws";
  const host = getForwardedHost(request) || request.headers.host;

  if (!host) throw new Error("Unable to determine remote terminal websocket host.");

  return `${wsProtocol}://${host}/remote-terminal/ws`;
}

@Route("v1/remote-terminal")
@Tags("Remote Terminal")
export class RemoteTerminalController extends Controller {
  private remoteTerminalService = RemoteTerminalService.getInstance();

  @Get("devices")
  @Security("jwt")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.REMOTE_TERMINAL_DEVICE_READ)
  public async listDevices(@Request() request: TypedRequest): Promise<RemoteTerminalDeviceListDto> {
    return this.remoteTerminalService.listDevicesForUser(request.user!.userId);
  }

  @Post("devices/probe")
  @Security("jwt")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware)
  @RequirePermission(Permission.REMOTE_TERMINAL_DEVICE_READ)
  public async probeDevices(@Request() request: TypedRequest): Promise<RemoteTerminalDeviceProbeResponseDto> {
    return this.remoteTerminalService.probeDevicesForUser(request.user!.userId);
  }

  @Get("sessions")
  @Security("jwt")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.REMOTE_TERMINAL_SESSION_READ)
  public async listSessions(@Request() request: TypedRequest): Promise<RemoteTerminalSessionListDto> {
    return this.remoteTerminalService.listSessionsForUser(request.user!.userId);
  }

  @Get("usage")
  @Security("jwt")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @RequirePermission(Permission.REMOTE_TERMINAL_SESSION_READ)
  public async getUsageSummary(@Request() request: TypedRequest): Promise<RemoteTerminalUsageSummaryDto> {
    return this.remoteTerminalService.getUsageSummaryForUser(request.user!.userId);
  }

  @Get("directories")
  @Security("jwt")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(validateQuery(browseRemoteTerminalDirectoriesQuerySchema))
  @RequirePermission(Permission.REMOTE_TERMINAL_DEVICE_READ)
  public async browseDirectories(
    @Query() deviceId: string,
    @Query() path: string | undefined,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalDirectoryBrowseDto> {
    return this.remoteTerminalService.browseDirectoriesForUser(request.user!.userId, deviceId, path);
  }

  @Get("preferences")
  @Security("jwt")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @Middlewares(validateQuery(remoteTerminalAgentPreferencesQuerySchema))
  @RequirePermission(Permission.REMOTE_TERMINAL_DEVICE_READ)
  public async getAgentPreferences(
    @Query() deviceId: string,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalAgentPreferencesDto> {
    return this.remoteTerminalService.getAgentPreferencesForUser(request.user!.userId, deviceId);
  }

  @Put("preferences")
  @Security("jwt")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(updateRemoteTerminalAgentPreferencesBodySchema))
  @RequirePermission(Permission.REMOTE_TERMINAL_DEVICE_WRITE)
  public async updateAgentPreferences(
    @Body() body: UpdateRemoteTerminalAgentPreferencesRequest,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalAgentPreferencesDto> {
    return this.remoteTerminalService.updateAgentPreferencesForUser(request.user!.userId, body);
  }

  @Post("sessions")
  @Security("jwt")
  @Response<ErrorResponse>(HttpStatusCode.Unauthorized, "未授权，请先登录")
  @Response<ErrorResponse>(HttpStatusCode.Forbidden, "权限不足")
  @ReplayProtected()
  @Middlewares(replayProtectionMiddleware, validateBody(createRemoteTerminalSessionBodySchema))
  @RequirePermission(Permission.REMOTE_TERMINAL_SESSION_CREATE)
  public async createSession(
    @Body() body: CreateRemoteTerminalSessionRequest,
    @Request() request: TypedRequest,
  ): Promise<RemoteTerminalSessionDto> {
    this.setStatus(HttpStatusCode.Created);
    return this.remoteTerminalService.createSession(
      request.user!.userId,
      body,
      getRemoteTerminalWebSocketBaseUrl(request),
    );
  }
}
