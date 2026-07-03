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
import { BadRequestError } from "@/util/errors";
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

  public async listDevicesForUser(userId: string): Promise<RemoteTerminalDeviceListDto> {
    return {
      items: await this.gatewayService.listDevices(userId),
    };
  }

  public async probeDevicesForUser(userId: string): Promise<RemoteTerminalDeviceProbeResponseDto> {
    return this.gatewayService.probeDevices(userId);
  }

  public async listSessionsForUser(userId: string): Promise<RemoteTerminalSessionListDto> {
    return {
      items: await this.gatewayService.listSessions(userId),
    };
  }

  public async getUsageSummaryForUser(userId: string): Promise<RemoteTerminalUsageSummaryDto> {
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
  ): Promise<RemoteTerminalDirectoryBrowseDto> {
    try {
      const response = await this.gatewayService.browseDirectories(userId, deviceId, targetPath?.trim() || undefined);
      return {
        currentPath: response.currentPath,
        parentPath: response.parentPath || undefined,
        items: response.items,
      };
    } catch (error) {
      throw new BadRequestError(error instanceof Error ? error.message : "Remote directory browsing failed");
    }
  }

  public async getAgentPreferencesForUser(
    userId: string,
    deviceId: string,
  ): Promise<RemoteTerminalAgentPreferencesDto> {
    try {
      const preferences = await this.gatewayService.getAgentPreferences(userId, deviceId);
      return {
        deviceId,
        defaultWorkingDirectory: preferences.defaultWorkingDirectory || undefined,
        shortcuts: preferences.shortcuts,
        quickCommands: preferences.quickCommands,
      };
    } catch (error) {
      throw new BadRequestError(error instanceof Error ? error.message : "Failed to load remote terminal preferences");
    }
  }

  public async updateAgentPreferencesForUser(
    userId: string,
    body: UpdateRemoteTerminalAgentPreferencesRequest,
  ): Promise<RemoteTerminalAgentPreferencesDto> {
    try {
      const preferences = await this.gatewayService.updateAgentPreferences(userId, body.deviceId, {
        defaultWorkingDirectory: body.defaultWorkingDirectory?.trim() || undefined,
        shortcuts: body.shortcuts,
        quickCommands: body.quickCommands,
      });
      return {
        deviceId: body.deviceId,
        defaultWorkingDirectory: preferences.defaultWorkingDirectory || undefined,
        shortcuts: preferences.shortcuts,
        quickCommands: preferences.quickCommands,
      };
    } catch (error) {
      throw new BadRequestError(error instanceof Error ? error.message : "Failed to save remote terminal preferences");
    }
  }

  public async createSession(
    userId: string,
    body: CreateRemoteTerminalSessionRequest,
    browserWebSocketBaseUrl: string,
  ): Promise<RemoteTerminalSessionDto> {
    try {
      const sessionLimit = await this.productService.getRuntimeTotalTerminalLimit(userId);
      if (sessionLimit <= 0)
        throw new Error("No terminal quota available. Please purchase or claim a terminal package first.");

      await this.gatewayService.closeReconnectableSessions(userId, body.deviceId);

      const existingSessions = await this.gatewayService.listSessions(userId);
      const activeSessionCount = existingSessions.filter((item) => item.status !== "closed").length;

      if (activeSessionCount >= sessionLimit)
        throw new Error(`Terminal quota exceeded: ${activeSessionCount}/${sessionLimit} active sessions in use.`);

      return await this.gatewayService.createSession(userId, body, browserWebSocketBaseUrl);
    } catch (error) {
      throw new BadRequestError(error instanceof Error ? error.message : "Remote terminal session creation failed");
    }
  }
}
