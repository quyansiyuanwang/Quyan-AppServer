<template>
  <section class="scoped-section">
    <h3>{{ i18ns.t('RamManagement.scopedAuthorizations') }}</h3>
    <RamIamAuthorizationForm
      :selected-resource-group="selectedResourceGroup"
      @created="records.load(1)"
    />
    <div class="scoped-toolbar">
      <el-input
        v-model="filterId"
        data-test="authorization-filter"
        :placeholder="i18ns.t('RamManagement.scopedFilterPrincipal')"
      />
      <el-button
        data-test="authorization-load"
        :disabled="busy || records.loading.value"
        @click="records.load(1)"
        >{{ i18ns.t('RamManagement.scopedLoad') }}</el-button
      >
    </div>
    <el-alert
      v-if="records.failed.value"
      :title="i18ns.t('RamManagement.scopedLoadFailed')"
      type="error"
      :closable="false"
    />
    <el-table :data="records.items.value" v-loading="records.loading.value" row-key="id">
      <el-table-column
        prop="id"
        :label="i18ns.t('RamManagement.scopedAuthorizationId')"
        min-width="180"
      />
      <el-table-column
        prop="principalType"
        :label="i18ns.t('RamManagement.scopedPrincipalType')"
        width="100"
      />
      <el-table-column
        prop="principalId"
        :label="i18ns.t('RamManagement.scopedPrincipalId')"
        min-width="180"
      />
      <el-table-column
        prop="policyId"
        :label="i18ns.t('RamManagement.scopedPolicyId')"
        min-width="180"
      />
      <el-table-column :label="i18ns.t('RamManagement.scopedScope')" min-width="220"
        ><template #default="{ row }"
          ><code
            >{{ row.scopeType }} {{ row.scopeArn || row.scopeResourceId || '' }}</code
          ></template
        ></el-table-column
      >
      <el-table-column :label="i18ns.t('RamManagement.scopedOperations')" width="120"
        ><template #default="{ row }"
          ><el-button :disabled="busy" type="danger" @click="remove(row.id)">{{
            i18ns.t('RamManagement.scopedRevoke')
          }}</el-button></template
        ></el-table-column
      >
    </el-table>
    <RamIamPageControls
      :page="records.page.value"
      :page-size="records.pageSize.value"
      :has-next="records.hasNext.value"
      :loading="records.loading.value || busy"
      @previous="records.previous"
      @next="records.next"
      @size="resize"
    />
    <p>{{ i18ns.t('RamManagement.scopedPageHint') }}</p>
  </section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ramService } from '@/service/ramService'
import { i18ns } from '@/locales'
import { ElMessageBox } from '@/utils/elementPlusRuntime'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import { useIamManagementPage } from '../useIamManagementPage'
import RamIamPageControls from './RamIamPageControls.vue'
import RamIamAuthorizationForm from './RamIamAuthorizationForm.vue'
defineProps<{ selectedResourceGroup?: { id: string } }>()
const busy = ref(false)
const filterId = ref('')
const records = useIamManagementPage((query) =>
  ramService.listAuthorizationPage({
    ...query,
    ...(filterId.value.trim() ? { principalId: filterId.value.trim() } : {}),
  }),
)
watch(filterId, records.clear)
const resize = (size: number) => {
  records.pageSize.value = size
  void records.load(1)
}
const remove = async (id: string) => {
  if (busy.value) return
  try {
    await ElMessageBox.confirm(
      i18ns.t('RamManagement.scopedRevokeConfirm'),
      i18ns.t('RamManagement.scopedRevoke'),
      { type: 'warning' },
    )
  } catch {
    return
  }
  if (busy.value) return
  busy.value = true
  try {
    await ramService.deleteAuthorization(id)
    await records.load()
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('RamManagement.scopedWriteFailed'))
  } finally {
    busy.value = false
  }
}
onMounted(() => void records.load())
onBeforeUnmount(records.clear)
</script>
<style scoped>
.scoped-section {
  display: grid;
  gap: 12px;
  margin-bottom: 24px;
}
.scoped-toolbar {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 12px;
}
.scoped-toolbar .el-input {
  max-width: 360px;
}
code {
  overflow-wrap: anywhere;
}
</style>
