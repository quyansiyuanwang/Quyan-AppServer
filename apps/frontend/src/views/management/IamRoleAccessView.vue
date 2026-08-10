<template>
  <div class="iam-role-access desktop-page">
    <el-result
      icon="info"
      :title="i18ns.t('IamRoleAccess.title')"
      :sub-title="i18ns.t('IamRoleAccess.description')"
    >
      <template #extra>
        <el-button type="primary" :icon="Key" @click="openRoles">
          {{ i18ns.t('IamRoleAccess.openRoles') }}
        </el-button>
      </template>
    </el-result>
  </div>
</template>

<script setup lang="ts">
import { Key } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { currentSiteProfile } from '@/router'
import { resolveCanonicalRouteUrl } from '@/router/routes'

const openRoles = () => {
  if (currentSiteProfile.id === 'rejected') return

  const target = resolveCanonicalRouteUrl('ramRoles', currentSiteProfile)
  if (!target) return

  window.location.assign(target)
}
</script>
