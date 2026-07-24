<template>
  <section v-if="instance" class="surface" v-loading="loading"><div class="toolbar"><div><h2>监控目标</h2><p>仅允许已通过 SSRF 防护的 HTTP(S) 目标。</p></div><div v-if="canManage"><el-button plain @click="published = !published; savePage()">{{published?'取消发布':'发布状态页'}}</el-button><el-button type="primary" @click="openCreate">添加目标</el-button></div></div><el-table :data="monitors"><el-table-column prop="name" label="名称" min-width="130"/><el-table-column prop="targetUrl" label="目标 URL" min-width="220" show-overflow-tooltip/><el-table-column prop="lastStatus" label="最近状态" width="110"/><el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.enabled?'success':'info'">{{row.enabled?'启用':'暂停'}}</el-tag></template></el-table-column><el-table-column label="操作" width="250" fixed="right"><template #default="{row}"><el-button link @click="check(row.id)">检测</el-button><template v-if="canManage"><el-button link @click="edit(row)">编辑</el-button><el-button link :type="row.enabled?'warning':'primary'" @click="toggle(row)">{{row.enabled?'暂停':'恢复'}}</el-button><el-button link type="danger" @click="remove(row)">删除</el-button></template></template></el-table-column></el-table><el-empty v-if="!monitors.length&&!loading" description="暂无监控目标"/>
    <el-dialog v-model="dialog" :title="editing?'编辑监控目标':'添加监控目标'" width="520px"><el-form label-position="top"><el-form-item label="名称"><el-input v-model="form.name"/></el-form-item><el-form-item label="目标 URL"><el-input v-model="form.targetUrl"/></el-form-item><el-form-item label="方法"><el-select v-model="form.method"><el-option label="GET" value="GET"/><el-option label="HEAD" value="HEAD"/></el-select></el-form-item><el-form-item label="间隔（秒）"><el-input-number v-model="form.intervalSec" :min="60"/></el-form-item></el-form><template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template></el-dialog>
  </section>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { DeveloperProductInstanceDto, DeveloperStatusMonitorDto } from '@/client/types.gen'
import { developerProductService } from '@/service/developerProductService'

const props = defineProps<{ instance?: DeveloperProductInstanceDto; canManage: boolean }>()
const loading = ref(false)
const monitors = ref<DeveloperStatusMonitorDto[]>([])
const dialog = ref(false)
const editing = ref<DeveloperStatusMonitorDto>()
const published = ref(false)
const form = ref({ name: '', targetUrl: '', method: 'GET' as 'GET' | 'HEAD', intervalSec: 60 })
const load = async () => {
  if (!props.instance) return
  loading.value = true
  try {
    const [nextMonitors, page] = await Promise.all([
      developerProductService.listMonitorResources(props.instance.id),
      props.canManage ? developerProductService.getStatusPageResource(props.instance.id) : Promise.resolve(undefined),
    ])
    monitors.value = nextMonitors
    published.value = page?.statusPagePublished || false
  } finally { loading.value = false }
}
const openCreate = () => { editing.value = undefined; form.value = { name: '', targetUrl: '', method: 'GET', intervalSec: 60 }; dialog.value = true }
const edit = (row: DeveloperStatusMonitorDto) => { editing.value = row; form.value = { name: row.name, targetUrl: row.targetUrl, method: row.method as 'GET' | 'HEAD', intervalSec: row.intervalSec }; dialog.value = true }
const save = async () => { if (!props.instance) return; if (editing.value) await developerProductService.updateMonitorResource(props.instance.id, editing.value.id, form.value); else await developerProductService.createMonitorResource(props.instance.id, form.value); dialog.value = false; await load(); ElMessage.success('监控目标已保存') }
const toggle = async (row: DeveloperStatusMonitorDto) => { if (!props.instance) return; await developerProductService.updateMonitorResource(props.instance.id, row.id, { enabled: !row.enabled }); await load() }
const check = async (id: string) => { if (!props.instance) return; await developerProductService.checkMonitorResource(props.instance.id, id); await load(); ElMessage.success('检测已完成') }
const remove = async (row: DeveloperStatusMonitorDto) => { if (!props.instance) return; await ElMessageBox.confirm(`删除监控目标 ${row.name} 后无法恢复。`, '删除监控目标', { type: 'warning' }); await developerProductService.deleteMonitorResource(props.instance.id, row.id); await load(); ElMessage.success('监控目标已删除') }
const savePage = async () => { if (!props.instance) return; await developerProductService.updateStatusPageResource(props.instance.id, { published: published.value }); ElMessage.success(published.value ? '状态页已发布' : '状态页已取消发布') }
watch(() => props.instance?.id, load, { immediate: true })
</script><style scoped>.toolbar{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:16px}.toolbar h2{margin:0 0 6px;font-size:17px}.toolbar p{margin:0;color:var(--el-text-color-secondary)}</style>
