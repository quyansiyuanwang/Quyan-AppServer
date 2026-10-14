import type {
  RemoteTerminalAgentPreferencesData,
  RemoteTerminalDirectoryBrowseResultMessage,
  RemoteTerminalAgentHeartbeatRequest,
  RemoteTerminalAgentHeartbeatResponse,
  RemoteTerminalAgentRegistrationRequest,
  RemoteTerminalAgentRegistrationResponse,
  RemoteTerminalDeviceProbeResponse,
  RemoteTerminalDeviceSummary,
  RemoteTerminalSessionCreateRequest,
  RemoteTerminalSessionCreateResponse,
  RemoteTerminalSessionSummary,
} from "@/modules/remote-terminal/protocol";
import { RemoteTerminalDeviceRegistry } from "./device-registry";
import { RemoteTerminalSessionGateway } from "./session-gateway";

export class RemoteTerminalGatewayService {
  private static instance: RemoteTerminalGatewayService | null = null;

  public static getInstance(): RemoteTerminalGatewayService {
    if (!this.instance) this.instance = new RemoteTerminalGatewayService();

    return this.instance;
  }

  private readonly deviceRegistry = new RemoteTerminalDeviceRegistry();
  private readonly sessionGateway = new RemoteTerminalSessionGateway(this.deviceRegistry);

  public async registerAgent(
    payload: RemoteTerminalAgentRegistrationRequest,
  ): Promise<RemoteTerminalAgentRegistrationResponse> {
    return this.deviceRegistry.register(payload);
  }

  public async heartbeatAgent(
    payload: RemoteTerminalAgentHeartbeatRequest,
  ): Promise<RemoteTerminalAgentHeartbeatResponse> {
    return this.deviceRegistry.heartbeat(payload);
  }

  public async listDevices(userId: string): Promise<RemoteTerminalDeviceSummary[]> {
    return this.deviceRegistry.listDevices(userId);
  }

  public async probeDevices(userId: string): Promise<RemoteTerminalDeviceProbeResponse> {
    return this.sessionGateway.probeDevices(userId);
  }

  public async probeAuthorizedDevice(deviceId: string, authorize: () => Promise<void>): Promise<Date | null> {
    return this.sessionGateway.probeAuthorizedDevice(deviceId, authorize);
  }

  public async listSessions(userId: string): Promise<RemoteTerminalSessionSummary[]> {
    return this.sessionGateway.listSessions(userId);
  }

  public async closeReconnectableSessions(userId: string, deviceId: string): Promise<void> {
    await this.sessionGateway.closeReconnectableSessions(userId, deviceId);
  }

  public async createSession(
    userId: string,
    body: RemoteTerminalSessionCreateRequest,
    browserWebSocketBaseUrl: string,
    authorize?: () => Promise<void>,
  ): Promise<RemoteTerminalSessionCreateResponse> {
    return authorize
      ? this.sessionGateway.createSession(userId, body, browserWebSocketBaseUrl, authorize)
      : this.sessionGateway.createSession(userId, body, browserWebSocketBaseUrl);
  }

  public async browseDirectories(
    userId: string,
    deviceId: string,
    targetPath?: string,
    authorize?: () => Promise<void>,
  ): Promise<RemoteTerminalDirectoryBrowseResultMessage> {
    return this.sessionGateway.browseDirectories(userId, deviceId, targetPath, authorize);
  }

  public async getAgentPreferences(
    userId: string,
    deviceId: string,
    authorize?: () => Promise<void>,
  ): Promise<RemoteTerminalAgentPreferencesData> {
    return this.sessionGateway.getAgentPreferences(userId, deviceId, authorize);
  }

  public async updateAgentPreferences(
    userId: string,
    deviceId: string,
    preferences: RemoteTerminalAgentPreferencesData,
    authorize?: () => Promise<void>,
  ): Promise<RemoteTerminalAgentPreferencesData> {
    return this.sessionGateway.updateAgentPreferences(userId, deviceId, preferences, authorize);
  }

  public getDeviceRegistry(): RemoteTerminalDeviceRegistry {
    return this.deviceRegistry;
  }

  public getSessionGateway(): RemoteTerminalSessionGateway {
    return this.sessionGateway;
  }
}
