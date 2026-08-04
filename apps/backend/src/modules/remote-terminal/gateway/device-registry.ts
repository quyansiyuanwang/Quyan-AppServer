import { randomUUID } from "node:crypto";
import { MANAGED_STATUS } from "@/constant/status";
import { isInstallToken, verifyInstallToken } from "@/modules/remote-terminal/install-token";
import type { RemoteTerminalActiveEntitlementTokenRecord } from "@/store/remote-terminal-product/remote-terminal-product.store";
import type {
  RemoteTerminalAgentHeartbeatRequest,
  RemoteTerminalAgentHeartbeatResponse,
  RemoteTerminalAgentRegistrationRequest,
  RemoteTerminalAgentRegistrationResponse,
  RemoteTerminalDeviceSummary,
  RemoteTerminalHostSnapshot,
} from "@/modules/remote-terminal/protocol";
import { RemoteTerminalProductRepository } from "@/store/remote-terminal-product/remote-terminal-product.repository";
import type { RemoteTerminalDeviceBindingWithRelations } from "@/store/remote-terminal-product/remote-terminal-product.store";
import { ConfigService } from "@/services/system/config.service";
import type { Prisma } from "@prisma/client";
import { env } from "@/config/env";

interface RemoteTerminalDeviceRecord {
  deviceId: string;
  fingerprint: string;
  fingerprintVersion: string;
  heartbeatToken: string;
  snapshot: RemoteTerminalHostSnapshot;
  registeredAt: string;
  lastSeenAt: string;
  online: boolean;
  entitlementId: string;
}

interface RemoteTerminalDeviceStatusPatch {
  online: boolean;
  lastSeenAt?: Date;
}

const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;

function toInputJsonValue(snapshot: RemoteTerminalHostSnapshot): Prisma.InputJsonValue {
  return snapshot as unknown as Prisma.InputJsonValue;
}

function toHostSnapshot(snapshot: Prisma.JsonValue | null): RemoteTerminalHostSnapshot {
  return snapshot as unknown as RemoteTerminalHostSnapshot;
}

export class RemoteTerminalDeviceRegistry {
  private readonly productRepository = RemoteTerminalProductRepository.getInstance();
  private readonly configService = ConfigService.getInstance();

  public async register(
    payload: RemoteTerminalAgentRegistrationRequest,
  ): Promise<RemoteTerminalAgentRegistrationResponse> {
    const now = new Date();
    let entitlement: RemoteTerminalActiveEntitlementTokenRecord | null;
    if (isInstallToken(payload.registrationToken)) {
      const secret = env.integrations.remoteTerminal.installTokenSecret;
      if (!secret) throw new Error("RTM_INSTALL_TOKEN_SECRET is not configured");
      const verified = verifyInstallToken(payload.registrationToken, secret);
      if (!verified) throw new Error("Invalid or expired install token.");
      entitlement = await this.productRepository.findActiveEntitlementById(verified.entitlementId, now);
    } else entitlement = await this.productRepository.findActiveEntitlementByToken(payload.registrationToken, now);

    if (!entitlement) throw new Error("Invalid or expired registration token.");
    if (!entitlement.registrationToken) throw new Error("Registration token is unavailable.");

    const fingerprint = this.normalizeDeviceFingerprint(payload.deviceFingerprint);
    if (!fingerprint) throw new Error("deviceFingerprint is required.");
    const fingerprintVersion = this.normalizeFingerprintVersion(payload.fingerprintVersion);
    if (!fingerprintVersion) throw new Error("fingerprintVersion is required.");
    const existingRecord = await this.productRepository.findDeviceBindingByEntitlementAndFingerprint(
      entitlement.id,
      fingerprint,
    );

    if (existingRecord?.status === MANAGED_STATUS.DELETED) {
      const config = await this.configService.getRemoteTerminalUnbindConfig();
      const cooldownMs = config.rebindCooldownMinutes * 60 * 1000;
      const lastUnboundAt = existingRecord.updateTime;
      if (cooldownMs > 0 && lastUnboundAt) {
        const availableAt = lastUnboundAt.getTime() + cooldownMs;
        if (availableAt > now.getTime())
          throw new Error(`Device rebind is cooling down. Please retry after ${new Date(availableAt).toISOString()}.`);
      }
    }

    if (!existingRecord) {
      const activeDeviceCount = await this.productRepository.countActiveDeviceBindingsForEntitlement(entitlement.id);
      if (activeDeviceCount >= entitlement.deviceLimit) throw new Error("Device limit reached for this entitlement.");
    }

    const deviceId = existingRecord?.deviceId ?? randomUUID();
    const heartbeatToken = randomUUID();

    const writePayload: Prisma.RemoteTerminalDeviceBindingUncheckedUpdateInput = {
      entitlementId: entitlement.id,
      userId: entitlement.userId,
      registrationTokenId: entitlement.registrationToken.id,
      heartbeatToken,
      fingerprint,
      fingerprintVersion,
      hostname: payload.snapshot.hostname,
      platform: payload.snapshot.platform,
      arch: payload.snapshot.arch,
      snapshot: toInputJsonValue(payload.snapshot),
      lastSeenAt: now,
      online: false,
    };

    if (existingRecord)
      await this.productRepository.updateDeviceBinding(existingRecord.id, {
        ...writePayload,
        registeredAt: existingRecord.registeredAt,
        lastOnlineAt: existingRecord.lastOnlineAt,
        status: MANAGED_STATUS.ENABLED,
      });
    else
      await this.productRepository.createDeviceBinding({
        deviceId,
        entitlementId: entitlement.id,
        userId: entitlement.userId,
        registrationTokenId: entitlement.registrationToken.id,
        heartbeatToken,
        fingerprint,
        fingerprintVersion,
        hostname: payload.snapshot.hostname,
        platform: payload.snapshot.platform,
        arch: payload.snapshot.arch,
        snapshot: toInputJsonValue(payload.snapshot),
        registeredAt: now,
        lastSeenAt: now,
        online: false,
        status: MANAGED_STATUS.ENABLED,
      });

    await this.productRepository.touchEntitlementToken(entitlement.registrationToken.id, now);

    return {
      deviceId,
      heartbeatIntervalSeconds: DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
      heartbeatToken,
      acceptedAt: now.toISOString(),
    };
  }

  public async heartbeat(payload: RemoteTerminalAgentHeartbeatRequest): Promise<RemoteTerminalAgentHeartbeatResponse> {
    const record = await this.productRepository.findDeviceBindingByDeviceId(payload.deviceId);
    if (!record) throw new Error("Unknown device.");

    if (record.heartbeatToken !== payload.heartbeatToken) throw new Error("Invalid heartbeat token.");

    const now = new Date();
    if (
      record.status !== MANAGED_STATUS.ENABLED ||
      record.entitlement.status !== MANAGED_STATUS.ENABLED ||
      record.entitlement.endAt.getTime() < now.getTime()
    )
      throw new Error("Device entitlement is not active.");

    await this.productRepository.updateDeviceBinding(record.id, {
      snapshot: toInputJsonValue(payload.snapshot),
      hostname: payload.snapshot.hostname,
      platform: payload.snapshot.platform,
      arch: payload.snapshot.arch,
      lastSeenAt: now,
    });

    return {
      ok: true,
      nextHeartbeatIntervalSeconds: DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
      serverTime: now.toISOString(),
    };
  }

  public async listDevices(userId: string): Promise<RemoteTerminalDeviceSummary[]> {
    const devices = await this.productRepository.listAccessibleDeviceBindings(userId, new Date());
    return devices.map((device) => this.toDeviceSummary(device));
  }

  public async getAccessibleDevice(userId: string, deviceId: string): Promise<RemoteTerminalDeviceRecord> {
    const record = await this.productRepository.findAccessibleDeviceBindingByDeviceId(userId, deviceId, new Date());
    if (!record) throw new Error("Unknown device.");
    return this.toDeviceRecord(record);
  }

  public async getDevice(deviceId: string): Promise<RemoteTerminalDeviceRecord> {
    const record = await this.productRepository.findDeviceBindingByDeviceId(deviceId);
    if (!record) throw new Error("Unknown device.");
    return this.toDeviceRecord(record);
  }

  public async validateAgentSocket(deviceId: string, heartbeatToken: string): Promise<RemoteTerminalDeviceRecord> {
    const record = await this.productRepository.findDeviceBindingByDeviceId(deviceId);
    if (!record) throw new Error("Unknown device.");
    if (record.heartbeatToken !== heartbeatToken) throw new Error("Invalid agent websocket token.");

    const now = new Date();
    if (
      record.status !== MANAGED_STATUS.ENABLED ||
      record.entitlement.status !== MANAGED_STATUS.ENABLED ||
      record.entitlement.startAt.getTime() > now.getTime() ||
      record.entitlement.endAt.getTime() < now.getTime()
    )
      throw new Error("Device entitlement is not active.");

    return this.toDeviceRecord(record);
  }

  public async markOnline(deviceId: string, online: boolean): Promise<void> {
    await this.updateDeviceStatus(deviceId, {
      online,
      lastSeenAt: online ? new Date() : undefined,
    });
  }

  public async updateDeviceStatus(deviceId: string, patch: RemoteTerminalDeviceStatusPatch): Promise<void> {
    const record = await this.productRepository.findDeviceBindingByDeviceId(deviceId);
    if (!record) return;

    const seenAt = patch.lastSeenAt;
    await this.productRepository.updateDeviceBinding(record.id, {
      online: patch.online,
      ...(seenAt ? { lastSeenAt: seenAt } : {}),
      lastOnlineAt: patch.online && seenAt ? seenAt : record.lastOnlineAt,
    });
  }

  private toDeviceRecord(record: RemoteTerminalDeviceBindingWithRelations): RemoteTerminalDeviceRecord {
    const snapshot = toHostSnapshot(record.snapshot);
    return {
      deviceId: record.deviceId,
      fingerprint: record.fingerprint,
      fingerprintVersion: record.fingerprintVersion,
      heartbeatToken: record.heartbeatToken,
      snapshot,
      registeredAt: record.registeredAt.toISOString(),
      lastSeenAt: record.lastSeenAt.toISOString(),
      online: record.online,
      entitlementId: record.entitlementId,
    };
  }

  private toDeviceSummary(record: RemoteTerminalDeviceBindingWithRelations): RemoteTerminalDeviceSummary {
    const snapshot = toHostSnapshot(record.snapshot);
    return {
      deviceId: record.deviceId,
      hostname: record.hostname,
      platform: record.platform as RemoteTerminalDeviceSummary["platform"],
      arch: record.arch,
      availableShells: snapshot?.diagnostics?.availableShells ?? [],
      lastSeenAt: record.lastSeenAt.toISOString(),
      registeredAt: record.registeredAt.toISOString(),
      online: record.online,
    };
  }

  private normalizeDeviceFingerprint(value: string | undefined): string | null {
    const normalized = String(value || "")
      .trim()
      .toLowerCase();
    if (!normalized) return null;
    if (!/^[a-f0-9]{64}$/.test(normalized)) return null;
    return normalized;
  }

  private normalizeFingerprintVersion(value: string | undefined): string | null {
    const normalized = String(value || "")
      .trim()
      .toLowerCase();
    if (!normalized) return null;
    if (!/^[a-z0-9]+(?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(normalized)) return null;
    return normalized;
  }
}
