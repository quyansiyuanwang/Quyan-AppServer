<template>
  <div class="iam-overview desktop-page">
    <el-card class="page-card">
      <template #header>
        <div class="iam-overview__header">
          <div>
            <h1>{{ i18ns.t('IamOverview.title') }}</h1>
            <p>{{ i18ns.t('IamOverview.description') }}</p>
          </div>
        </div>
      </template>

      <section v-for="section in visibleSections" :key="section.key" class="iam-overview__section">
        <h2>{{ i18ns.t(section.titleKey as I18nENAvailableKeys) }}</h2>
        <div class="iam-overview__grid">
          <button
            v-for="entry in section.entries"
            :key="entry.route"
            type="button"
            class="iam-overview__entry"
            @click="navigate(entry.route)"
          >
            <el-icon><component :is="entry.icon" /></el-icon>
            <span>
              <strong>{{ i18ns.t(entry.labelKey as I18nENAvailableKeys) }}</strong>
              <small>{{ i18ns.t(entry.descriptionKey as I18nENAvailableKeys) }}</small>
            </span>
            <el-icon class="iam-overview__arrow"><ArrowRight /></el-icon>
          </button>
        </div>
      </section>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ArrowRight, Collection, DataAnalysis, Document, Key, User } from '@element-plus/icons-vue'
import type { Component } from 'vue'
import { computed } from 'vue'
import { Permission } from '@/constant/permission'
import { i18ns, type I18nENAvailableKeys } from '@/locales'
import router from '@/router'
import { currentSiteProfile } from '@/router'
import { resolveCanonicalRouteUrl } from '@/router/routes'
import { usePermissionStore } from '@/stores/permissionStore'
import type { RouteName } from '@/types/route-types.gen'
import { assignDocument } from '@/service/navigationService'

type IamEntry = {
  route: RouteName
  labelKey: I18nENAvailableKeys
  descriptionKey: I18nENAvailableKeys
  icon: Component
  permissions: readonly Permission[]
}

const permissionStore = usePermissionStore()

const navigate = (route: RouteName) => {
  if (router.hasRoute(route)) {
    void router.push({ name: route } as any)
    return
  }

  if (currentSiteProfile.id === 'rejected') return
  const target = resolveCanonicalRouteUrl(route, currentSiteProfile)
  if (target) assignDocument(target)
}

const sections: readonly {
  key: string
  titleKey: I18nENAvailableKeys
  entries: readonly IamEntry[]
}[] = [
  {
    key: 'identity',
    titleKey: 'nav.iamIdentityManagement',
    entries: [
      {
        route: 'userManagement',
        labelKey: 'nav.users',
        descriptionKey: 'IamOverview.usersDescription',
        icon: User,
        permissions: [Permission.USER_READ],
      },
      {
        route: 'groupManagement',
        labelKey: 'nav.groups',
        descriptionKey: 'IamOverview.groupsDescription',
        icon: Collection,
        permissions: [Permission.GROUP_READ],
      },
      {
        route: 'ramRoles',
        labelKey: 'nav.roles',
        descriptionKey: 'IamOverview.rolesDescription',
        icon: Key,
        permissions: [Permission.RAM_ROLE_READ],
      },
    ],
  },
  {
    key: 'permissions',
    titleKey: 'nav.iamPermissionManagement',
    entries: [
      {
        route: 'iamAuthorizations',
        labelKey: 'nav.iamAuthorizations',
        descriptionKey: 'IamOverview.authorizationsDescription',
        icon: Key,
        permissions: [Permission.PERMISSION_VIEW],
      },
      {
        route: 'iamPermissionPolicies',
        labelKey: 'nav.iamPermissionPolicies',
        descriptionKey: 'IamOverview.policiesDescription',
        icon: Document,
        permissions: [Permission.PERMISSION_VIEW],
      },
      {
        route: 'iamPermissionDiagnostics',
        labelKey: 'nav.iamPermissionDiagnostics',
        descriptionKey: 'IamOverview.diagnosticsDescription',
        icon: DataAnalysis,
        permissions: [Permission.PERMISSION_VIEW],
      },
    ],
  },
]

const visibleSections = computed(() =>
  sections
    .map((section) => ({
      ...section,
      entries: section.entries.filter((entry) =>
        permissionStore.hasAnyPermission(...entry.permissions),
      ),
    }))
    .filter((section) => section.entries.length > 0),
)
</script>

<style scoped lang="scss">
.iam-overview__header h1,
.iam-overview__section h2 {
  margin: 0;
}

.iam-overview__header p {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
}

.iam-overview__section + .iam-overview__section {
  margin-top: 32px;
}

.iam-overview__section h2 {
  margin-bottom: 12px;
  font-size: 16px;
}

.iam-overview__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.iam-overview__entry {
  display: flex;
  min-height: 96px;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-primary);
  text-align: left;
  cursor: pointer;
}

.iam-overview__entry:hover,
.iam-overview__entry:focus-visible {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
  outline: none;
}

.iam-overview__entry > .el-icon:first-child {
  color: var(--el-color-primary);
  font-size: 22px;
}

.iam-overview__entry span {
  display: grid;
  min-width: 0;
  gap: 6px;
}

.iam-overview__entry small {
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}

.iam-overview__arrow {
  margin-left: auto;
  color: var(--el-text-color-secondary);
}
</style>
