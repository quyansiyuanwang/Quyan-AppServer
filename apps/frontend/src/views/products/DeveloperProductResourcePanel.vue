<template>
  <section v-if="instance" class="product-panel resource-panel" v-loading="loading">
    <div class="section-title">
      <div>
        <h2>{{ title }}</h2>
        <p>{{ subtitle }}</p>
      </div>
      <el-button v-if="canCreate" type="primary" plain :icon="Plus" @click="dialog = true">{{
        createLabel
      }}</el-button>
    </div>
    <el-table v-if="resources.length" :data="resources"
      ><el-table-column
        v-for="column in columns"
        :key="column.key"
        :prop="column.key"
        :label="column.label"
        :min-width="column.width || 150"
        ><template #default="{ row }"
          ><code v-if="column.code">{{ row[column.key] }}</code
          ><span v-else>{{ format(row[column.key]) }}</span></template
        ></el-table-column
      ><el-table-column v-if="product === 'kv'" label="操作" width="90"
        ><template #default="{ row }"
          ><el-button link type="danger" @click="removeKv(row.key)">删除</el-button></template
        ></el-table-column
      ></el-table
    >
    <el-empty v-else description="暂无资源" />
    <el-dialog v-model="dialog" :title="createLabel" width="480px"
      ><el-form label-position="top"
        ><template v-if="product === 'kv'"
          ><el-form-item label="键"><el-input v-model="form.key" /></el-form-item
          ><el-form-item label="JSON 值"
            ><el-input v-model="form.value" type="textarea" :rows="5" /></el-form-item
          ><el-form-item label="TTL（秒，可选）"
            ><el-input-number v-model="form.ttlSeconds" :min="1" /></el-form-item></template
        ><template v-else-if="product === 'short_link'"
          ><el-form-item label="目标 URL"><el-input v-model="form.targetUrl" /></el-form-item
          ><el-form-item label="自定义短码（可选）"
            ><el-input v-model="form.code" /></el-form-item></template
        ><template v-else-if="product === 'secret'"
          ><el-form-item label="别名"><el-input v-model="form.alias" /></el-form-item
          ><el-form-item label="密钥值"
            ><el-input
              v-model="form.secretValue"
              type="password"
              show-password /></el-form-item></template></el-form
      ><template #footer
        ><el-button @click="dialog = false">取消</el-button
        ><el-button type="primary" @click="create">保存</el-button></template
      ></el-dialog
    >
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import type { DeveloperProductCode, DeveloperProductInstanceDto } from '@/client/types.gen'
import { developerProductService } from '@/service/developerProductService'

const props = defineProps<{
  product: DeveloperProductCode
  instance?: DeveloperProductInstanceDto
}>()
const product = computed(() => props.product)
const instance = computed(() => props.instance)
const loading = ref(false)
const dialog = ref(false)
const resources = ref<Record<string, unknown>[]>([])
const form = ref({
  key: '',
  value: '{}',
  ttlSeconds: undefined as number | undefined,
  targetUrl: '',
  code: '',
  alias: '',
  secretValue: '',
})
const info: Record<
  DeveloperProductCode,
  {
    title: string
    subtitle: string
    columns: { key: string; label: string; code?: boolean; width?: number }[]
    create?: string
  }
> = {
  kv: {
    title: 'KV 条目',
    subtitle: 'JSON 值按实例隔离，大值不会出现在列表中。',
    columns: [
      { key: 'key', label: '键', code: true },
      { key: 'version', label: '版本' },
      { key: 'expiresAt', label: '过期时间', width: 180 },
    ],
    create: '新建 KV',
  },
  short_link: {
    title: '短链接',
    subtitle: '公开入口为 /s/{code}，跳转统计按保留期清理。',
    columns: [
      { key: 'code', label: '短码', code: true },
      { key: 'targetUrl', label: '目标 URL' },
      { key: 'clickCount', label: '点击量' },
    ],
    create: '创建短链接',
  },
  secret: {
    title: '密钥别名',
    subtitle: '明文仅用于写入，列表只展示掩码和元数据。',
    columns: [
      { key: 'alias', label: '别名', code: true },
      { key: 'maskedValue', label: '掩码', code: true },
      { key: 'version', label: '版本' },
    ],
    create: '写入密钥',
  },
  status: {
    title: '监控目标',
    subtitle: '可配置监控与公开状态页；检查记录由保留策略自动清理。',
    columns: [
      { key: 'name', label: '名称' },
      { key: 'url', label: 'URL' },
      { key: 'lastStatus', label: '最近状态' },
    ],
  },
  verification: {
    title: '验证码服务',
    subtitle: '该产品不保存额外资源。使用 API Key 调用发送和验证接口。',
    columns: [],
  },
  ip_geolocation: {
    title: 'IP 定位服务',
    subtitle: '该产品不保存额外资源。使用 API Key 查询公网 IP。',
    columns: [],
  },
  push: {
    title: '推送渠道',
    subtitle: '渠道凭据使用密钥别名引用，投递日志单独保存。',
    columns: [
      { key: 'name', label: '渠道名称' },
      { key: 'type', label: '类型' },
      { key: 'enabled', label: '状态' },
    ],
  },
}
const title = computed(() => info[product.value].title)
const subtitle = computed(() => info[product.value].subtitle)
const columns = computed(() => info[product.value].columns)
const createLabel = computed(() => info[product.value].create || '')
const canCreate = computed(() => Boolean(info[product.value].create))
const format = (value: unknown) =>
  value == null ? '-' : typeof value === 'boolean' ? (value ? '启用' : '停用') : String(value)
const load = async () => {
  if (!instance.value) return
  loading.value = true
  try {
    const id = instance.value.id
    const data =
      product.value === 'kv'
        ? await developerProductService.listKvResources(id)
        : product.value === 'short_link'
          ? await developerProductService.listShortLinkResources(id)
          : product.value === 'secret'
            ? await developerProductService.listSecretResources(id)
            : product.value === 'status'
              ? await developerProductService.listMonitorResources(id)
              : product.value === 'push'
                ? await developerProductService.listPushChannelResources(id)
                : []
    resources.value = data as Record<string, unknown>[]
  } finally {
    loading.value = false
  }
}
const create = async () => {
  if (!instance.value) return
  try {
    if (product.value === 'kv') {
      await developerProductService.setKvResource(instance.value.id, form.value.key, {
        value: JSON.parse(form.value.value),
        ttlSeconds: form.value.ttlSeconds,
      })
    } else if (product.value === 'short_link') {
      await developerProductService.createShortLinkResource(instance.value.id, {
        targetUrl: form.value.targetUrl,
        code: form.value.code || undefined,
      })
    } else if (product.value === 'secret') {
      await developerProductService.upsertSecretResource(instance.value.id, {
        alias: form.value.alias,
        value: form.value.secretValue,
      })
    }
    dialog.value = false
    form.value = {
      key: '',
      value: '{}',
      ttlSeconds: undefined,
      targetUrl: '',
      code: '',
      alias: '',
      secretValue: '',
    }
    await load()
    ElMessage.success('资源已保存')
  } catch {
    ElMessage.error('资源保存失败，请检查输入和 RAM 权限。')
  }
}
const removeKv = async (key: unknown) => {
  if (!instance.value || typeof key !== 'string') return
  await ElMessageBox.confirm('删除后无法恢复。', '删除 KV', { type: 'warning' })
  await developerProductService.deleteKvResource(instance.value.id, key)
  await load()
}
watch([product, instance], load, { immediate: true })
</script>

<style scoped lang="scss">
.resource-panel {
  margin-top: 16px;
}
.section-title {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 16px;
}
.section-title h2 {
  margin: 0 0 6px;
  font-size: 17px;
}
.section-title p {
  margin: 0;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.resource-panel code {
  font-size: 12px;
  overflow-wrap: anywhere;
}
</style>
