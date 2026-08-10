<template>
  <div class="auth-view-root" />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { i18ns } from '@/locales'
import { socialAuthService } from '@/service/socialAuthService'
import { authorizationService } from '@/service/authorizationService'
import { getLoginRoute } from '@/utils/auth-routes'

const route = useRoute()
const router = useRouter()

onMounted(async () => {
  const provider = route.query.provider
  const flowId = route.query.flowId
  if (
    (provider !== 'github' && provider !== 'wechat-open' && provider !== 'wechat-web') ||
    typeof flowId !== 'string'
  ) {
    await router.replace(getLoginRoute())
    return
  }

  try {
    if (!(await authorizationService.bootstrapSession())) {
      await router.replace(getLoginRoute(route.fullPath))
      return
    }
    const callbackPath = `/auth/external/${provider}/callback?flowId=${encodeURIComponent(flowId)}`
    const { authorizeUrl } = await socialAuthService.startExternalAuth(
      provider,
      'bind',
      callbackPath,
    )
    window.location.replace(authorizeUrl)
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('SettingsView.externalAccountsBindFailed'))
    await router.replace(getLoginRoute())
  }
})
</script>
