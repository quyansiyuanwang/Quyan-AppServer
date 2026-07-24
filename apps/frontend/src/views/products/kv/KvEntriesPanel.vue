<template>
  <section v-if="instance" class="resource-panel" v-loading="loading">
    <div class="toolbar"><div><h2>{{ t('productResources.kvTitle') }}</h2><p>{{ t('productResources.kvDescription') }}</p></div><el-button v-if="canManage" type="primary" @click="openCreate">{{ t('productResources.newKv') }}</el-button></div>
    <el-table :data="entries"><el-table-column prop="key" :label="t('productResources.key')" min-width="180"><template #default="{ row }"><code>{{ row.key }}</code></template></el-table-column><el-table-column prop="version" :label="t('productResources.version')" width="90"/><el-table-column :label="t('productResources.expiresAt')" min-width="170"><template #default="{ row }">{{ row.expiresAt ? new Date(row.expiresAt).toLocaleString() : t('productResources.neverExpires') }}</template></el-table-column><el-table-column :label="t('productResources.actions')" width="170"><template #default="{ row }"><el-button link @click="edit(row)">{{ t('productResources.edit') }}</el-button><el-button v-if="canManage" link type="danger" @click="remove(row.key)">{{ t('productResources.delete') }}</el-button></template></el-table-column></el-table>
    <el-empty v-if="!entries.length && !loading" :description="t('productResources.empty')" />
    <el-dialog v-model="dialog" :title="editing ? t('productResources.edit') : t('productResources.newKv')" width="560px" destroy-on-close><el-form label-position="top"><el-form-item :label="t('productResources.key')"><el-input v-model="form.key" :disabled="editing" /></el-form-item><el-form-item :label="t('productResources.jsonValue')"><el-input v-model="form.value" type="textarea" :rows="8" /></el-form-item><el-form-item :label="t('productResources.ttlSeconds')"><el-input-number v-model="form.ttlSeconds" :min="1"/><p class="field-hint">{{ t('productResources.ttlHint') }}</p></el-form-item></el-form><template #footer><el-button @click="dialog = false">{{ t('cancel') }}</el-button><el-button v-if="canManage" type="primary" @click="save">{{ t('productResources.save') }}</el-button></template></el-dialog>
  </section>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { DeveloperKvValueDto, DeveloperProductInstanceDto } from '@/client/types.gen'
import { developerProductService } from '@/service/developerProductService'
import { i18ns } from '@/locales'
const { t } = i18ns
const props = defineProps<{ instance?: DeveloperProductInstanceDto; canManage: boolean }>()
type KvEntrySummary = Pick<DeveloperKvValueDto, 'key' | 'version' | 'expiresAt' | 'updateTime'>
const loading = ref(false); const entries = ref<KvEntrySummary[]>([]); const dialog = ref(false); const editing = ref(false); const form = ref({ key: '', value: '{}', ttlSeconds: undefined as number | undefined })
const load = async () => { if (!props.instance) return; loading.value = true; try { entries.value = await developerProductService.listKvResources(props.instance.id) as KvEntrySummary[] } finally { loading.value = false } }
const openCreate = () => { editing.value = false; form.value = { key: '', value: '{}', ttlSeconds: undefined }; dialog.value = true }
const edit = async (row: KvEntrySummary) => { if (!props.instance) return; const detail = await developerProductService.getKvResource(props.instance.id, row.key); const expiresAt = detail.expiresAt ? new Date(detail.expiresAt).getTime() : 0; editing.value = true; form.value = { key: detail.key, value: JSON.stringify(detail.value, null, 2), ttlSeconds: expiresAt ? Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)) : undefined }; dialog.value = true }
const save = async () => { if (!props.instance) return; try { await developerProductService.setKvResource(props.instance.id, form.value.key, { value: JSON.parse(form.value.value), ttlSeconds: form.value.ttlSeconds }); dialog.value = false; await load(); ElMessage.success(t('productResources.kvSaved')) } catch { ElMessage.error(t('productResources.kvInvalid')) } }
const remove = async (key: string) => { if (!props.instance) return; await ElMessageBox.confirm(`${t('delete')} ${key}?`, t('confirmDelete'), { type: 'warning' }); await developerProductService.deleteKvResource(props.instance.id, key); await load(); ElMessage.success(t('deleteSuccess')) }
watch(() => props.instance?.id, load, { immediate: true })
</script>
<style scoped>.toolbar{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:16px}.toolbar h2{margin:0 0 6px;font-size:17px}.toolbar p,.field-hint{margin:0;color:var(--el-text-color-secondary)}.field-hint{margin-top:6px;font-size:12px}</style>
