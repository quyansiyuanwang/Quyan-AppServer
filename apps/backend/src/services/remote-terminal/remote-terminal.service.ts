import { RemoteTerminalSessionAuthorityService } from "./remote-terminal-session-authority.service";
import { env } from "@/config/env";
import { RemoteTerminalSessionReadIamService } from "./remote-terminal-session-read-iam.service";
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
import { BadRequestError, ForbiddenError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
import { RemoteTerminalDeviceIamService } from "./remote-terminal-device-iam.service";
import { RemoteTerminalGatewayService } from "@/modules/remote-terminal/gateway/gateway.service";
import { RemoteTerminalProductService } from "./remote-terminal-product.service";

export class RemoteTerminalService {
  private static instance: RemoteTerminalService | null = null;
  private readonly gatewayService = RemoteTerminalGatewayService.getInstance();
  private readonly productService = RemoteTerminalProductService.getInstance();

  public static getInstance(): RemoteTerminalService {
    if (!this.instance) this.instance = new RemoteTerminalService();

    return this.instance;
  }

  public async listDevicesForUser(userId: string, request?: TypedRequest): Promise<RemoteTerminalDeviceListDto> {
    return {
      items: await RemoteTerminalDeviceIamService.getInstance().list(userId, request, () =>
        this.gatewayService.listDevices(userId),
      ),
    };
  }

  public async probeDevicesForUser(
    userId: string,
    request?: TypedRequest,
  ): Promise<RemoteTerminalDeviceProbeResponseDto> {
    return RemoteTerminalDeviceIamService.getInstance().probe(
      userId,
      request,
      () => this.gatewayService.probeDevices(userId),
      (deviceId, guard) => this.gatewayService.probeAuthorizedDevice(deviceId, guard),
    );
  }

  public async listSessionsForUser(userId: string, request?: TypedRequest): Promise<RemoteTerminalSessionListDto> {
    return {
      items: await RemoteTerminalSessionReadIamService.getInstance().list(userId, request, () =>
        this.gatewayService.listSessions(userId),
      ),
    };
  }

  public async getUsageSummaryForUser(userId: string, request?: TypedRequest): Promise<RemoteTerminalUsageSummaryDto> {
    return RemoteTerminalSessionReadIamService.getInstance().getUsage(userId, request, () =>
      this.legacyUsageSummary(userId),
    );
  }
  private async legacyUsageSummary(userId: string): Promise<RemoteTerminalUsageSummaryDto> {
    const [totalTerminalLimit, totalDeviceLimit, devices, sessions] = await Promise.all([
      this.productService.getRuntimeTotalTerminalLimit(userId),
      this.productService.getRuntimeTotalDeviceLimit(userId),
      this.gatewayService.listDevices(userId),
      this.gatewayService.listSessions(userId),
    ]);
    const activeSessionCount = sessions.filter((item) => item.status !== "closed").length;
    const activeDeviceCount = devices.length;
    const remainingTerminalCount = Math.max(0, totalTerminalLimit - activeSessionCount);
    const remainingDeviceCount = Math.max(0, totalDeviceLimit - activeDeviceCount);

    return {
      activeSessionCount,
      totalTerminalLimit,
      remainingTerminalCount,
      activeDeviceCount,
      totalDeviceLimit,
      remainingDeviceCount,
      terminalQuotaReached: totalTerminalLimit <= 0 || activeSessionCount >= totalTerminalLimit,
      deviceQuotaReached: totalDeviceLimit <= 0 || activeDeviceCount >= totalDeviceLimit,
    };
  }

  public async browseDirectoriesForUser(
    userId: string,
    deviceId: string,
    targetPath?: string,
    request?: TypedRequest,
  ): Promise<RemoteTerminalDirectoryBrowseDto> {
    return RemoteTerminalDeviceIamService.getInstance().withDevice(
      userId,
      deviceId,
      "quyan:remote_terminal:BrowseDirectories",
      request,
      async (guard) => {
        try {
          const response = guard
            ? await this.gatewayService.browseDirectories(userId, deviceId, targetPath?.trim() || undefined, guard)
            : await this.gatewayService.browseDirectories(userId, deviceId, targetPath?.trim() || undefined);
          return {
            currentPath: response.currentPath,
            parentPath: response.parentPath || undefined,
            items: response.items,
          };
        } catch (error) {
          if (error instanceof ForbiddenError) throw error;
          throw new BadRequestError(
            error instanceof Error ? error.message : "Remote directory browsing failed",
            undefined,
            {
              messageKey: "remoteTerminal.directoryBrowsingFailed",
            },
          );
        }
      },
    );
  }

  public async getAgentPreferencesForUser(
    userId: string,
    deviceId: string,
    request?: TypedRequest,
  ): Promise<RemoteTerminalAgentPreferencesDto> {
    return RemoteTerminalDeviceIamService.getInstance().withDevice(
      userId,
      deviceId,
      "quyan:remote_terminal:GetAgentPreferences",
      request,
      async (guard) => {
        try {
          const preferences = guard
            ? await this.gatewayService.getAgentPreferences(userId, deviceId, guard)
            : await this.gatewayService.getAgentPreferences(userId, deviceId);
          return {
            deviceId,
            defaultWorkingDirectory: preferences.defaultWorkingDirectory || undefined,
            shortcuts: preferences.shortcuts,
            quickCommands: preferences.quickCommands,
          };
        } catch (error) {
          if (error instanceof ForbiddenError) throw error;
          throw new BadRequestError(
            error instanceof Error ? error.message : "Failed to load remote terminal preferences",
            undefined,
            {
              messageKey: "remoteTerminal.preferencesLoadFailed",
            },
          );
        }
      },
    );
  }

  public async updateAgentPreferencesForUser(
    userId: string,
    body: UpdateRemoteTerminalAgentPreferencesRequest,
    request?: TypedRequest,
  ): Promise<RemoteTerminalAgentPreferencesDto> {
    return RemoteTerminalDeviceIamService.getInstance().withDevice(
      userId,
      body.deviceId,
      "quyan:remote_terminal:UpdateAgentPreferences",
      request,
      async (guard) => {
        try {
          const input = {
            defaultWorkingDirectory: body.defaultWorkingDirectory?.trim() || undefined,
            shortcuts: body.shortcuts,
            quickCommands: body.quickCommands,
          };
          const preferences = guard
            ? await this.gatewayService.updateAgentPreferences(userId, body.deviceId, input, guard)
            : await this.gatewayService.updateAgentPreferences(userId, body.deviceId, input);
          return {
            deviceId: body.deviceId,
            defaultWorkingDirectory: preferences.defaultWorkingDirectory || undefined,
            shortcuts: preferences.shortcuts,
            quickCommands: preferences.quickCommands,
          };
        } catch (error) {
          if (error instanceof ForbiddenError) throw error;
          throw new BadRequestError(
            error instanceof Error ? error.message : "Failed to save remote terminal preferences",
            undefined,
            {
              messageKey: "remoteTerminal.preferencesSaveFailed",
            },
          );
        }
      },
    );
  }

  public async createSession(
    userId: string,
    body: CreateRemoteTerminalSessionRequest,
    browserWebSocketBaseUrl: string,
    request?: TypedRequest,
  ): Promise<RemoteTerminalSessionDto> {
    let created: RemoteTerminalSessionDto | undefined;
    try {
      return await RemoteTerminalDeviceIamService.getInstance().withDevice(
        userId,
        body.deviceId,
        "quyan:remote_terminal:CreateSession",
        request,
        async (guard) => {
          const native = env.security.iamAuthorizationMode === "enforce";
          if (native && !guard)
            throw new ForbiddenError("Terminal creation guard missing", undefined, {
              messageKey: "permission.insufficientPermission",
            });
          const sessionLimit = await this.productService.getRuntimeTotalTerminalLimit(userId);
          if (sessionLimit <= 0)
            throw new Error("No terminal quota available. Please purchase or claim a terminal package first.");
          const authority =
            native && request
              ? await RemoteTerminalSessionAuthorityService.getInstance().prepare(userId, body.deviceId, request)
              : undefined;
          if (native && !authority)
            throw new ForbiddenError("Terminal authority missing", undefined, {
              messageKey: "permission.insufficientPermission",
            });
          await guard?.();
          const sessionsGateway = native ? this.gatewayService.getSessionGateway() : undefined;
          if (sessionsGateway && guard)
            await sessionsGateway.closeAuthorizedPendingSessions(userId, body.deviceId, guard);
          else await this.gatewayService.closeReconnectableSessions(userId, body.deviceId);
          const existingSessions = sessionsGateway
            ? await sessionsGateway.listSessionMetadata(userId)
            : await this.gatewayService.listSessions(userId);
          const activeSessionCount = existingSessions.filter((item) => item.status !== "closed").length;
          if (activeSessionCount >= sessionLimit)
            throw new Error(`Terminal quota exceeded: ${activeSessionCount}/${sessionLimit} active sessions in use.`);
          await guard?.();
          created =
            native && guard
              ? await this.gatewayService.createSession(userId, body, browserWebSocketBaseUrl, guard)
              : await this.gatewayService.createSession(userId, body, browserWebSocketBaseUrl);
          if (authority && sessionsGateway) {
            const connectionGuard = await authority.bindSession(created.sessionId);
            sessionsGateway.registerSessionAuthorization(userId, created.sessionId, connectionGuard);
          }
          return created;
        },
      );
    } catch (error) {
      if (created) await this.gatewayService.getSessionGateway().discardPendingSession(userId, created.sessionId);
      if (error instanceof ForbiddenError) throw error;
      throw new BadRequestError(
        error instanceof Error ? error.message : "Remote terminal session creation failed",
        undefined,
        { messageKey: "remoteTerminal.sessionCreationFailed" },
      );
    }
  }
}
