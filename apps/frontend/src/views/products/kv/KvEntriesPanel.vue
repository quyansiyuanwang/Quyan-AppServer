<template>
  <section v-if="instance" class="surface" v-loading="loading">
    <div class="toolbar"><div><h2>KV 条目</h2><p>值按实例隔离；列表不展开 JSON 内容。</p></div><el-button v-if="canManage" type="primary" @click="openCreate">新建 KV</el-button></div>
    <el-table :data="entries"><el-table-column prop="key" label="键" min-width="180"><template #default="{ row }"><code>{{ row.key }}</code></template></el-table-column><el-table-column prop="version" label="版本" width="90" /><el-table-column label="过期时间" min-width="170"><template #default="{ row }">{{ row.expiresAt ? new Date(row.expiresAt).toLocaleString() : '永不过期' }}</template></el-table-column><el-table-column label="操作" width="170"><template #default="{ row }"><el-button link @click="edit(row)">查看/编辑</el-button><el-button v-if="canManage" link type="danger" @click="remove(row.key)">删除</el-button></template></el-table-column></el-table>
    <el-empty v-if="!entries.length && !loading" description="暂无 KV 条目" />
    <el-dialog v-model="dialog" :title="editing ? '编辑 KV' : '新建 KV'" width="560px"><el-form label-position="top"><el-form-item label="键"><el-input v-model="form.key" :disabled="editing" /></el-form-item><el-form-item label="JSON 值"><el-input v-model="form.value" type="textarea" :rows="8" /></el-form-item><el-form-item label="TTL（秒，留空表示永不过期）"><el-input-number v-model="form.ttlSeconds" :min="1" /></el-form-item></el-form><template #footer><el-button @click="dialog = false">取消</el-button><el-button v-if="canManage" type="primary" @click="save">保存</el-button></template></el-dialog>
  </section>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { DeveloperKvValueDto, DeveloperProductInstanceDto } from '@/client/types.gen'
import { developerProductService } from '@/service/developerProductService'
const props = defineProps<{ instance?: DeveloperProductInstanceDto; canManage: boolean }>()
type KvEntrySummary = Pick<DeveloperKvValueDto, 'key' | 'version' | 'expiresAt' | 'updateTime'>
const loading = ref(false); const entries = ref<KvEntrySummary[]>([]); const dialog = ref(false); const editing = ref(false); const form = ref({ key: '', value: '{}', ttlSeconds: undefined as number | undefined })
const load = async () => { if (!props.instance) return; loading.value = true; try { entries.value = await developerProductService.listKvResources(props.instance.id) as KvEntrySummary[] } finally { loading.value = false } }
const openCreate = () => { editing.value = false; form.value = { key: '', value: '{}', ttlSeconds: undefined }; dialog.value = true }
const edit = async (row: KvEntrySummary) => { if (!props.instance) return; const detail = await developerProductService.getKvResource(props.instance.id, row.key); editing.value = true; form.value = { key: detail.key, value: JSON.stringify(detail.value, null, 2), ttlSeconds: undefined }; dialog.value = true }
const save = async () => { if (!props.instance) return; try { await developerProductService.setKvResource(props.instance.id, form.value.key, { value: JSON.parse(form.value.value), ttlSeconds: form.value.ttlSeconds }); dialog.value = false; await load(); ElMessage.success('KV 已保存') } catch { ElMessage.error('JSON 值无效或保存失败') } }
const remove = async (key: string) => { if (!props.instance) return; await ElMessageBox.confirm(`删除 ${key} 后无法恢复。`, '删除 KV', { type: 'warning' }); await developerProductService.deleteKvResource(props.instance.id, key); await load(); ElMessage.success('KV 已删除') }
watch(() => props.instance?.id, load, { immediate: true })
</script>
<style scoped>.toolbar { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; margin-bottom:16px }.toolbar h2{margin:0 0 6px;font-size:17px}.toolbar p{margin:0;color:var(--el-text-color-secondary)}</style>
