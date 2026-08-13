import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { useRequestStore } from '@/stores/request'
import StorageKey from '@/constant/storagekey'
import { cache } from '@/utils/common'
import { getScopedStorageKey } from '@/utils/storageScope'
import type { HeartbeatRuntimeConfigDto } from '@/client/types.gen'
import { createUserHeartbeatControllerApi } from '@/client/services/user-heartbeat-controller.gen'

const getUserHeartbeatControllerApi = cache(() =>
  createUserHeartbeatControllerApi(useRequestStore().getAxios()),
)

const LEADER_TTL_MS = 20000
const LEADER_RENEW_INTERVAL_MS = 5000

export class HeartbeatService {
  private static instance: HeartbeatService | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private leaderRenewTimer: ReturnType<typeof setInterval> | null = null
  private started = false
  private inFlight: Promise<void> | null = null
  private leaderId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

  private constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', this.handleStorage)
      document.addEventListener('visibilitychange', this.handleVisibilityChange)
    }

  }

  static getInstance() {
    if (!this.instance) {
      this.instance = new HeartbeatService()
    }
    return this.instance
  }

  private getLeaderIdKey() {
    return getScopedStorageKey(StorageKey.Util.HEARTBEAT_LEADER_ID)
  }

  private getLeaderExpiresKey() {
    return getScopedStorageKey(StorageKey.Util.HEARTBEAT_LEADER_EXPIRES_AT)
  }

  forceStopLocal() {
    this.started = false
    this.clearTimers()
    this.inFlight = null
    TypedLocalStorage.removeItem(this.getLeaderIdKey())
    TypedLocalStorage.removeItem(this.getLeaderExpiresKey())
  }

  private async fetchRuntimeConfig(): Promise<HeartbeatRuntimeConfigDto> {
    const result = await getUserHeartbeatControllerApi().getRuntimeConfig({})
    return result.data as HeartbeatRuntimeConfigDto
  }

  private async sendHeartbeat() {
    if (this.inFlight) return this.inFlight
    if (!this.isLeader()) return

    this.inFlight = (async () => {
      try {
        await getUserHeartbeatControllerApi().sendHeartbeat(
          { body: {} as never },
          { skipProgressBar: true },
        )
      } catch (error) {
        console.warn('Heartbeat send failed:', error)
      } finally {
        this.inFlight = null
      }
    })()

    return this.inFlight
  }

  private renewLeadership = () => {
    const expiresAt = Date.now() + LEADER_TTL_MS
    TypedLocalStorage.setItem(this.getLeaderIdKey(), this.leaderId)
    TypedLocalStorage.setItem(this.getLeaderExpiresKey(), String(expiresAt))
  }

  private tryBecomeLeader() {
    const expiresAt = Number(TypedLocalStorage.getItem(this.getLeaderExpiresKey()) || '0')
    const currentLeaderId = TypedLocalStorage.getItem(this.getLeaderIdKey())
    if (!currentLeaderId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      this.renewLeadership()
      return true
    }
    return currentLeaderId === this.leaderId
  }

  private isLeader() {
    const currentLeaderId = TypedLocalStorage.getItem(this.getLeaderIdKey())
    const expiresAt = Number(TypedLocalStorage.getItem(this.getLeaderExpiresKey()) || '0')
    return currentLeaderId === this.leaderId && expiresAt > Date.now()
  }

  private clearTimers() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.leaderRenewTimer) {
      clearInterval(this.leaderRenewTimer)
      this.leaderRenewTimer = null
    }
  }

  async start() {
    if (this.started) return
    this.started = true

    const config = await this.fetchRuntimeConfig()
    this.tryBecomeLeader()
    this.clearTimers()

    this.leaderRenewTimer = setInterval(() => {
      if (this.tryBecomeLeader()) {
        this.renewLeadership()
      }
    }, LEADER_RENEW_INTERVAL_MS)

    this.timer = setInterval(() => {
      void this.sendHeartbeat()
    }, config.intervalSeconds * 1000)

    await this.sendHeartbeat()
  }

  stop() {
    this.started = false
    this.clearTimers()
    if (this.isLeader()) {
      void this.sendStopHeartbeat()
      TypedLocalStorage.removeItem(this.getLeaderIdKey())
      TypedLocalStorage.removeItem(this.getLeaderExpiresKey())
    }
  }

  private async sendStopHeartbeat() {
    try {
      await getUserHeartbeatControllerApi().stopHeartbeat({ params: {} as never } as any)
    } catch (error) {
      console.warn('Heartbeat stop failed:', error)
    }
  }

  private handleStorage = () => {
    if (!this.started) return
    if (this.isLeader()) {
      this.renewLeadership()
      return
    }

    if (this.tryBecomeLeader()) {
      this.renewLeadership()
      void this.sendHeartbeat()
    }
  }

  private handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && this.started) {
      void this.sendHeartbeat()
    }
  }

}

export const heartbeatService = HeartbeatService.getInstance()
