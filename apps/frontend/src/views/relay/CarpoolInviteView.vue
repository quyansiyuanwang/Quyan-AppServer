<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import type { CarpoolOrderDto } from '@/client/types.gen'
import { i18ns } from '@/locales'
import { carpoolService } from '@/service/carpoolService'

const route = useRoute()
const router = useRouter()
const token = computed(() => String((route.params as { token?: string }).token || ''))
const submitting = ref(false)
const error = ref('')
const accept = async () => {
  if (!token.value) return
  submitting.value = true
  error.value = ''
  try {
    const result = await carpoolService.acceptInvite(token.value)
    const orderId = (result.data as CarpoolOrderDto).id
    ElMessage.success(i18ns.t('carpool.invite.joined'))
    await router.push({ name: 'carpoolDetail', params: { id: orderId } })
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : i18ns.t('carpool.invite.acceptFailed')
  } finally {
    submitting.value = false
  }
}
const login = () => router.push({ name: 'login', query: { redirect: route.fullPath } })
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
      <p class="muted">{{ i18ns.t('carpool.invite.expiryNotice') }}</p>
      <el-alert
        v-if="error"
        type="error"
        :closable="false"
        :title="i18ns.t('carpool.invite.unavailable')"
        :description="error"
      />
      <div class="actions">
        <el-button @click="login">{{ i18ns.t('carpool.invite.loginFirst') }}</el-button
        ><el-button type="primary" :loading="submitting" @click="accept">{{
          i18ns.t('carpool.invite.accept')
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
}
.muted {
  color: var(--el-text-color-secondary);
}
</style>
