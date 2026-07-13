<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { i18ns } from '@/locales'
import { socialAuthService } from '@/service/socialAuthService'
import { authorizationService } from '@/service/authorizationService'
import { getLoginRoute } from '@/utils/auth-routes'

const route = useRoute()
const router = useRouter()
const loading = ref(true)

const provider = String((route.params as Record<string, unknown>).provider || '') as
  | 'github'
  | 'wechat-open'
  | 'wechat-web'

onMounted(async () => {
  const code = typeof route.query.code === 'string' ? route.query.code : ''
  const state = typeof route.query.state === 'string' ? route.query.state : ''
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : undefined

  if (!provider || !code || !state) {
    ElMessage.error(i18ns.t('message.error.loginFailed'))
    await router.replace(getLoginRoute())
    return
  }

  try {
    const result = await socialAuthService.externalAuthCallback(provider, code, state)

    if (socialAuthService.isAuthData(result)) {
      authorizationService.completeLogin(result)
      await authorizationService.reloadAuthStoresAfterLogin(result.user)
      await router.replace(redirect || '/home')
      return
    }

    if (authorizationService.isTwoFactorChallengePayload(result)) {
      authorizationService.setPendingTwoFactorChallenge(result.challengeToken, redirect, 'login')
      await router.replace({
        name: 'authVerification',
        query: {
          method: 'code',
          authEntry: 'login',
          ...(redirect ? { redirect } : {}),
        },
      })
      return
    }

    if (authorizationService.isPolicyConsentPayload(result)) {
      ElMessage.warning(i18ns.t('loginOrRegisterPage.loginConsentPendingHint'))
      await router.replace(getLoginRoute(redirect))
      return
    }

    if (socialAuthService.isBindingRequiredData(result)) {
      ElMessage.warning(i18ns.t('SettingsView.externalAccountsBindRequired'))
      await router.replace({
        name: 'settingsSecurity',
        query: { bindProvider: provider, bindingToken: result.bindingToken },
      })
      return
    }

    ElMessage.error(i18ns.t('message.error.loginFailed'))
    await router.replace(getLoginRoute())
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('message.error.loginFailed'))
    await router.replace(getLoginRoute())
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div
    class="auth-view-root"
    style="display: flex; align-items: center; justify-content: center; min-height: 60vh"
  >
    <el-card style="width: min(520px, 92vw)">
      <el-skeleton :loading="loading" animated :rows="4">
        <div style="text-align: center">
          <p>{{ i18ns.t('message.information.loggingIn') }}</p>
        </div>
      </el-skeleton>
    </el-card>
  </div>
</template>
