<template>
  <div
    :class="[
      'auth-center-client-management-view',
      state.isDesktop.value ? 'desktop-page page-shell' : 'auth-center-client-mobile mobile-page',
    ]"
  >
    <AuthCenterClientReferenceCard />
    <AuthCenterClientDesktop v-if="state.isDesktop.value" />
    <AuthCenterClientMobile v-else />
    <AuthCenterClientFormDialog />
    <AuthCenterClientSecretDialog />
  </div>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import AuthCenterClientDesktop from './auth-center-client-management/components/AuthCenterClientDesktop.vue'
import AuthCenterClientFormDialog from './auth-center-client-management/components/AuthCenterClientFormDialog.vue'
import AuthCenterClientMobile from './auth-center-client-management/components/AuthCenterClientMobile.vue'
import AuthCenterClientReferenceCard from './auth-center-client-management/components/AuthCenterClientReferenceCard.vue'
import AuthCenterClientSecretDialog from './auth-center-client-management/components/AuthCenterClientSecretDialog.vue'
import { authCenterClientManagementContextKey } from './auth-center-client-management/context'
import { useAuthCenterClientManagement } from './auth-center-client-management/useAuthCenterClientManagement'
import './auth-center-client-management/auth-center-client-management.scss'

const state = useAuthCenterClientManagement()

provide(authCenterClientManagementContextKey, state)
defineExpose(state)
</script>

<style scoped>
.auth-center-client-management-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  min-width: 0;
}
</style>
