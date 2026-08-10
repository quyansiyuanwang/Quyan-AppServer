<template>
  <main class="console-portal">
    <header class="console-portal__header">
      <div>
        <h1>{{ i18ns.t('nav.siteConsoleCore') }}</h1>
        <p>{{ accountName }}</p>
      </div>
      <dl class="console-portal__identity">
        <div>
          <dt>{{ i18ns.t('nav.accountId') }}</dt>
          <dd>{{ userInfoStore.userInfo.id || '-' }}</dd>
        </div>
        <div>
          <dt>{{ i18ns.t('relay.accountBalance') }}</dt>
          <dd>{{ i18ns.t('balance.yuan') }} {{ balance }}</dd>
        </div>
      </dl>
    </header>

    <section class="console-portal__section">
      <h2>{{ i18ns.t('nav.switchSite') }}</h2>
      <div v-if="!permissionStore.isLoaded" class="console-portal__loading">
        <el-skeleton :rows="3" animated />
      </div>
      <div v-else class="console-portal__grid">
        <button
          v-for="profile in accessibleProfiles"
          :key="profile.id"
          type="button"
          class="console-portal__tile"
          @click="navigate(profile.canonicalOrigin, profile.defaultPath)"
        >
          <strong>{{ i18ns.t(siteLabelKeys[profile.id]) }}</strong>
          <span>{{ profile.hostname }}</span>
        </button>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { i18ns, type I18nENAvailableKeys } from '@/locales'
import { currentSiteProfile } from '@/router'
import { getAccessibleSiteProfiles, type SiteProfileId } from '@/config/site-registry'
import { usePermissionStore } from '@/stores/permissionStore'
import { useUserInfoStore } from '@/stores/userInfoStore'

const permissionStore = usePermissionStore()
const userInfoStore = useUserInfoStore()

const siteLabelKeys: Record<SiteProfileId, I18nENAvailableKeys> = {
  public: 'nav.sitePublic',
  identity: 'nav.siteIdentity',
  account: 'nav.siteAccount',
  chat: 'nav.siteChat',
  developer: 'nav.siteDeveloper',
  terminal: 'nav.siteTerminal',
  'console-core': 'nav.siteConsoleCore',
  'console-ai': 'nav.siteConsoleAi',
  'console-developer': 'nav.siteConsoleDeveloper',
  'console-terminal': 'nav.siteConsoleTerminal',
  'console-ram': 'nav.siteConsoleRam',
  'product-kv': 'nav.productKv',
  'product-short_link': 'nav.productShortLink',
  'product-secret': 'nav.productSecret',
  'product-status': 'nav.productStatus',
  'product-verification': 'nav.productVerification',
  'product-ip_geolocation': 'nav.productIpGeolocation',
  'product-push': 'nav.productPush',
  'management-core': 'nav.siteManagementCore',
  'management-ai': 'nav.siteManagementAi',
  'management-developer': 'nav.siteManagementDeveloper',
  'management-terminal': 'nav.siteManagementTerminal',
}

const accessibleProfiles = computed(() =>
  currentSiteProfile.id === 'rejected'
    ? []
    : getAccessibleSiteProfiles(currentSiteProfile, permissionStore.effectivePermissions),
)
const accountName = computed(
  () => userInfoStore.userInfo.name || userInfoStore.userInfo.username || '-',
)
const balance = computed(() => (userInfoStore.userInfo.balance ?? 0).toFixed(2))
const navigate = (origin: string, path: string) =>
  window.location.assign(new URL(path, origin).toString())

onMounted(() => {
  void permissionStore.untilReady()
})
</script>

<style scoped>
.console-portal {
  max-width: 1200px;
  margin: 0 auto;
  padding: 28px;
}
.console-portal__header {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid var(--el-border-color-light);
  padding-bottom: 24px;
}
h1,
h2,
p {
  margin: 0;
  letter-spacing: 0;
}
h1 {
  font-size: 24px;
}
p {
  color: var(--el-text-color-secondary);
  margin-top: 8px;
}
.console-portal__identity {
  display: flex;
  gap: 24px;
  margin: 0;
}
dt {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
dd {
  margin: 4px 0 0;
  font-weight: 600;
}
.console-portal__section {
  margin-top: 28px;
}
h2 {
  font-size: 18px;
}
.console-portal__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-top: 16px;
}
.console-portal__tile {
  min-height: 96px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  cursor: pointer;
  padding: 16px;
  text-align: left;
}
.console-portal__tile:hover,
.console-portal__tile:focus-visible {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.console-portal__tile strong,
.console-portal__tile span {
  display: block;
}
.console-portal__tile span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-top: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.console-portal__loading {
  margin-top: 16px;
}
@media (max-width: 700px) {
  .console-portal {
    padding: 18px;
  }
  .console-portal__header,
  .console-portal__identity {
    flex-direction: column;
  }
}
</style>
