<template>
  <div class="settings-view-root">
    <AccountProfileLayout>
      <div v-if="isDesktop" class="desktop-page">
        <div class="page-header">
          <h1 class="page-title">{{ i18ns.t('nav.preferences') }}</h1>
        </div>

        <el-card class="section-card page-card">
          <h3>{{ i18ns.t('SettingsView.themeLanguageTitle') }}</h3>
          <div class="prefs-actions">
            <el-button @click="toggleDark">
              <el-icon><component :is="iconRef" /></el-icon>
              <span>{{ i18ns.t('SettingsView.themeLabel') }}</span>
            </el-button>
            <LanguageSwitcher />
          </div>
        </el-card>

        <el-card class="section-card page-card">
          <h3>{{ i18ns.t('SettingsView.clearCacheTitle') }}</h3>
          <p class="section-desc">{{ i18ns.t('SettingsView.clearCacheDesc') }}</p>
          <el-button type="warning" :loading="dialogOpening" @click="openCacheDialog">
            {{ i18ns.t('SettingsView.clearCacheButton') }}
          </el-button>
        </el-card>
      </div>

      <div v-else class="mobile-page">
        <div class="settings-mobile">
          <h1 class="page-title">{{ i18ns.t('nav.preferences') }}</h1>

          <el-card class="section-card mobile-card">
            <h3>{{ i18ns.t('SettingsView.themeLanguageTitle') }}</h3>
            <div class="stack">
              <el-button class="w-full" @click="toggleDark">
                <el-icon><component :is="iconRef" /></el-icon>
                <span>{{ i18ns.t('SettingsView.themeLabel') }}</span>
              </el-button>
              <div class="w-full lang-wrap">
                <LanguageSwitcher />
              </div>
            </div>
          </el-card>

          <el-card class="section-card mobile-card">
            <h3>{{ i18ns.t('SettingsView.clearCacheTitle') }}</h3>
            <p class="section-desc">{{ i18ns.t('SettingsView.clearCacheDesc') }}</p>
            <el-button
              class="w-full"
              type="warning"
              :loading="dialogOpening"
              @click="openCacheDialog"
            >
              {{ i18ns.t('SettingsView.clearCacheButton') }}
            </el-button>
          </el-card>
        </div>
      </div>
    </AccountProfileLayout>

    <!-- Cache cleaner dialog -->
    <el-dialog
      v-model="showCacheDialog"
      :title="i18ns.t('SettingsView.clearCacheDialogTitle')"
      :width="isDesktop ? '560px' : '96%'"
      destroy-on-close
    >
      <el-tree
        ref="treeRef"
        :data="visibleCacheTreeData"
        show-checkbox
        node-key="id"
        default-expand-all
        :props="{ children: 'children', label: 'label' }"
        class="cache-tree"
      >
        <template #default="{ data }">
          <span class="tree-node">
            <span class="node-label">{{ data.label }}</span>
            <template v-if="data.lsKey || data.dbStore">
              <span class="node-desc">{{ data.desc }}</span>
              <span v-if="nodeSizeMap.get(data.id)" class="node-size">
                {{ formatNodeSize(nodeSizeMap.get(data.id)!) }}
              </span>
            </template>
            <span v-else-if="getSubtreeSize([data]) > 0" class="node-size node-size--group">
              {{ formatNodeSize(getSubtreeSize([data])) }}
            </span>
          </span>
        </template>
      </el-tree>

      <template #footer>
        <el-button @click="showCacheDialog = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="danger" :loading="clearing" @click="handleClearSelected">
          {{ i18ns.t('SettingsView.clearCacheConfirmBtn') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { usePageDevice } from '@/composables/usePageDevice'
import AccountProfileLayout from '@/layouts/AccountProfileLayout.vue'
import { computed, ref } from 'vue'
import { i18ns } from '@/locales'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import { Sunny, Moon } from '@element-plus/icons-vue'
import { useThemeToggleStore } from '@/stores/themeToggleStore'
import { ElMessage } from 'element-plus'
import { sessionDB, STORE_NAMES } from '@/utils/sessionDB'
import StorageKey from '@/constant/storagekey'
import type { ElTree } from 'element-plus'

interface CacheNode {
  id: string
  label: string
  desc?: string
  children?: CacheNode[]
  lsKey?: string
  dbStore?: string
  requiresSignOut?: boolean
  requiresReload?: boolean
}

const { isDesktop } = usePageDevice()
const themeToggleStore = useThemeToggleStore()
const isDark = themeToggleStore.useIsDark()
const toggleDark = () => themeToggleStore.toggleTheme()
const iconRef = computed(() => (isDark.value ? Sunny : Moon))

const showCacheDialog = ref(false)
const clearing = ref(false)
const nodeSizeMap = ref(new Map<string, number>())
const treeRef = ref<InstanceType<typeof ElTree>>()

const isZh = computed(() => i18ns.locale !== 'en')

const cacheTreeData = computed<CacheNode[]>(() => {
  const zh = isZh.value

  const ls = (
    key: string,
    zhDesc: string,
    enDesc: string,
    opts?: Partial<CacheNode>,
  ): CacheNode => ({
    id: `ls:${key}`,
    label: key,
    desc: zh ? zhDesc : enDesc,
    lsKey: key,
    ...opts,
  })

  const db = (storeName: string, zhDesc: string, enDesc: string): CacheNode => ({
    id: `db:${storeName}`,
    label: storeName,
    desc: zh ? zhDesc : enDesc,
    dbStore: storeName,
  })

  return [
    {
      id: 'group:ls',
      label: 'LocalStorage',
      children: [
        {
          id: 'group:auth',
          label: zh ? '认证 (Auth)' : 'Auth',
          children: [
            ls(StorageKey.Auth.ACCESS_TOKEN, 'JWT 访问令牌', 'JWT access token', {
              requiresSignOut: true,
            }),
            ls(StorageKey.Auth.REFRESH_TOKEN, '刷新令牌', 'Refresh token', {
              requiresSignOut: true,
            }),
            ls(StorageKey.Auth.ACCESS_TOKEN_EXPIRATION, '访问令牌过期时间', 'Access token expiry'),
            ls(
              StorageKey.Auth.REFRESH_TOKEN_EXPIRATION,
              '刷新令牌过期时间',
              'Refresh token expiry',
            ),
            ls(StorageKey.Auth.FORCE_LOGOUT_AT, '强制登出时间戳', 'Force logout timestamp'),
            ls(StorageKey.Auth.LEGAL_POLICY_CONSENT, '法律政策同意状态', 'Legal policy consent'),
            ls(StorageKey.Auth.REPLAY_SIGNING_SESSION, '重放签名会话', 'Replay signing session', {
              requiresSignOut: true,
            }),
          ],
        },
        {
          id: 'group:impersonation',
          label: zh ? '冒充会话 (Impersonation)' : 'Impersonation',
          children: [
            ls(
              StorageKey.Impersonation.ORIGINAL_ACCESS_TOKEN,
              '原始访问令牌',
              'Original access token',
              { requiresSignOut: true },
            ),
            ls(
              StorageKey.Impersonation.ORIGINAL_REFRESH_TOKEN,
              '原始刷新令牌',
              'Original refresh token',
              { requiresSignOut: true },
            ),
            ls(
              StorageKey.Impersonation.ORIGINAL_ACCESS_EXPIRY,
              '原始访问令牌过期时间',
              'Original access token expiry',
            ),
            ls(
              StorageKey.Impersonation.ORIGINAL_REFRESH_EXPIRY,
              '原始刷新令牌过期时间',
              'Original refresh token expiry',
            ),
            ls(
              StorageKey.Impersonation.ORIGINAL_STORAGE_SCOPE,
              '原始存储范围',
              'Original storage scope',
            ),
            ls(StorageKey.Impersonation.SESSION_INFO, '冒充会话信息', 'Impersonation session info'),
          ],
        },
        {
          id: 'group:theme',
          label: zh ? '主题 (Theme)' : 'Theme',
          children: [
            ls(StorageKey.Theme.THEME_TOGGLE_IS_DARK, '深色模式状态', 'Dark mode state', {
              requiresReload: true,
            }),
          ],
        },
        {
          id: 'group:util',
          label: zh ? '工具 (Util)' : 'Util',
          children: [
            ls(StorageKey.Util.LOCALE, '界面语言', 'Display language', { requiresReload: true }),
            ls(StorageKey.Util.CLIENT_FINGERPRINT, '客户端指纹', 'Client fingerprint'),
            ls(StorageKey.Util.HEARTBEAT_LEADER_ID, '心跳领导者 ID', 'Heartbeat leader ID'),
            ls(
              StorageKey.Util.HEARTBEAT_LEADER_EXPIRES_AT,
              '心跳领导者过期时间',
              'Heartbeat leader expiry',
            ),
          ],
        },
        {
          id: 'group:scope',
          label: zh ? '存储范围 (Scope)' : 'Storage Scope',
          children: [
            ls(StorageKey.Scope.CURRENT, '当前用户存储范围标识', 'Current user storage scope'),
          ],
        },
        {
          id: 'group:user',
          label: zh ? '用户 (User)' : 'User',
          children: [
            ls(StorageKey.User.INFO, '用户信息缓存', 'Cached user info', { requiresReload: true }),
          ],
        },
        {
          id: 'group:overlay',
          label: zh ? '浮层 (Overlay)' : 'Overlay',
          children: [
            ls(
              StorageKey.Overlay.FLOATING_PANEL_POSITION,
              '浮动面板位置坐标',
              'Floating panel position',
            ),
            ls(
              StorageKey.Overlay.FLOATING_WORKSPACE_STATE,
              '浮动工作区状态',
              'Floating workspace state',
            ),
          ],
        },
        {
          id: 'group:chat',
          label: zh ? '聊天 (Chat)' : 'Chat',
          children: [
            ls(StorageKey.Chat.SELECTED_TOKEN_ID, '上次选中的令牌 ID', 'Last selected token ID'),
            ls(StorageKey.Chat.SELECTED_MODEL, '上次选中的模型', 'Last selected model'),
          ],
        },
        {
          id: 'group:relay',
          label: zh ? '中继 (Relay)' : 'Relay',
          children: [
            ls(StorageKey.Relay.BALANCE_SCRIPT_SETTINGS, '余额脚本配置', 'Balance script settings'),
          ],
        },
        {
          id: 'group:other',
          label: zh ? '其他 (Other)' : 'Other',
          children: [
            ls('appserver.sidebar.pinnedRoutes', '侧边栏固定页面', 'Sidebar pinned pages'),
            ls(
              StorageKey.Navigation.SITE_OPEN_IN_NEW_TAB,
              '站点打开方式偏好',
              'Site opening preference',
            ),
            ls(StorageKey.Navigation.RECENT_SITES, '最近使用站点', 'Recently used sites'),
          ],
        },
      ],
    },
    {
      id: 'group:db',
      label: 'SessionDB (IndexedDB)',
      children: [
        db(STORE_NAMES.BALANCE_TRANSACTIONS, '余额交易记录', 'Balance transaction records'),
        db(STORE_NAMES.SESSION_META, '会话元数据', 'Session metadata'),
      ],
    },
  ]
})

const dialogOpening = ref(false)

const formatNodeSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const getSubtreeSize = (nodes: CacheNode[]): number => {
  let total = 0
  for (const node of nodes) {
    if (node.lsKey || node.dbStore) {
      total += nodeSizeMap.value.get(node.id) ?? 0
    }
    if (node.children) total += getSubtreeSize(node.children)
  }
  return total
}

const refreshSizeMap = () => {
  const map = new Map<string, number>()
  const scanGroup = (keys: Record<string, string>) => {
    Object.values(keys).forEach((key) => {
      const value = TypedLocalStorage.getItem(key)
      if (value !== null) map.set(`ls:${key}`, new Blob([value]).size)
    })
  }
  scanGroup(StorageKey.Auth)
  scanGroup(StorageKey.Impersonation)
  scanGroup(StorageKey.Theme)
  scanGroup(StorageKey.Util)
  scanGroup(StorageKey.Scope)
  scanGroup(StorageKey.User)
  scanGroup(StorageKey.Overlay)
  scanGroup(StorageKey.Chat)
  scanGroup(StorageKey.Relay)
  scanGroup(StorageKey.Navigation)
  const pinned = TypedLocalStorage.getItem(StorageKey.Navigation.PINNED_ROUTES)
  if (pinned !== null) {
    map.set(`ls:${StorageKey.Navigation.PINNED_ROUTES}`, new Blob([pinned]).size)
  }
  nodeSizeMap.value = map
}

const openCacheDialog = async () => {
  dialogOpening.value = true
  try {
    refreshSizeMap()
    const map = new Map(nodeSizeMap.value)
    try {
      const [bt, sm] = await Promise.all([
        sessionDB.getAll(STORE_NAMES.BALANCE_TRANSACTIONS),
        sessionDB.getAll(STORE_NAMES.SESSION_META),
      ])
      const btSize = new Blob([JSON.stringify(bt)]).size
      const smSize = new Blob([JSON.stringify(sm)]).size
      if (bt.length > 0) map.set(`db:${STORE_NAMES.BALANCE_TRANSACTIONS}`, btSize)
      if (sm.length > 0) map.set(`db:${STORE_NAMES.SESSION_META}`, smSize)
    } catch {
      map.set(`db:${STORE_NAMES.BALANCE_TRANSACTIONS}`, 0)
      map.set(`db:${STORE_NAMES.SESSION_META}`, 0)
    }
    nodeSizeMap.value = map
    showCacheDialog.value = true
  } finally {
    dialogOpening.value = false
  }
}

const visibleCacheTreeData = computed<CacheNode[]>(() => {
  const filter = (nodes: CacheNode[]): CacheNode[] =>
    nodes.flatMap((node) => {
      if (node.lsKey || node.dbStore) {
        return nodeSizeMap.value.has(node.id) ? [node] : []
      }
      if (node.children) {
        const filtered = filter(node.children)
        return filtered.length > 0 ? [{ ...node, children: filtered }] : []
      }
      return [node]
    })
  return filter(cacheTreeData.value)
})

const handleClearSelected = async () => {
  const tree = treeRef.value
  if (!tree) return

  const checked = tree.getCheckedNodes(true, false) as CacheNode[]
  const actionable = checked.filter((n) => n.lsKey || n.dbStore)

  if (actionable.length === 0) {
    ElMessage.warning(i18ns.t('SettingsView.clearCacheNothingSelected'))
    return
  }

  clearing.value = true
  let needsSignOut = false
  let needsReload = false

  try {
    for (const node of actionable) {
      if (node.lsKey) {
        TypedLocalStorage.removeItem(node.lsKey)
        if (node.requiresSignOut) needsSignOut = true
        if (node.requiresReload) needsReload = true
      } else if (node.dbStore) {
        await sessionDB.clear(node.dbStore)
      }
    }

    showCacheDialog.value = false

    if (needsSignOut) {
      ElMessage.warning(i18ns.t('SettingsView.clearCacheSignOutWarning'))
      setTimeout(async () => {
        const { reloadDocument } = await import('@/service/navigationService')
        reloadDocument()
      }, 1500)
    } else if (needsReload) {
      ElMessage.success(i18ns.t('SettingsView.clearCacheReloadWarning'))
      setTimeout(async () => {
        const { reloadDocument } = await import('@/service/navigationService')
        reloadDocument()
      }, 1500)
    } else {
      ElMessage.success(i18ns.t('SettingsView.clearCacheSuccess'))
    }
  } catch {
    ElMessage.error(i18ns.t('unknownError'))
  } finally {
    clearing.value = false
  }
}
</script>

<style scoped lang="scss">
.settings-container {
  width: 100%;
  min-width: 0;
}

.desktop-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  margin-bottom: 0;
}

.page-title {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.section-card {
  margin-top: 0;
}

h3 {
  margin: 0 0 20px;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.section-desc {
  margin-bottom: 16px;
  color: var(--el-text-color-secondary);
}

.w-full {
  width: 100%;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.prefs-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.prefs-actions .el-button,
.prefs-actions :deep(.el-dropdown) {
  min-width: 140px;
}

@media (max-width: 768px) {
  .settings-view-root :deep(.account-profile-page) {
    max-width: 100%;
    padding: 0 4px;
  }
}
</style>

<style scoped lang="scss">
.settings-mobile {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px;
}

.page-title {
  margin: 4px 0 4px;
  font-size: 22px;
  font-weight: 600;
}

.section-card {
  margin-top: 0;
}

h3 {
  margin: 0 0 14px;
  font-size: 16px;
  font-weight: 600;
}

.section-desc {
  margin-bottom: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.w-full {
  width: 100%;
}

.lang-wrap :deep(.el-dropdown),
.lang-wrap :deep(.el-dropdown .el-button) {
  width: 100%;
}
</style>

<style scoped lang="scss">
.cache-tree {
  max-height: 60vh;
  overflow-y: auto;

  :deep(.el-tree-node__content) {
    height: auto;
    min-height: 28px;
    padding: 4px 0;
  }
}

.tree-node {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  line-height: 1.4;
}

.node-label {
  font-size: 13px;
  font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
  color: var(--el-text-color-primary);
}

.node-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.node-size {
  font-size: 11px;
  color: var(--el-color-primary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.node-size--group {
  color: var(--el-text-color-secondary);
  font-style: italic;
}
</style>
