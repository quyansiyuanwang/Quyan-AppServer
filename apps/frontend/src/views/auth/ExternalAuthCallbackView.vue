<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { i18ns } from '@/locales'
import { socialAuthService } from '@/service/socialAuthService'
import { authorizationService } from '@/service/authorizationService'
import { getLoginRoute, getSafeAuthRedirect } from '@/utils/auth-routes'
import { completeCentralLogin, getDefaultAccountDestination } from '@/service/centralLoginService'

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
  const redirect = getSafeAuthRedirect(route.query.redirect, {
    blockedExactPaths: ['/login', '/register', '/forgot-password'],
    blockedPrefixes: ['/auth/verify'],
  })

  if (!provider || !code || !state) {
    ElMessage.error(i18ns.t('message.error.loginFailed'))
    await router.replace(getLoginRoute())
    return
  }

  try {
    const result = await socialAuthService.externalAuthCallback(provider, code, state)

    if (socialAuthService.isAuthData(result)) {
      authorizationService.completeLogin(result)
      if (await completeCentralLogin(route.query.flowId)) return
      await authorizationService.reloadAuthStoresAfterLogin(result.user)
      window.location.replace(getDefaultAccountDestination())
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
      authorizationService.setPendingPolicyConsentChallenge(result.challengeToken, redirect)
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

    if (socialAuthService.isExternalIdentity(result)) {
      const token = await authorizationService.bootstrapSession()
      if (!token || !(await completeCentralLogin(route.query.flowId))) {
        ElMessage.error(i18ns.t('SettingsView.externalAccountsBindFailed'))
        await router.replace(getLoginRoute())
      }
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
