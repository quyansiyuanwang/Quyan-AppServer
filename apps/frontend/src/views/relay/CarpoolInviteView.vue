<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getErrorMessage } from '@/utils/error-utils'
import { useSessionStore } from '@/stores/sessionStore'
import { ElMessage } from '@/utils/elementPlusRuntime'
import { useRoute, useRouter } from 'vue-router'
import type { CarpoolOrderDto } from '@/client/types.gen'
import { i18ns } from '@/locales'
import { carpoolService } from '@/service/carpoolService'
import { formatCarpoolDate, formatCarpoolQuota } from './carpool'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const token = computed(() => String((route.params as { token?: string }).token || ''))
const isAuthenticated = computed(() => session.isAuthenticated)
const acceptedOrder = ref<CarpoolOrderDto>()
const submitting = ref(false)
const error = ref('')
let inviteVersion = 0
watch(token, () => {
  inviteVersion++
  acceptedOrder.value = undefined
  error.value = ''
  submitting.value = false
})
const accept = async () => {
  if (!token.value || !isAuthenticated.value || submitting.value || acceptedOrder.value) return
  const inviteToken = token.value
  const version = inviteVersion
  submitting.value = true
  error.value = ''
  try {
    const result = await carpoolService.acceptInvite(inviteToken)
    if (version !== inviteVersion) return
    acceptedOrder.value = result.data as CarpoolOrderDto
    ElMessage.success(i18ns.t('carpool.invite.joined'))
  } catch (caught) {
    if (version === inviteVersion)
      error.value = getErrorMessage(caught, i18ns.t('carpool.invite.acceptFailed'))
  } finally {
    if (version === inviteVersion) submitting.value = false
  }
}
const login = () => router.push({ name: 'login', query: { redirect: route.fullPath } })
const continueToOrder = () => {
  if (acceptedOrder.value)
    void router.push({ name: 'carpoolDetail', params: { id: acceptedOrder.value.id } })
}
</script>

<template>
  <section class="page invite-page">
    <header class="heading">
      <h1>{{ i18ns.t('carpool.invite.title') }}</h1>
      <p>{{ i18ns.t('carpool.invite.subtitle') }}</p>
    </header>
    <el-result
      v-if="!token"
      icon="error"
      :title="i18ns.t('carpool.invite.invalidLink')"
      :sub-title="i18ns.t('carpool.invite.invalidHint')"
    />
    <el-card v-else class="invite-card">
      <el-alert type="warning" :closable="false" :title="i18ns.t('carpool.invite.freezeNotice')" />
      <p>{{ i18ns.t('carpool.invite.intro') }}</p>
      <el-descriptions v-if="acceptedOrder" :column="1" border>
        <el-descriptions-item :label="i18ns.t('carpool.common.colPackage')">{{
          acceptedOrder.packageName
        }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('carpool.common.quota')">{{
          formatCarpoolQuota(acceptedOrder.totalQuota, acceptedOrder.quotaUnit)
        }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('carpool.common.deadline')">{{
          formatCarpoolDate(acceptedOrder.formationDeadlineAt)
        }}</el-descriptions-item>
      </el-descriptions>
      <p v-if="!acceptedOrder" class="muted">{{ i18ns.t('carpool.invite.previewUnavailable') }}</p>
      <p v-if="!acceptedOrder" class="muted">{{ i18ns.t('carpool.invite.expiryNotice') }}</p>
      <el-alert
        v-if="error"
        type="error"
        :closable="false"
        :title="i18ns.t('carpool.invite.unavailable')"
        :description="error"
      />
      <div class="actions">
        <el-button v-if="!isAuthenticated" @click="login">{{
          i18ns.t('carpool.invite.loginFirst')
        }}</el-button>
        <el-button
          v-if="!acceptedOrder"
          type="primary"
          :disabled="!isAuthenticated"
          :loading="submitting"
          @click="accept"
          >{{ i18ns.t('carpool.invite.accept') }}</el-button
        >
        <el-button v-else type="primary" @click="continueToOrder">{{
          i18ns.t('carpool.invite.continue')
        }}</el-button>
      </div>
    </el-card>
  </section>
</template>
<style scoped>
.invite-page {
  display: grid;
  gap: 20px;
}
.invite-card {
  max-width: 560px;
}
.actions {
  display: flex;
  gap: 12px;
  margin-top: 20px;
  flex-wrap: wrap;
}
.muted {
  color: var(--el-text-color-secondary);
}
</style>
