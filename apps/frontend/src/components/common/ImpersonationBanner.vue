<template>
  <div v-if="impersonationStore.isImpersonating" class="impersonation-banner" :class="bannerClass">
    <div class="banner-content">
      <el-icon class="banner-icon"><Warning /></el-icon>
      <span v-if="impersonationStore.isViewOnly" class="banner-text">
        {{
          i18ns.t('Impersonation.bannerViewText', {
            username: impersonationStore.sessionInfo?.targetUsername,
          })
        }}
      </span>
      <span v-else class="banner-text">
        {{
          i18ns.t('Impersonation.bannerActText', {
            username: impersonationStore.sessionInfo?.targetUsername,
          })
        }}
      </span>
    </div>
    <el-button class="exit-btn" size="small" @click="handleExit">{{
      i18ns.t('Impersonation.exitBtn')
    }}</el-button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Warning } from '@element-plus/icons-vue'
import { useImpersonationStore } from '@/stores/impersonationStore'
import { impersonationService } from '@/service/impersonationService'
import { Notification } from '@/utils/notification'
import { i18ns } from '@/locales'

const impersonationStore = useImpersonationStore()

const bannerClass = computed(() => (impersonationStore.isViewOnly ? 'banner-view' : 'banner-act'))

const handleExit = async () => {
  try {
    await impersonationService.exitImpersonation()
  } catch {
    Notification.notify(i18ns.t('error'), i18ns.t('Impersonation.exitFailed'), 'error')
  }
}
</script>

<style scoped>
.impersonation-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1999;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  font-size: 13px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.banner-view {
  background-color: #fef3c7;
  color: #92400e;
  border-bottom: 2px solid #f59e0b;
}

.banner-act {
  background-color: #fee2e2;
  color: #991b1b;
  border-bottom: 2px solid #ef4444;
}

.banner-content {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  overflow: hidden;
}

.banner-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.banner-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.exit-btn {
  flex-shrink: 0;
  margin-left: 12px;
}
</style>
