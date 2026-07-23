<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Key, Link, Monitor, Plus, Refresh, Service } from '@element-plus/icons-vue'
import type {
  DeveloperApiKeyDto,
  DeveloperKvValueDto,
  DeveloperProjectDto,
  DeveloperPushChannelDto,
  DeveloperPushDeliveryDto,
  DeveloperQuotaSummaryDto,
  DeveloperSecretDto,
  DeveloperShortLinkDto,
  DeveloperShortLinkStatsDto,
  DeveloperStatusMonitorDto,
} from '@/client/types.gen'
import { developerProjectService } from '@/service/developerProjectService'

const loading = ref(false)
const projects = ref<DeveloperProjectDto[]>([])
const selectedProjectId = ref('')
const keys = ref<DeveloperApiKeyDto[]>([])
type KvListEntry = Omit<DeveloperKvValueDto, 'value'>
const kvEntries = ref<KvListEntry[]>([])
const shortLinks = ref<DeveloperShortLinkDto[]>([])
const secrets = ref<DeveloperSecretDto[]>([])
const monitors = ref<DeveloperStatusMonitorDto[]>([])
const pushChannels = ref<DeveloperPushChannelDto[]>([])
const pushDeliveries = ref<DeveloperPushDeliveryDto[]>([])
const quotaSummary = ref<DeveloperQuotaSummaryDto | null>(null)
const createProjectVisible = ref(false)
const createKeyVisible = ref(false)
const createShortLinkVisible = ref(false)
const shortLinkStatsVisible = ref(false)
const createSecretVisible = ref(false)
const createMonitorVisible = ref(false)
const createPushChannelVisible = ref(false)
const kvDialogVisible = ref(false)
const projectForm = ref({ name: '', slug: '', description: '' })
const keyForm = ref({ name: '', scopes: ['kv:read', 'kv:write'] as string[] })
const shortLinkForm = ref({ targetUrl: '', code: '', expiresAt: '', enabled: true })
const editingShortLinkId = ref('')
const shortLinkStats = ref<DeveloperShortLinkStatsDto | null>(null)
const secretForm = ref({ alias: '', value: '' })
const monitorForm = ref({
  name: '',
  targetUrl: '',
  method: 'GET' as 'GET' | 'HEAD',
  intervalSec: 60,
  successStatusCodes: '200, 201, 202, 204',
})
const pushChannelForm = ref({
  name: '',
  type: 'webhook' as 'webhook' | 'dingtalk' | 'feishu' | 'wechat_work',
  endpoint: '',
  secretAlias: '',
})
const kvForm = ref({ key: '', value: '{}', ttlSeconds: undefined as number | undefined })
const editingKvKey = ref('')

const activeProject = computed(() =>
  projects.value.find((project) => project.id === selectedProjectId.value),
)
const projectKeyScopes = [
  'kv:read',
  'kv:write',
  'verification:send',
  'verification:verify',
  'ip:lookup',
  'push:send',
]
const quotaServiceLabels: Record<string, string> = {
  verification: '验证码',
  ip: 'IP 定位',
  push: '推送投递',
}

const refreshProjectResources = async () => {
  if (!selectedProjectId.value) return
  const projectId = selectedProjectId.value
  ;[keys.value, kvEntries.value, shortLinks.value, secrets.value, monitors.value, pushChannels.value, pushDeliveries.value, quotaSummary.value] = await Promise.all([
    developerProjectService.listKeys(projectId),
    developerProjectService.listKv(projectId),
    developerProjectService.listShortLinks(projectId),
    developerProjectService.listSecrets(projectId),
    developerProjectService.listMonitors(projectId),
    developerProjectService.listPushChannels(projectId),
    developerProjectService.listPushDeliveries(projectId),
    developerProjectService.getUsageSummary(projectId),
  ])
}

const load = async () => {
  loading.value = true
  try {
    projects.value = await developerProjectService.listProjects()
    if (!selectedProjectId.value && projects.value[0])
      selectedProjectId.value = projects.value[0].id
    await refreshProjectResources()
  } finally {
    loading.value = false
  }
}

watch(selectedProjectId, () => void refreshProjectResources())
onMounted(() => void load())

const createProject = async () => {
  const project = await developerProjectService.createProject({
    ...projectForm.value,
    description: projectForm.value.description || undefined,
  })
  projects.value.unshift(project)
  selectedProjectId.value = project.id
  projectForm.value = { name: '', slug: '', description: '' }
  createProjectVisible.value = false
}

const createKey = async () => {
  const key = await developerProjectService.createKey(selectedProjectId.value, {
    name: keyForm.value.name,
    scopes: keyForm.value.scopes as any,
  })
  keys.value.unshift(key)
  createKeyVisible.value = false
  keyForm.value = { name: '', scopes: ['kv:read', 'kv:write'] }
  await ElMessageBox.alert(key.key || '', '项目 API Key', { confirmButtonText: '我已保存' })
}

const createShortLink = async () => {
  const link = await developerProjectService.createShortLink(selectedProjectId.value, {
    targetUrl: shortLinkForm.value.targetUrl,
    code: shortLinkForm.value.code || undefined,
    expiresAt: shortLinkForm.value.expiresAt || undefined,
  })
  shortLinks.value.unshift(link)
  shortLinkForm.value = { targetUrl: '', code: '', expiresAt: '', enabled: true }
  createShortLinkVisible.value = false
}

const openCreateShortLink = () => {
  editingShortLinkId.value = ''
  shortLinkForm.value = { targetUrl: '', code: '', expiresAt: '', enabled: true }
  createShortLinkVisible.value = true
}

const openEditShortLink = (link: DeveloperShortLinkDto) => {
  editingShortLinkId.value = link.id
  shortLinkForm.value = {
    targetUrl: link.targetUrl,
    code: link.code,
    expiresAt: link.expiresAt || '',
    enabled: link.enabled,
  }
  createShortLinkVisible.value = true
}

const saveShortLink = async () => {
  if (!editingShortLinkId.value) return createShortLink()
  const updated = await developerProjectService.updateShortLink(
    selectedProjectId.value,
    editingShortLinkId.value,
    {
      targetUrl: shortLinkForm.value.targetUrl,
      enabled: shortLinkForm.value.enabled,
      expiresAt: shortLinkForm.value.expiresAt || null,
    },
  )
  shortLinks.value = shortLinks.value.map((link) => (link.id === updated.id ? updated : link))
  createShortLinkVisible.value = false
}

const toggleShortLink = async (link: DeveloperShortLinkDto) => {
  const updated = await developerProjectService.updateShortLink(selectedProjectId.value, link.id, {
    enabled: !link.enabled,
  })
  shortLinks.value = shortLinks.value.map((item) => (item.id === updated.id ? updated : item))
}

const deleteShortLink = async (link: DeveloperShortLinkDto) => {
  await ElMessageBox.confirm(`删除 /s/${link.code} 后无法恢复。`, '删除短链接', { type: 'warning' })
  await developerProjectService.deleteShortLink(selectedProjectId.value, link.id)
  shortLinks.value = shortLinks.value.filter((item) => item.id !== link.id)
}

const copyShortLink = async (link: DeveloperShortLinkDto) => {
  try {
    await navigator.clipboard.writeText(new URL(link.publicUrl, window.location.origin).toString())
    ElMessage.success('短链接已复制')
  } catch {
    ElMessage.error('无法复制短链接')
  }
}

const showShortLinkStats = async (link: DeveloperShortLinkDto) => {
  shortLinkStats.value = await developerProjectService.getShortLinkStats(selectedProjectId.value, link.id)
  shortLinkStatsVisible.value = true
}

const saveSecret = async () => {
  const secret = await developerProjectService.upsertSecret(
    selectedProjectId.value,
    secretForm.value,
  )
  secrets.value = [secret, ...secrets.value.filter((item) => item.alias !== secret.alias)]
  secretForm.value = { alias: '', value: '' }
  createSecretVisible.value = false
}

const deleteSecret = async (secret: DeveloperSecretDto) => {
  await ElMessageBox.confirm(`删除 ${secret.alias} 后，所有引用该别名的请求都会失败。`, '删除托管密钥', {
    type: 'warning',
  })
  await developerProjectService.deleteSecret(selectedProjectId.value, secret.alias)
  secrets.value = secrets.value.filter((item) => item.alias !== secret.alias)
}

const createMonitor = async () => {
  const successStatusCodes = monitorForm.value.successStatusCodes
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 100 && value <= 599)
  if (!successStatusCodes.length) {
    ElMessage.warning('请至少填写一个有效成功状态码')
    return
  }
  const monitor = await developerProjectService.createMonitor(
    selectedProjectId.value,
    {
      name: monitorForm.value.name,
      targetUrl: monitorForm.value.targetUrl,
      method: monitorForm.value.method,
      intervalSec: monitorForm.value.intervalSec,
      successStatusCodes,
    },
  )
  monitors.value.unshift(monitor)
  monitorForm.value = {
    name: '',
    targetUrl: '',
    method: 'GET',
    intervalSec: 60,
    successStatusCodes: '200, 201, 202, 204',
  }
  createMonitorVisible.value = false
}

const createPushChannel = async () => {
  const channel = await developerProjectService.createPushChannel(selectedProjectId.value, {
    ...pushChannelForm.value,
    secretAlias: pushChannelForm.value.secretAlias || undefined,
  })
  pushChannels.value.unshift(channel)
  pushChannelForm.value = { name: '', type: 'webhook', endpoint: '', secretAlias: '' }
  createPushChannelVisible.value = false
}

const togglePushChannel = async (channel: DeveloperPushChannelDto) => {
  const updated = await developerProjectService.updatePushChannel(selectedProjectId.value, channel.id, {
    enabled: !channel.enabled,
  })
  pushChannels.value = pushChannels.value.map((item) => (item.id === updated.id ? updated : item))
}

const deletePushChannel = async (channel: DeveloperPushChannelDto) => {
  await ElMessageBox.confirm(`删除 ${channel.name} 后将无法继续使用该渠道投递消息。`, '删除推送渠道', {
    type: 'warning',
  })
  await developerProjectService.deletePushChannel(selectedProjectId.value, channel.id)
  pushChannels.value = pushChannels.value.filter((item) => item.id !== channel.id)
}

const checkMonitor = async (monitor: DeveloperStatusMonitorDto) => {
  const updated = await developerProjectService.checkMonitor(selectedProjectId.value, monitor.id)
  monitors.value = monitors.value.map((item) => (item.id === updated.id ? updated : item))
}

const toggleMonitor = async (monitor: DeveloperStatusMonitorDto) => {
  const updated = await developerProjectService.updateMonitor(selectedProjectId.value, monitor.id, {
    enabled: !monitor.enabled,
  })
  monitors.value = monitors.value.map((item) => (item.id === updated.id ? updated : item))
}

const deleteMonitor = async (monitor: DeveloperStatusMonitorDto) => {
  await ElMessageBox.confirm(`删除 ${monitor.name} 后，状态页将不再显示该目标。`, '删除监控目标', {
    type: 'warning',
  })
  await developerProjectService.deleteMonitor(selectedProjectId.value, monitor.id)
  monitors.value = monitors.value.filter((item) => item.id !== monitor.id)
}

const revokeKey = async (key: DeveloperApiKeyDto) => {
  await ElMessageBox.confirm(`撤销 ${key.name} 后无法恢复。`, '撤销项目 API Key', {
    type: 'warning',
  })
  await developerProjectService.revokeKey(selectedProjectId.value, key.id)
  keys.value = keys.value.filter((item) => item.id !== key.id)
}

const openCreateKv = () => {
  editingKvKey.value = ''
  kvForm.value = { key: '', value: '{}', ttlSeconds: undefined }
  kvDialogVisible.value = true
}

const editKv = async (entry: KvListEntry) => {
  const value = await developerProjectService.getKv(selectedProjectId.value, entry.key)
  editingKvKey.value = entry.key
  kvForm.value = {
    key: value.key,
    value: JSON.stringify(value.value, null, 2),
    ttlSeconds: undefined,
  }
  kvDialogVisible.value = true
}

const saveKv = async () => {
  let value: unknown
  try {
    value = JSON.parse(kvForm.value.value)
  } catch {
    ElMessage.error('值必须是合法 JSON')
    return
  }
  await developerProjectService.setKv(selectedProjectId.value, kvForm.value.key, {
    value,
    ttlSeconds: kvForm.value.ttlSeconds,
  })
  kvDialogVisible.value = false
  await refreshProjectResources()
}

const deleteKv = async (entry: KvListEntry) => {
  await ElMessageBox.confirm(`删除 ${entry.key} 后无法恢复。`, '删除 KV', { type: 'warning' })
  await developerProjectService.deleteKv(selectedProjectId.value, entry.key)
  kvEntries.value = kvEntries.value.filter((item) => item.key !== entry.key)
}

const updateStatusPagePublished = async (published: boolean) => {
  if (!activeProject.value) return
  const project = await developerProjectService.updateStatusPage(activeProject.value.id, published)
  projects.value = projects.value.map((item) => (item.id === project.id ? project : item))
  ElMessage.success(published ? '状态页已发布' : '状态页已撤回')
}

const copyStatusPage = async () => {
  if (!activeProject.value?.statusPagePublished) return
  await navigator.clipboard.writeText(new URL(`/status/${activeProject.value.slug}`, window.location.origin).toString())
  ElMessage.success('状态页地址已复制')
}
</script>

<template>
  <main v-loading="loading" class="developer-projects-page page-shell">
    <header class="workspace-header">
      <div>
        <p class="eyebrow">DEVELOPER SERVICES</p>
        <h1>开发者项目</h1>
        <p>为轻量应用集中管理存储、访问凭据和服务端工具。</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="createProjectVisible = true"
        >新建项目</el-button
      >
    </header>

    <section class="project-switcher" aria-label="项目选择">
      <el-select v-model="selectedProjectId" placeholder="选择项目" :disabled="!projects.length">
        <el-option
          v-for="project in projects"
          :key="project.id"
          :label="project.name"
          :value="project.id"
        >
          <span>{{ project.name }}</span
          ><small>{{ project.slug }}</small>
        </el-option>
      </el-select>
      <template v-if="activeProject">
        <span class="project-slug">/{{ activeProject.slug }}</span>
        <el-tag type="success">每日 {{ activeProject.dailyFreeQuota }} 次免费额度</el-tag>
      </template>
    </section>

    <el-empty v-if="!activeProject" description="创建第一个项目后即可生成项目 API Key" />

    <template v-else>
      <section class="service-strip">
        <article>
          <Service :size="19" /><span>KV 条目</span><strong>{{ kvEntries.length }}</strong>
        </article>
        <article>
          <Key :size="19" /><span>API Key</span><strong>{{ keys.length }}</strong>
        </article>
        <article>
          <Link :size="19" /><span>短链接</span><strong>{{ shortLinks.length }}</strong>
        </article>
        <article>
          <Service :size="19" /><span>托管密钥</span><strong>{{ secrets.length }}</strong>
        </article>
        <article>
          <Monitor :size="19" /><span>监控目标</span><strong>{{ monitors.length }}</strong>
        </article>
        <article>
          <Service :size="19" /><span>推送渠道</span><strong>{{ pushChannels.length }}</strong>
        </article>
      </section>

      <el-tabs class="developer-tabs">
        <el-tab-pane label="今日用量">
          <div class="panel-toolbar">
            <p>免费额度按项目和自然日计算，拒绝的超额调用不会计入用量。</p>
            <el-tag :type="quotaSummary?.overageEnabled ? 'warning' : 'info'">
              {{ quotaSummary?.overageEnabled ? '超额调用已启用' : '超额调用未启用' }}
            </el-tag>
          </div>
          <el-table :data="quotaSummary?.usages || []" empty-text="暂无按量服务">
            <el-table-column label="服务" min-width="180">
              <template #default="{ row }">{{ quotaServiceLabels[row.service] || row.service }}</template>
            </el-table-column>
            <el-table-column prop="requestCount" label="今日调用" width="140" />
            <el-table-column label="免费额度" width="140">
              <template #default="{ row }">{{ row.dailyFreeQuota }}</template>
            </el-table-column>
            <el-table-column prop="remainingFree" label="剩余免费次数" width="160" />
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="KV 存储">
          <div class="panel-toolbar">
            <p>在项目边界内保存 JSON 配置与临时数据，值仅在编辑时加载。</p>
            <el-button :icon="Plus" type="primary" @click="openCreateKv">新建 KV</el-button>
          </div>
          <el-table :data="kvEntries" empty-text="尚无 KV 条目">
            <el-table-column prop="key" label="键名" min-width="220" />
            <el-table-column prop="version" label="版本" width="90" />
            <el-table-column prop="expiresAt" label="过期时间" min-width="180">
              <template #default="{ row }">{{ row.expiresAt || '永久' }}</template>
            </el-table-column>
            <el-table-column prop="updateTime" label="最后更新" min-width="180" />
            <el-table-column width="130" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="editKv(row)">编辑</el-button>
                <el-button link type="danger" @click="deleteKv(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="API Key">
          <div class="panel-toolbar">
            <p>用于 KV、验证码、IP 定位和推送接口的服务端调用。</p>
            <el-button :icon="Plus" type="primary" @click="createKeyVisible = true"
              >创建 Key</el-button
            >
          </div>
          <el-table :data="keys" empty-text="尚无项目 API Key">
            <el-table-column prop="name" label="名称" min-width="160" />
            <el-table-column prop="keyPrefix" label="前缀" min-width="120" />
            <el-table-column label="权限" min-width="280"
              ><template #default="{ row }"
                ><el-tag
                  v-for="scope in row.scopes"
                  :key="scope"
                  class="scope-tag"
                  effect="plain"
                  >{{ scope }}</el-tag
                ></template
              ></el-table-column
            >
            <el-table-column prop="requestCount" label="调用次数" width="110" />
            <el-table-column width="80" fixed="right"
              ><template #default="{ row }"
                ><el-button link type="danger" @click="revokeKey(row)">撤销</el-button></template
              ></el-table-column
            >
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="短链接">
          <div class="panel-toolbar">
            <p>公开跳转路径为 <code>/s/{code}</code>，点击数直接在项目内汇总。</p>
            <el-button :icon="Plus" type="primary" @click="openCreateShortLink"
              >创建短链</el-button
            >
          </div>
          <el-table :data="shortLinks" empty-text="尚无短链接"
            ><el-table-column prop="code" label="代码" width="160" /><el-table-column
              prop="targetUrl"
              label="目标地址"
              min-width="320"
              show-overflow-tooltip
            /><el-table-column prop="clickCount" label="点击" width="100" /><el-table-column
              label="状态"
              width="100"
              ><template #default="{ row }"
                ><el-tag :type="row.enabled ? 'success' : 'info'">{{
                  row.enabled ? '启用' : '停用'
                }}</el-tag></template
              ></el-table-column
            ><el-table-column width="220" fixed="right">
              <template #default="{ row }">
                <el-button
                  :icon="CopyDocument"
                  circle
                  title="复制短链接"
                  @click="copyShortLink(row)"
                />
                <el-button link type="primary" @click="showShortLinkStats(row)">统计</el-button>
                <el-button link type="primary" @click="openEditShortLink(row)">编辑</el-button>
                <el-button link @click="toggleShortLink(row)">{{ row.enabled ? '停用' : '启用' }}</el-button>
                <el-button link type="danger" @click="deleteShortLink(row)">删除</el-button>
              </template>
            </el-table-column></el-table
          >
        </el-tab-pane>

        <el-tab-pane label="密钥托管">
          <div class="panel-toolbar">
            <p>
              值仅在写入时可见；在 API 转发中使用 <code v-pre>{{ ALIAS }}</code> 引用。
            </p>
            <el-button :icon="Plus" type="primary" @click="createSecretVisible = true"
              >新增密钥</el-button
            >
          </div>
          <el-table :data="secrets" empty-text="尚无托管密钥"
            ><el-table-column prop="alias" label="别名" min-width="220" /><el-table-column
              prop="keyVersion"
              label="版本"
              width="90" /><el-table-column prop="lastUsedAt" label="最后使用" min-width="180"
          /><el-table-column width="80" fixed="right"
            ><template #default="{ row }"
              ><el-button link type="danger" @click="deleteSecret(row)">删除</el-button></template
            ></el-table-column
          ></el-table>
        </el-tab-pane>

        <el-tab-pane label="状态监控">
          <div class="panel-toolbar">
            <p>
              每分钟由单实例调度器检查到期目标；公开状态页发布后可供外部查看。
            </p>
            <div class="status-page-actions">
              <el-switch
                :model-value="activeProject.statusPagePublished"
                active-text="已发布"
                inactive-text="未发布"
                @update:model-value="updateStatusPagePublished"
              />
              <el-button
                :icon="CopyDocument"
                circle
                title="复制状态页地址"
                :disabled="!activeProject.statusPagePublished"
                @click="copyStatusPage"
              />
              <el-button :icon="Plus" type="primary" @click="createMonitorVisible = true">添加目标</el-button>
            </div>
          </div>
          <el-table :data="monitors" empty-text="尚无监控目标"
            ><el-table-column prop="name" label="名称" min-width="160" /><el-table-column
              prop="targetUrl"
              label="地址"
              min-width="300"
              show-overflow-tooltip /><el-table-column label="状态" width="100"
              ><template #default="{ row }"
                ><el-tag
                  :type="row.lastStatus === 'up' ? 'success' : row.lastStatus ? 'danger' : 'info'"
                  >{{ row.lastStatus || '未检测' }}</el-tag
                ></template
              ></el-table-column
            ><el-table-column prop="lastCheckedAt" label="最近检测" width="180" /><el-table-column
              label="调度"
              width="90"
              ><template #default="{ row }"
                ><el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '运行中' : '已暂停' }}</el-tag></template
              ></el-table-column
            ><el-table-column
              width="190"
              ><template #default="{ row }"
                ><el-button
                  :icon="Refresh"
                  circle
                  title="立即检测"
                  :disabled="!row.enabled"
                  @click="checkMonitor(row)"
                /><el-button link @click="toggleMonitor(row)">{{ row.enabled ? '暂停' : '恢复' }}</el-button
                ><el-button link type="danger" @click="deleteMonitor(row)">删除</el-button></template
              ></el-table-column
          ></el-table>
        </el-tab-pane>

        <el-tab-pane label="推送渠道">
          <div class="panel-toolbar">
            <p>统一投递 Webhook、钉钉、飞书和企业微信消息，凭据只引用托管密钥别名。</p>
            <el-button :icon="Plus" type="primary" @click="createPushChannelVisible = true">添加渠道</el-button>
          </div>
          <el-table :data="pushChannels" empty-text="尚无推送渠道">
            <el-table-column prop="name" label="名称" min-width="150" />
            <el-table-column prop="type" label="类型" width="130" />
            <el-table-column prop="endpoint" label="Webhook 地址" min-width="280" show-overflow-tooltip />
            <el-table-column label="密钥别名" min-width="140">
              <template #default="{ row }">{{ row.secretAlias || '未使用' }}</template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column width="130" fixed="right">
              <template #default="{ row }">
                <el-button link @click="togglePushChannel(row)">{{ row.enabled ? '暂停' : '恢复' }}</el-button>
                <el-button link type="danger" @click="deletePushChannel(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="推送日志">
          <div class="panel-toolbar">
            <p>每次投递按渠道记录，失败记录会由调度器自动重试，最多三次。</p>
            <el-button :icon="Refresh" circle title="刷新投递日志" @click="refreshProjectResources" />
          </div>
          <el-table :data="pushDeliveries" empty-text="暂无推送投递记录">
            <el-table-column prop="channelId" label="渠道" min-width="200" show-overflow-tooltip />
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-tag :type="row.success ? 'success' : row.status === 'failed' ? 'danger' : 'info'">
                  {{ row.success ? '成功' : row.status === 'failed' ? '失败' : '处理中' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="attemptCount" label="尝试次数" width="110" />
            <el-table-column prop="nextRetryAt" label="下次重试" min-width="180" />
            <el-table-column prop="error" label="错误摘要" min-width="240" show-overflow-tooltip />
            <el-table-column prop="createTime" label="创建时间" min-width="180" />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </template>

    <el-dialog v-model="createProjectVisible" title="新建开发者项目" width="440px"
      ><el-form label-position="top"
        ><el-form-item label="项目名称"><el-input v-model="projectForm.name" /></el-form-item
        ><el-form-item label="项目标识"
          ><el-input v-model="projectForm.slug" placeholder="my-app" /></el-form-item
        ><el-form-item label="描述"
          ><el-input v-model="projectForm.description" type="textarea" /></el-form-item></el-form
      ><template #footer
        ><el-button @click="createProjectVisible = false">取消</el-button
        ><el-button
          type="primary"
          :disabled="!projectForm.name || !projectForm.slug"
          @click="createProject"
          >创建</el-button
        ></template
      ></el-dialog
    >
    <el-dialog v-model="kvDialogVisible" :title="editingKvKey ? '编辑 KV' : '新建 KV'" width="560px">
      <el-form label-position="top">
        <el-form-item label="键名">
          <el-input v-model="kvForm.key" :disabled="Boolean(editingKvKey)" placeholder="app.config" />
        </el-form-item>
        <el-form-item label="JSON 值">
          <el-input v-model="kvForm.value" type="textarea" :rows="8" spellcheck="false" />
        </el-form-item>
        <el-form-item label="TTL（秒，可选）">
          <el-input-number v-model="kvForm.ttlSeconds" :min="1" :max="2592000" controls-position="right" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="kvDialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!kvForm.key || !kvForm.value" @click="saveKv">保存</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="createKeyVisible" title="创建项目 API Key" width="480px"
      ><el-form label-position="top"
        ><el-form-item label="名称"><el-input v-model="keyForm.name" /></el-form-item
        ><el-form-item label="Scopes"
          ><el-checkbox-group v-model="keyForm.scopes"
            ><el-checkbox v-for="scope in projectKeyScopes" :key="scope" :label="scope">{{
              scope
            }}</el-checkbox></el-checkbox-group
          ></el-form-item
        ></el-form
      ><template #footer
        ><el-button @click="createKeyVisible = false">取消</el-button
        ><el-button
          type="primary"
          :disabled="!keyForm.name || !keyForm.scopes.length"
          @click="createKey"
          >创建并显示</el-button
        ></template
      ></el-dialog
    >
    <el-dialog
      v-model="createShortLinkVisible"
      :title="editingShortLinkId ? '编辑短链接' : '创建短链接'"
      width="480px"
      ><el-form label-position="top"
        ><el-form-item label="目标 URL"><el-input v-model="shortLinkForm.targetUrl" /></el-form-item
        ><el-form-item label="自定义代码（可选）"
          ><el-input v-model="shortLinkForm.code" :disabled="Boolean(editingShortLinkId)" /></el-form-item
        ><el-form-item label="过期时间（可选）"
          ><el-date-picker
            v-model="shortLinkForm.expiresAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"
            style="width: 100%" /></el-form-item
        ><el-form-item v-if="editingShortLinkId" label="状态"
          ><el-switch v-model="shortLinkForm.enabled" active-text="启用" inactive-text="停用" /></el-form-item
        ></el-form
      ><template #footer
        ><el-button @click="createShortLinkVisible = false">取消</el-button
        ><el-button type="primary" :disabled="!shortLinkForm.targetUrl" @click="saveShortLink"
          >{{ editingShortLinkId ? '保存' : '创建' }}</el-button
        ></template
      ></el-dialog
    >
    <el-dialog v-model="shortLinkStatsVisible" title="短链接统计" width="760px">
      <template v-if="shortLinkStats">
        <el-descriptions :column="3" border class="short-link-summary">
          <el-descriptions-item label="短码">{{ shortLinkStats.code }}</el-descriptions-item>
          <el-descriptions-item label="累计点击">{{ shortLinkStats.totalClicks }}</el-descriptions-item>
          <el-descriptions-item label="统计周期">近 30 天</el-descriptions-item>
        </el-descriptions>
        <section class="stats-section">
          <h3>每日点击</h3>
          <el-table :data="shortLinkStats.clicksByDay" max-height="180" empty-text="统计周期内暂无点击">
            <el-table-column prop="date" label="日期" />
            <el-table-column prop="count" label="点击数" width="120" />
          </el-table>
        </section>
        <section class="stats-grid">
          <div>
            <h3>来源域名</h3>
            <el-table :data="shortLinkStats.sources" max-height="180" empty-text="暂无来源信息">
              <el-table-column label="来源">
                <template #default="{ row }">{{ row.sourceHost || '直接访问' }}</template>
              </el-table-column>
              <el-table-column prop="count" label="点击" width="80" />
            </el-table>
          </div>
          <div>
            <h3>国家/地区</h3>
            <el-table :data="shortLinkStats.countries" max-height="180" empty-text="暂无地区信息">
              <el-table-column label="地区">
                <template #default="{ row }">{{ row.country || '未知' }}</template>
              </el-table-column>
              <el-table-column prop="count" label="点击" width="80" />
            </el-table>
          </div>
        </section>
        <section class="stats-section">
          <h3>最近点击</h3>
          <el-table :data="shortLinkStats.recentClicks" max-height="220" empty-text="暂无点击记录">
            <el-table-column prop="clickedAt" label="时间" min-width="180" />
            <el-table-column label="来源" min-width="150">
              <template #default="{ row }">{{ row.sourceHost || '直接访问' }}</template>
            </el-table-column>
            <el-table-column label="地区" width="90">
              <template #default="{ row }">{{ row.country || '未知' }}</template>
            </el-table-column>
            <el-table-column prop="userAgent" label="客户端" min-width="180" show-overflow-tooltip />
          </el-table>
        </section>
      </template>
    </el-dialog>
    <el-dialog v-model="createSecretVisible" title="新增托管密钥" width="480px"
      ><el-form label-position="top"
        ><el-form-item label="别名"
          ><el-input v-model="secretForm.alias" placeholder="OPENAI_KEY" /></el-form-item
        ><el-form-item label="密钥值"
          ><el-input
            v-model="secretForm.value"
            type="password"
            show-password /></el-form-item></el-form
      ><template #footer
        ><el-button @click="createSecretVisible = false">取消</el-button
        ><el-button
          type="primary"
          :disabled="!secretForm.alias || !secretForm.value"
          @click="saveSecret"
          >加密保存</el-button
        ></template
      ></el-dialog
    >
    <el-dialog v-model="createMonitorVisible" title="添加监控目标" width="480px"
      ><el-form label-position="top"
        ><el-form-item label="名称"><el-input v-model="monitorForm.name" /></el-form-item
        ><el-form-item label="URL"><el-input v-model="monitorForm.targetUrl" /></el-form-item
        ><el-form-item label="方法"
          ><el-radio-group v-model="monitorForm.method"
            ><el-radio value="GET">GET</el-radio
            ><el-radio value="HEAD">HEAD</el-radio></el-radio-group
          ></el-form-item
        ><el-form-item label="检查间隔（秒）"
          ><el-input-number
            v-model="monitorForm.intervalSec"
            :min="60"
            :max="86400"
            controls-position="right"
          /></el-form-item
        ><el-form-item label="成功状态码"
          ><el-input v-model="monitorForm.successStatusCodes" placeholder="200, 201, 204" /></el-form-item
        ></el-form
      ><template #footer
        ><el-button @click="createMonitorVisible = false">取消</el-button
        ><el-button
          type="primary"
          :disabled="!monitorForm.name || !monitorForm.targetUrl"
          @click="createMonitor"
          >添加</el-button
        ></template
      ></el-dialog
    >
    <el-dialog v-model="createPushChannelVisible" title="添加推送渠道" width="500px">
      <el-form label-position="top">
        <el-form-item label="名称"><el-input v-model="pushChannelForm.name" /></el-form-item>
        <el-form-item label="类型">
          <el-select v-model="pushChannelForm.type" style="width: 100%">
            <el-option label="通用 Webhook" value="webhook" />
            <el-option label="钉钉机器人" value="dingtalk" />
            <el-option label="飞书机器人" value="feishu" />
            <el-option label="企业微信机器人" value="wechat_work" />
          </el-select>
        </el-form-item>
        <el-form-item label="Webhook 地址"><el-input v-model="pushChannelForm.endpoint" /></el-form-item>
        <el-form-item label="托管密钥别名（可选）">
          <el-select v-model="pushChannelForm.secretAlias" clearable filterable style="width: 100%">
            <el-option v-for="secret in secrets" :key="secret.id" :label="secret.alias" :value="secret.alias" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createPushChannelVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!pushChannelForm.name || !pushChannelForm.endpoint"
          @click="createPushChannel"
          >添加</el-button
        >
      </template>
    </el-dialog>
  </main>
</template>

<style scoped>
.developer-projects-page {
  max-width: 1320px;
  padding: 28px 32px 48px;
}
.workspace-header {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: end;
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding-bottom: 24px;
}
.workspace-header h1 {
  margin: 4px 0 8px;
  font-size: 28px;
  font-weight: 650;
  color: var(--el-text-color-primary);
}
.workspace-header p {
  margin: 0;
  color: var(--el-text-color-secondary);
}
.eyebrow {
  color: var(--el-color-primary) !important;
  font:
    600 12px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  letter-spacing: 1px;
}
.project-switcher {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 0;
  min-height: 68px;
}
.project-switcher :deep(.el-select) {
  width: min(320px, 100%);
}
.project-switcher small {
  margin-left: 12px;
  color: var(--el-text-color-secondary);
}
.project-slug {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--el-text-color-secondary);
}
.service-strip {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  border: 1px solid var(--el-border-color-lighter);
  margin-bottom: 24px;
}
.service-strip article {
  min-height: 72px;
  padding: 14px 18px;
  display: grid;
  grid-template-columns: 24px 1fr auto;
  align-items: center;
  gap: 8px;
  border-right: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-secondary);
}
.service-strip article:last-child {
  border-right: 0;
}
.service-strip strong {
  color: var(--el-text-color-primary);
  font-size: 24px;
  font-variant-numeric: tabular-nums;
}
.developer-tabs :deep(.el-tabs__content) {
  padding-top: 18px;
}
.panel-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  margin-bottom: 16px;
}
.panel-toolbar p {
  margin: 0;
  color: var(--el-text-color-secondary);
}
.status-page-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.scope-tag {
  margin: 2px 4px 2px 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.short-link-summary {
  margin-bottom: 20px;
}
.stats-section {
  margin-top: 20px;
}
.stats-section h3,
.stats-grid h3 {
  margin: 0 0 10px;
  font-size: 14px;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  margin-top: 20px;
}
code {
  color: var(--el-color-primary);
}
@media (max-width: 760px) {
  .developer-projects-page {
    padding: 20px 16px 36px;
  }
  .workspace-header,
  .panel-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
  .service-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .stats-grid {
    grid-template-columns: 1fr;
  }
  .status-page-actions {
    width: 100%;
    flex-wrap: wrap;
  }
  .service-strip article:nth-child(even) {
    border-right: 0;
  }
  .service-strip article:not(:last-child) {
    border-bottom: 1px solid var(--el-border-color-lighter);
  }
}
</style>
