<template>
  <button
    class="docs-quick-link"
    type="button"
    :title="i18ns.t('workspace.openDocs')"
    :aria-label="i18ns.t('workspace.openDocs')"
    @dragstart.prevent
    @click="handleOpenDocs"
  >
    <el-icon><Link /></el-icon>
    <span>{{ i18ns.t('nav.docs') }}</span>
  </button>
</template>

<script setup lang="ts">
import { Link } from '@element-plus/icons-vue'
import router from '@/router'
import { i18ns } from '@/locales'
import { useFloatingWorkspaceStore } from '@/stores/floatingWorkspaceStore'

const floatingWorkspaceStore = useFloatingWorkspaceStore()

const handleOpenDocs = () => {
  const routeName =
    typeof router.currentRoute.value.name === 'string' ? router.currentRoute.value.name : null
  floatingWorkspaceStore.openDocs(routeName)
}
</script>

<style scoped>
.docs-quick-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  min-height: 32px;
  padding: 0 15px;
  border-radius: var(--el-border-radius-base);
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-regular);
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  text-decoration: none;
  user-select: none;
  -webkit-user-drag: none;
  box-sizing: border-box;
  cursor: pointer;
}

.docs-quick-link:hover {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary-light-5);
}

@media screen and (max-width: 768px) {
  .docs-quick-link {
    padding: 0 12px;
  }
}
</style>
