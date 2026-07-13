<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { i18ns } from '@/locales'
import { socialAuthService } from '@/service/socialAuthService'
import { authorizationService } from '@/service/authorizationService'
import { getLoginRoute, getSafeAuthRedirect } from '@/utils/auth-routes'
import type { QrLoginSessionContextDto, QrLoginSessionStatusResponse } from '@/client/types.gen'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const bootstrapping = ref(true)
const submitting = ref(false)
const session = ref<QrLoginSessionContextDto | null>(null)
const isAuthenticated = ref(false)

const sessionId = computed(() =>
  typeof route.query.sessionId === 'string' && route.query.sessionId.trim()
    ? route.query.sessionId.trim()
    : '',
)

const isEndedStatus = computed(
  () =>
    session.value?.status === 'expired' ||
    session.value?.status === 'consumed' ||
    session.value?.status === 'approved' ||
    session.value?.status === 'rejected',
)

const canDecide = computed(() => isAuthenticated.value && !!session.value && !isEndedStatus.value)

const statusMeta = computed(() => {
  switch (session.value?.status) {
    case 'approved':
      return {
        tagType: 'success' as const,
        title: '已批准登录',
        description: '当前浏览器登录请求已确认，电脑端会继续完成登录。',
      }
    case 'rejected':
      return {
        tagType: 'danger' as const,
        title: '已拒绝登录',
        description: '当前浏览器登录请求已被拒绝。',
      }
    case 'scanned':
      return {
        tagType: 'warning' as const,
        title: '等待确认',
        description: '请核对本次登录设备信息，然后决定是否允许登录。',
      }
    case 'expired':
      return {
        tagType: 'info' as const,
        title: '会话已过期',
        description: '请返回电脑端刷新二维码后重试。',
      }
    case 'consumed':
      return {
        tagType: 'info' as const,
        title: '会话已结束',
        description: '该扫码会话已经完成处理。',
      }
    default:
      return {
        tagType: 'primary' as const,
        title: '待确认登录',
        description: '请确认这是否是你发起的登录请求。',
      }
  }
})

const finalRedirect = computed(() =>
  getSafeAuthRedirect(route.query.redirect, {
    blockedExactPaths: ['/login', '/register', '/forgot-password'],
    blockedPrefixes: ['/auth/verify', '/auth/qr-approve'],
  }),
)

const loginRoute = computed(() => {
  if (!sessionId.value) return getLoginRoute(finalRedirect.value)

  const continuation = `/auth/qr-approve?sessionId=${encodeURIComponent(sessionId.value)}${
    finalRedirect.value ? `&redirect=${encodeURIComponent(finalRedirect.value)}` : ''
  }`

  return getLoginRoute(continuation)
})

const loadContext = async () => {
  if (!sessionId.value) {
    ElMessage.error(i18ns.t('message.error.loginFailed'))
    await router.replace(getLoginRoute())
    return
  }

  loading.value = true
  try {
    session.value = await socialAuthService.getQrLoginSessionContext(sessionId.value)
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('message.error.loginFailed'))
  } finally {
    loading.value = false
  }
}

const bootstrap = async () => {
  bootstrapping.value = true
  try {
    isAuthenticated.value = Boolean(await authorizationService.bootstrapSession())
  } finally {
    bootstrapping.value = false
  }
}

const handleConfirm = async (approve: boolean) => {
  if (!sessionId.value) return

  submitting.value = true
  try {
    let status: QrLoginSessionStatusResponse

    if (approve) {
      await socialAuthService.scanQrLogin(sessionId.value)
      status = await socialAuthService.confirmQrLogin(sessionId.value, true)
      session.value = session.value ? { ...session.value, status: status.status } : session.value
      ElMessage.success(i18ns.t('message.information.loginSuccess'))
    } else {
      status = await socialAuthService.confirmQrLogin(sessionId.value, false)
      session.value = {
        ...(session.value ?? {
          sessionId: sessionId.value,
          expiresIn: 0,
          createdAt: new Date().toISOString(),
        }),
        status: status.status,
      } as QrLoginSessionContextDto
      ElMessage.info(i18ns.t('cancel'))
    }
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('message.error.loginFailed'))
    await loadContext()
  } finally {
    submitting.value = false
  }
}

const handleBackHome = async () => {
  await router.replace(finalRedirect.value || '/home')
}

watch(
  () => sessionId.value,
  () => {
    if (!sessionId.value) return
    void loadContext()
  },
)

onMounted(async () => {
  await Promise.all([bootstrap(), loadContext()])
})
</script>

<template>
  <div class="auth-view-root qr-approval-view">
    <div class="qr-approval-view__container">
      <el-card class="qr-approval-view__card" shadow="hover">
        <template #header>
          <div class="qr-approval-view__header">
            <div>
              <h2>{{ i18ns.t('loginOrRegisterPage.qrApprovalTitle') }}</h2>
              <p>请确认是否允许当前设备登录</p>
            </div>
            <el-tag :type="statusMeta.tagType" effect="light">{{ statusMeta.title }}</el-tag>
          </div>
        </template>

        <el-skeleton :loading="loading || bootstrapping" animated :rows="6">
          <div v-if="!isAuthenticated" class="qr-approval-view__unauthenticated">
            <p>{{ i18ns.t('loginOrRegisterPage.qrApprovalNeedLogin') }}</p>
            <el-button type="primary" @click="router.push(loginRoute)">前往登录</el-button>
          </div>

          <div v-else-if="session" class="qr-approval-view__content">
            <el-alert
              :title="statusMeta.title"
              :description="statusMeta.description"
              type="info"
              :closable="false"
              show-icon
            />

            <el-descriptions :column="1" border class="qr-approval-view__details">
              <el-descriptions-item label="请求 IP">
                {{ session.requestIp || 'unknown' }}
              </el-descriptions-item>
              <el-descriptions-item label="大致位置">
                {{ session.requestLocation || '未知地区' }}
              </el-descriptions-item>
              <el-descriptions-item label="设备摘要">
                {{ session.deviceSummary || session.requestUserAgent || '未知设备' }}
              </el-descriptions-item>
              <el-descriptions-item label="创建时间">
                {{ session.createdAt }}
              </el-descriptions-item>
              <el-descriptions-item label="当前已识别用户">
                {{ session.user?.username || session.user?.email || '待确认' }}
              </el-descriptions-item>
            </el-descriptions>

            <div v-if="isEndedStatus" class="qr-approval-view__ended">
              <el-result
                :icon="
                  session.status === 'approved'
                    ? 'success'
                    : session.status === 'rejected'
                      ? 'error'
                      : 'warning'
                "
                :title="statusMeta.title"
                :sub-title="statusMeta.description"
              />
              <div class="qr-approval-view__actions qr-approval-view__actions--center">
                <el-button type="primary" @click="handleBackHome">返回</el-button>
              </div>
            </div>

            <div v-else class="qr-approval-view__actions">
              <el-button
                plain
                :loading="submitting"
                :disabled="!canDecide"
                @click="handleConfirm(false)"
                >{{ i18ns.t('loginOrRegisterPage.qrApprovalDeny') }}</el-button
              >
              <el-button
                type="primary"
                :loading="submitting"
                :disabled="!canDecide"
                @click="handleConfirm(true)"
              >
                {{ i18ns.t('loginOrRegisterPage.qrApprovalAllow') }}
              </el-button>
            </div>
          </div>
        </el-skeleton>
      </el-card>
    </div>
  </div>
</template>

<style scoped lang="scss">
.qr-approval-view {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.qr-approval-view__container {
  width: min(680px, 100%);
}

.qr-approval-view__card {
  border-radius: 8px;
}

.qr-approval-view__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.qr-approval-view__header h2 {
  margin: 0;
  font-size: 24px;
}

.qr-approval-view__header p {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
}

.qr-approval-view__unauthenticated,
.qr-approval-view__content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.qr-approval-view__details {
  margin-top: 4px;
}

.qr-approval-view__actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.qr-approval-view__actions--center {
  justify-content: center;
}
</style>
