import { useRequestStore } from '@/stores/request'
import { CustomCode } from '@/constant/custom-code'
import { toServiceError } from '@/utils/error-utils'
import type {
  BusinessLogControllerGetBusinessLogsData,
  BusinessLogFilterOptionsResponse,
  ForceOfflineSessionResponse,
  ForceOfflineUserResponse,
  ServerLogType,
  UserOnlineMonitorDetailDto,
  UserOnlineMonitorOverviewResponse,
  UserOnlineMonitorTimelineGroupedResponse,
} from '@/client/types.gen'
import { cacheObject } from '@/utils/common'
import { createSystemControllerApi } from '@/client/services/system-controller.gen'
import { createBusinessLogControllerApi } from '@/client/services/business-log-controller.gen'
import { createUserHeartbeatControllerApi } from '@/client/services/user-heartbeat-controller.gen'

const userHeartbeatApi = cacheObject(() =>
  createUserHeartbeatControllerApi(useRequestStore().getAxios()),
)

const businessLogApi = cacheObject(() =>
  createBusinessLogControllerApi(useRequestStore().getAxios()),
)

const systemApi = cacheObject(() => createSystemControllerApi(useRequestStore().getAxios()))

type BusinessLogFilters = Omit<
  NonNullable<BusinessLogControllerGetBusinessLogsData['query']>,
  'page' | 'pageSize'
>

type ConsumptionStatsFilters = {
  startDate?: string
  endDate?: string
  userIds?: string[]
  models?: string[]
  channels?: string[]
  relayTokenIds?: string[]
}

type SystemLogStatsFilters = {
  user?: string
  requestID?: string
  path?: string
  method?: string[]
  statusCode?: number[]
  ip?: string
  startDate?: string
  endDate?: string
  search?: string
}

const buildConsumptionStatsParams = (
  filters?: ConsumptionStatsFilters,
): ConsumptionStatsFilters | undefined => {
  if (!filters) return undefined

  return {
    startDate: filters.startDate,
    endDate: filters.endDate,
    userIds: filters.userIds?.length ? filters.userIds : undefined,
    models: filters.models?.length ? filters.models : undefined,
    channels: filters.channels?.length ? filters.channels : undefined,
    relayTokenIds: filters.relayTokenIds?.length ? filters.relayTokenIds : undefined,
  }
}

/**
 * System service for managing system statistics and logs
 * Singleton pattern
 */
class SystemService {
  private static instance: SystemService

  private constructor() {}

  public static getInstance(): SystemService {
    if (!SystemService.instance) {
      SystemService.instance = new SystemService()
    }
    return SystemService.instance
  }

  /**
   * Get system statistics
   * @param silent If true, skip progress bar tracking
   * @returns System statistics including uptime, user count, group count, permission count
   */
  public async getSystemStats(silent = false) {
    const result = await systemApi.getSystemStats({}, { skipProgressBar: silent })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to fetch system statistics')
  }

  public async getConsumptionStats(filters?: ConsumptionStatsFilters, silent = false) {
    const params = buildConsumptionStatsParams(filters)
    const result = await systemApi.getConsumptionStats(params ? { params } : undefined, {
      skipProgressBar: silent,
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to fetch consumption statistics')
  }

  /**
   * Get system logs with pagination and filters
   * @param page Page number (default: 1)
   * @param pageSize Page size (default: 10)
   * @param filters Optional filters (user, requestID, path, method, statusCode, startDate, endDate)
   * @returns Paginated system logs
   */
  public async getSystemLogs(
    page: number = 1,
    pageSize: number = 10,
    filters?: {
      user?: string
      requestID?: string
      path?: string
      method?: string[]
      statusCode?: number[]
      ip?: string
      startDate?: string
      endDate?: string
    },
  ) {
    const result = await systemApi.getSystemLogs({
      params: {
        page,
        pageSize,
        ...filters,
      },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to fetch system logs')
  }

  public async getSystemLogStats(filters?: SystemLogStatsFilters, silent = false) {
    const result = await systemApi.getSystemLogStats(
      {
        params: {
          ...filters,
          method: filters?.method?.length ? filters.method : undefined,
          statusCode: filters?.statusCode?.length ? filters.statusCode : undefined,
        },
      },
      { skipProgressBar: silent },
    )

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to fetch system log statistics')
  }

  /**
   * Get business logs with pagination and filters
   * @param page Page number (default: 1)
   * @param pageSize Page size (default: 10)
   * @param filters Optional filters (operationType, operationCategory, actor, target, success)
   * @returns Paginated business logs
   */
  public async getBusinessLogs(
    page: number = 1,
    pageSize: number = 10,
    filters?: BusinessLogFilters,
    signal?: AbortSignal,
  ) {
    const result = await businessLogApi.getBusinessLogs(
      {
        params: {
          page,
          pageSize,
          ...filters,
        },
      },
      signal ? { signal } : undefined,
    )

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to fetch business logs')
  }

  public async getBusinessLogStats(filters?: BusinessLogFilters, signal?: AbortSignal) {
    const result = await businessLogApi.getBusinessLogStats(
      {
        params: {
          ...filters,
        },
      },
      signal ? { signal } : undefined,
    )

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to fetch business log statistics')
  }

  public async getBusinessLogFilterOptions(): Promise<BusinessLogFilterOptionsResponse> {
    const result = await businessLogApi.getBusinessLogFilterOptions({})

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to fetch business log filter options')
  }

  public async getUserOnlineMonitorOverview(
    page: number = 1,
    pageSize: number = 10,
    filters?: {
      keyword?: string
      ipAddress?: string
      location?: string
      status?: 'online' | 'offline'
    },
    signal?: AbortSignal,
  ): Promise<UserOnlineMonitorOverviewResponse> {
    const result = await userHeartbeatApi.getOverview(
      {
        params: {
          page,
          pageSize,
          ...filters,
        },
      },
      signal ? { signal } : undefined,
    )

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to fetch user online monitor overview')
  }

  public async getUserOnlineMonitorDetail(userId: string): Promise<UserOnlineMonitorDetailDto> {
    const result = await userHeartbeatApi.getUserDetail({
      path: { userId },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to fetch user online monitor detail')
  }

  public async getUserOnlineMonitorTimeline(
    userId: string,
    page: number = 1,
    pageSize: number = 10,
    filters?: {
      onlineOnly?: boolean
      offlineOnly?: boolean
      startDate?: string
      endDate?: string
    },
    signal?: AbortSignal,
  ): Promise<UserOnlineMonitorTimelineGroupedResponse> {
    const result = await userHeartbeatApi.getUserTimeline(
      {
        path: { userId },
        params: {
          page,
          pageSize,
          ...filters,
        },
      },
      signal ? { signal } : undefined,
    )

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to fetch user online monitor timeline')
  }

  public async forceOfflineSession(sessionId: string): Promise<ForceOfflineSessionResponse> {
    const result = await userHeartbeatApi.forceOfflineSession({
      path: { sessionId },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to force offline session')
  }

  public async forceOfflineUser(userId: string): Promise<ForceOfflineUserResponse> {
    const result = await userHeartbeatApi.forceOfflineUser({
      path: { userId },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to force offline user')
  }

  public async getClientIp(): Promise<string> {
    const result = await systemApi.getClientIp({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data.ip
    }
    return ''
  }

  public async getBackendBuildInfo() {
    const result = await systemApi.getBuildInfo({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result, 'Failed to fetch build info')
  }

  /**
   * Get a single system log detail (including response field)
   * @param logId Log ID
   * @returns Full log detail with response
   */
  public async getSystemLogDetail(logId: string) {
    const result = await systemApi.getSystemLogDetail({
      path: { logId },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to fetch log detail')
  }

  public async getServerLogFiles(type?: ServerLogType) {
    const result = await systemApi.getServerLogFiles({
      params: {
        type,
      },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to fetch server log files')
  }

  public async getServerLogContent(fileName: string, lines = 200, search?: string) {
    const result = await systemApi.getServerLogContent({
      path: { fileName },
      params: {
        lines,
        search,
      },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to fetch server log content')
  }
}

export default SystemService.getInstance()
