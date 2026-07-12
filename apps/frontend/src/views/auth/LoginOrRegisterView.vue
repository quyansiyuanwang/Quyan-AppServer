<script setup lang="ts">
import { defineAsyncComponent, provide } from 'vue'
import LoginOrRegisterCard from './login-or-register/components/LoginOrRegisterCard.vue'
import { loginOrRegisterContextKey } from './login-or-register/context'
import { useLoginOrRegister } from './login-or-register/useLoginOrRegister'
import './login-or-register/login-or-register.scss'

const LoginOrRegisterPolicyDialog = defineAsyncComponent(
  () => import('./login-or-register/components/LoginOrRegisterPolicyDialog.vue'),
)

const state = useLoginOrRegister()

provide(loginOrRegisterContextKey, state)
</script>

<template>
  <div class="auth-view-root">
    <div :class="[state.isDesktop.value ? 'desktop-page' : 'mobile-page mobile-adapter']">
      <div class="login-page">
        <LoginOrRegisterCard />
        <div class="icp-info">
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
            浙ICP备2024124728号-1
          </a>
        </div>
      </div>
    </div>

    <LoginOrRegisterPolicyDialog />
  </div>
</template>
