<template>
  <div class="common-layout" :class="{ 'is-embedded': isEmbeddedShell }">
    <ImpersonationBanner />
    <el-container
      class="el-container"
      :class="{ 'with-banner': impersonationStore.isImpersonating }"
    >
      <el-aside v-if="showAside" class="aside"><AsideMenu /></el-aside>
      <el-main
        class="main desktop-page md:desktop-page"
        :class="{ 'is-embedded': isEmbeddedShell }"
      >
        <slot />
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import AsideMenu from '@/layouts/AsideMenu.vue'
import ImpersonationBanner from '@/components/common/ImpersonationBanner.vue'
import { onMounted } from 'vue'
import { usePermissionStore } from '@/stores/permissionStore'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { useWaterMarkTextStore } from '@/stores/waterMarkTextStore'
import { useImpersonationStore } from '@/stores/impersonationStore'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { AuthorizationService } from '@/service/authorizationService'

const waterMarkTextStore = useWaterMarkTextStore()
const impersonationStore = useImpersonationStore()
const route = useRoute()
const isEmbeddedShell = computed(() => route.query.embed === '1')
const isAuthenticated = computed(() => Boolean(AuthorizationService.getAccessToken()))
const showAside = computed(() => !isEmbeddedShell.value && isAuthenticated.value)

onMounted(async () => {
  if (!isAuthenticated.value) {
    waterMarkTextStore.clearText()
    return
  }

  const permissionStore = usePermissionStore()
  const userInfoStore = useUserInfoStore()

  await userInfoStore.init().then(permissionStore.init)
  waterMarkTextStore.setText(`${userInfoStore.userInfo.username}`)
})
</script>

<style scoped>
.common-layout {
  width: 100%;
  height: 100%;
  background: var(--color-background);
  color: var(--color-text);
}

.common-layout.is-embedded {
  min-height: 100vh;
}

.title {
  font-size: 18px;
  font-weight: 500;
  margin-right: 12px;
}

.el-container {
  height: 100%;
}

.with-banner {
  padding-top: 44px;
}

.header {
  padding: 0 1.5vw;
  border-bottom: 1px solid var(--surface-card-border);
  display: flex;
  align-items: center;
  justify-content: center;
}

.page-header {
  width: 100%;
  height: 100%;
  padding: 0;
}

.page-header :deep(.el-page-header__header) {
  width: 100%;
  height: 100%;
}

.aside {
  width: auto;
  overflow: hidden;
  border-right: 1px solid var(--surface-card-border);
}

.main {
  overflow-y: auto;
  overflow-x: auto;
  height: 100%;
  padding: 20px;
  position: relative;
}

.main.is-embedded {
  padding: 16px;
}

.main::-webkit-scrollbar {
  width: 8px;
}

.main::-webkit-scrollbar-track {
  background: transparent;
}

.main::-webkit-scrollbar-thumb {
  background: var(--el-color-primary);
  border-radius: 4px;
}

.main::-webkit-scrollbar-thumb:hover {
  background: var(--el-color-primary-light-3);
}

/* 移动端优化 */
@media screen and (max-width: 768px) {
  .header {
    padding: 0 12px;
    height: auto !important;
    min-height: 60px;
  }

  .aside {
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100% !important;
    height: auto !important;
    z-index: 2000;
    border-right: none;
    border-top: 1px solid var(--surface-card-border);
    background: var(--el-bg-color);
  }

  .main {
    padding: 16px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom) + 72px); /* 留出底部 Tab Bar 空间 */
  }

  .title {
    font-size: 16px;
    margin-right: 8px;
  }

  .page-header :deep(.el-page-header__header) {
    flex-wrap: wrap;
    gap: 8px;
  }

  .page-header :deep(.el-page-header__left) {
    margin-right: 8px;
  }

  .page-header :deep(.el-page-header__content) {
    flex: 1;
    min-width: 0;
  }

  .page-header :deep(.el-page-header__extra) {
    margin-left: auto;
  }

  .page-header :deep(.el-tag) {
    font-size: 12px;
    padding: 0 6px;
    height: 22px;
    line-height: 22px;
  }
}

@media screen and (max-width: 480px) {
  .header {
    padding: 0 8px;
    min-height: 56px;
  }

  .main {
    padding: 12px;
    padding-bottom: calc(12px + env(safe-area-inset-bottom) + 72px);
  }

  .title {
    font-size: 14px;
    margin-right: 6px;
  }

  .page-header :deep(.el-page-header__header) {
    flex-direction: column;
    align-items: flex-start;
  }

  .page-header :deep(.el-page-header__extra) {
    width: 100%;
    margin-top: 8px;
    display: flex;
    justify-content: flex-end;
  }

  .page-header :deep(.el-button) {
    padding: 8px 12px;
    font-size: 13px;
  }
}
</style>
