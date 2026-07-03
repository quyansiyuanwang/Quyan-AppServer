<template>
  <div
    :class="
      isDesktop ? 'trusted-device-management desktop-page' : 'trusted-device-mobile mobile-page'
    "
  >
    <el-card :class="isDesktop ? 'page-card' : 'mobile-card'">
      <template #header>
        <div class="card-header toolbar-row">
          <span>{{ i18ns.t('twoFactor.trustedDevicesTitle') }}</span>
          <el-button :icon="Refresh" :loading="loading" @click="handleRefresh">
            {{ i18ns.t('twoFactor.trustedDevicesRefresh') }}
          </el-button>
        </div>
      </template>

      <p class="section-desc">{{ i18ns.t('twoFactor.trustedDevicesDesc') }}</p>

      <div v-if="errorMessage" class="trusted-error-actions">
        <el-alert
          class="trusted-error"
          :title="errorMessage"
          type="error"
          show-icon
          :closable="false"
        />
        <el-button
          class="trusted-error-retry"
          size="small"
          :loading="loading"
          @click="handleRetryLoad"
        >
          {{ i18ns.t('twoFactor.trustedDevicesRefresh') }}
        </el-button>
      </div>

      <div
        class="trusted-skeleton-region"
        :aria-live="loading ? 'polite' : 'off'"
        :aria-busy="loading"
      >
        <el-skeleton :loading="loading" :rows="4" animated>
          <el-empty
            v-if="devices.length === 0"
            :description="i18ns.t('twoFactor.trustedDevicesEmpty')"
            :image-size="58"
          />

          <div v-else class="list">
            <el-card v-for="device in devices" :key="device.deviceId" class="item" shadow="never">
              <div class="device-card-head">
                <span class="device-title">{{ getTrustedDeviceLabel(device) }}</span>
                <span class="device-expire-chip">
                  <span class="chip-label">{{ i18ns.t('twoFactor.trustedDeviceExpiresIn') }}</span>
                  <span class="chip-value">{{
                    formatTrustedDeviceExpires(device.expiresInSeconds)
                  }}</span>
                </span>
              </div>

              <div class="device-meta-grid">
                <div class="device-line">
                  <span class="device-line-label">{{ i18ns.t('twoFactor.trustedDeviceIp') }}:</span>
                  <span class="device-line-value">{{
                    device.ipAddress || i18ns.t('twoFactor.trustedDeviceUnknown')
                  }}</span>
                </div>

                <div class="device-line">
                  <span class="device-line-label"
                    >{{ i18ns.t('twoFactor.trustedDeviceAgent') }}:</span
                  >
                  <span class="device-line-value">{{
                    device.userAgent || i18ns.t('twoFactor.trustedDeviceUnknown')
                  }}</span>
                </div>

                <div class="device-line">
                  <span class="device-line-label"
                    >{{ i18ns.t('twoFactor.trustedDeviceTrustedAt') }}:</span
                  >
                  <span class="device-line-value">{{
                    formatTrustedDeviceTime(device.trustedAt)
                  }}</span>
                </div>

                <div class="device-line">
                  <span class="device-line-label"
                    >{{ i18ns.t('twoFactor.trustedDeviceLastUsedAt') }}:</span
                  >
                  <span class="device-line-value">{{
                    formatTrustedDeviceTime(device.lastUsedAt)
                  }}</span>
                </div>
              </div>

              <el-button
                class="delete-btn"
                type="danger"
                plain
                size="small"
                :aria-label="
                  i18ns.t('twoFactor.trustedDeviceDeleteAria', {
                    device: getTrustedDeviceLabel(device),
                  })
                "
                :loading="removingDeviceId === device.deviceId"
                @click="handleRemoveTrustedDevice(device)"
              >
                {{ i18ns.t('delete') }}
              </el-button>
            </el-card>
          </div>
        </el-skeleton>
      </div>

      <el-pagination
        v-if="total > pageSize"
        class="trusted-pagination"
        background
        layout="prev, pager, next"
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        :disabled="loading"
        :aria-busy="loading"
        aria-live="polite"
        @current-change="handlePageChange"
      />

      <p
        v-if="loading && total > pageSize"
        class="trusted-pagination-loading"
        role="status"
        aria-live="polite"
      >
        {{ i18ns.t('twoFactor.trustedDevicesPageLoading') }}
      </p>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { usePageDevice } from '@/composables/usePageDevice'
import { usePagination } from '@/composables/usePagination'
import { trustedDeviceService } from '@/service/twoFactor/trustedDeviceService'
import type { TwoFactorTrustedDevice } from '@/types/trusted-device'
import { isRequestCanceled, isValidationFieldError } from '@/utils/error-utils'

const { isDesktop } = usePageDevice()

const removingDeviceId = ref<string | null>(null)
const errorMessage = ref('')
const devices = ref<TwoFactorTrustedDevice[]>([])
const isUnmounted = ref(false)

const {
  loading,
  page,
  pageSize,
  total,
  setPage,
  resetToFirstPage,
  applyResult,
  recalculatePageByTotal,
  beginRequest,
  isRequestCurrent,
  finalizeRequest,
  cancelRequest,
} = usePagination({
  initialPage: 1,
  initialPageSize: 10,
})

const formatTrustedDeviceTime = (trustedAt: string | null): string => {
  if (!trustedAt) return i18ns.t('twoFactor.trustedDeviceUnknown')
  const date = new Date(trustedAt)
  if (Number.isNaN(date.getTime())) return i18ns.t('twoFactor.trustedDeviceUnknown')
  return date.toLocaleString()
}

const formatTrustedDeviceExpires = (expiresInSeconds: number | null): string => {
  if (expiresInSeconds === null || expiresInSeconds < 0)
    return i18ns.t('twoFactor.trustedDeviceUnknown')

  const totalSeconds = Math.max(0, Math.floor(expiresInSeconds))
  if (totalSeconds === 0) {
    return i18ns.t('twoFactor.trustedDeviceExpiresSoon')
  }

  const unitValues = [
    {
      value: Math.floor(totalSeconds / 86400),
      key: 'twoFactor.trustedDeviceDurationDays',
    },
    {
      value: Math.floor((totalSeconds % 86400) / 3600),
      key: 'twoFactor.trustedDeviceDurationHours',
    },
    {
      value: Math.floor((totalSeconds % 3600) / 60),
      key: 'twoFactor.trustedDeviceDurationMinutes',
    },
    {
      value: totalSeconds % 60,
      key: 'twoFactor.trustedDeviceDurationSeconds',
    },
  ] as const

  const parts = unitValues
    .filter((unit) => unit.value > 0)
    .slice(0, 2)
    .map((unit) => i18ns.t(unit.key, { count: unit.value }))

  if (parts.length === 0) {
    return i18ns.t('twoFactor.trustedDeviceExpiresSoon')
  }

  return parts.join(' ')
}

const getTrustedDeviceLabel = (device: TwoFactorTrustedDevice): string => {
  return device.ipAddress || device.userAgent || device.deviceId.slice(0, 12)
}

const loadTrustedDevices = async (silent = false) => {
  const requestContext = beginRequest()

  try {
    errorMessage.value = ''
    const result = await trustedDeviceService.listTrustedDevices({
      page: page.value,
      pageSize: pageSize.value,
      signal: requestContext.signal,
    })

    if (isUnmounted.value || !isRequestCurrent(requestContext.requestId)) return

    devices.value = result.devices
    applyResult(result)
  } catch (error: any) {
    if (isUnmounted.value || !isRequestCurrent(requestContext.requestId)) return
    if (isRequestCanceled(error)) return

    errorMessage.value = error?.message || i18ns.t('twoFactor.trustedDevicesLoadFailed')
    if (!silent) {
      ElMessage.error(error?.message || i18ns.t('twoFactor.trustedDevicesLoadFailed'))
    }
  } finally {
    if (isUnmounted.value || !isRequestCurrent(requestContext.requestId)) return
    finalizeRequest(requestContext)
  }
}

const handleRefresh = async () => {
  resetToFirstPage()
  await loadTrustedDevices()
}

const handleRetryLoad = async () => {
  await loadTrustedDevices(true)
}

const handlePageChange = async (nextPage: number) => {
  setPage(nextPage)
  await loadTrustedDevices()
}

const handleRemoveTrustedDevice = async (device: TwoFactorTrustedDevice) => {
  const displayDevice = getTrustedDeviceLabel(device)

  try {
    await ElMessageBox.confirm(
      i18ns.t('twoFactor.trustedDeviceDeleteConfirm', { device: displayDevice }),
      i18ns.t('twoFactor.trustedDeviceDeleteTitle'),
      {
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      },
    )
  } catch {
    return
  }

  try {
    removingDeviceId.value = device.deviceId
    const removed = await trustedDeviceService.removeTrustedDevice(device.deviceId)

    if (removed) {
      const nextTotal = Math.max(0, total.value - 1)
      recalculatePageByTotal(nextTotal)
    }

    await loadTrustedDevices(true)
    if (isUnmounted.value) return

    errorMessage.value = ''
    ElMessage.success(i18ns.t('twoFactor.trustedDeviceDeleteSuccess'))
  } catch (error: any) {
    if (isUnmounted.value) return

    if (isValidationFieldError(error, 'deviceId')) {
      ElMessage.error(i18ns.t('twoFactor.trustedDeviceInvalidId'))
      return
    }

    ElMessage.error(error?.message || i18ns.t('twoFactor.trustedDeviceDeleteFailed'))
  } finally {
    if (isUnmounted.value) return
    removingDeviceId.value = null
  }
}

onMounted(() => {
  void loadTrustedDevices()
})

onUnmounted(() => {
  isUnmounted.value = true
  cancelRequest()
})
</script>

<style scoped>
.trusted-device-mobile {
  padding: 8px 6px 16px;
}

.trusted-error-actions {
  margin-bottom: 12px;
}

.trusted-error {
  margin-bottom: 8px;
}

.trusted-error-retry {
  margin-left: auto;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item {
  border: 1px solid var(--el-border-color);
  background: linear-gradient(
    180deg,
    var(--el-fill-color-lighter) 0%,
    var(--el-fill-color-light) 100%
  );
  border-radius: 14px;
  box-shadow: 0 8px 18px rgb(15 23 42 / 6%);
}

.device-card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 10px;
}

.device-title {
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 600;
  word-break: break-all;
}

.device-expire-chip {
  flex-shrink: 0;
  border-radius: 10px;
  border: 1px solid var(--el-color-primary-light-7);
  background: var(--el-color-primary-light-9);
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}

.chip-label {
  color: var(--el-text-color-secondary);
  font-size: 11px;
  line-height: 1;
}

.chip-value {
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}

.device-meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px 12px;
}

.device-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.device-line-label {
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  font-size: 12px;
}

.device-line-value {
  color: var(--el-text-color-regular);
  font-size: 13px;
  word-break: break-all;
}

.delete-btn {
  margin-top: 12px;
}

.trusted-pagination {
  margin-top: 12px;
  justify-content: flex-end;
}

.trusted-pagination-loading {
  margin-top: 6px;
  text-align: right;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

@media (max-width: 768px) {
  .device-card-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .device-expire-chip {
    align-items: flex-start;
  }

  .device-meta-grid {
    grid-template-columns: 1fr;
  }
}
</style>
