<template>
  <section class="scoped-section">
    <h3>{{ i18ns.t('RamManagement.scopedAuthorizations') }}</h3>
    <el-alert
      :title="i18ns.t('RamManagement.scopedAuthorizationHint')"
      type="info"
      :closable="false"
    />
    <el-form label-position="top" class="scoped-form">
      <el-form-item :label="i18ns.t('RamManagement.scopedPrincipalType')"
        ><el-select v-model="form.principalType" :disabled="busy"
          ><el-option
            v-for="type in principalTypes"
            :key="type"
            :value="type"
            :label="type" /></el-select
      ></el-form-item>
      <el-form-item :label="i18ns.t('RamManagement.scopedPrincipalId')"
        ><el-input v-model="form.principalId" data-test="authorization-principal" :disabled="busy"
      /></el-form-item>
      <el-form-item :label="i18ns.t('RamManagement.scopedPolicyId')"
        ><el-input v-model="form.policyId" data-test="authorization-policy" :disabled="busy"
      /></el-form-item>
      <el-form-item :label="i18ns.t('RamManagement.scopedScope')"
        ><el-select v-model="form.scopeType" :disabled="busy"
          ><el-option
            v-for="type in scopeTypes"
            :key="type"
            :value="type"
            :label="type" /></el-select
      ></el-form-item>
      <el-form-item
        v-if="form.scopeType === 'resource-group'"
        :label="i18ns.t('RamManagement.scopedGroupId')"
        ><el-input v-model="form.scopeResourceId" data-test="authorization-group" :disabled="busy"
      /></el-form-item>
      <el-form-item
        v-if="form.scopeType === 'resource'"
        :label="i18ns.t('RamManagement.scopedResourceArn')"
        ><el-input v-model="form.scopeArn" data-test="authorization-arn" :disabled="busy"
      /></el-form-item>
      <el-button
        data-test="authorization-create"
        :disabled="busy || !complete"
        :loading="busy"
        @click="create"
        >{{ i18ns.t('RamManagement.scopedCreateAuthorization') }}</el-button
      >
    </el-form>
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
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  IAM_PRINCIPAL_TYPES as principalTypes,
  IAM_AUTHORIZATION_SCOPE_TYPES as scopeTypes,
} from '@quyan/shared'
import type { CreateRamAuthorizationDto } from '@/client/types.gen'
import { ramService } from '@/service/ramService'
import { i18ns } from '@/locales'
import { ElMessageBox } from '@/utils/elementPlusRuntime'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import { useIamManagementPage } from '../useIamManagementPage'
import RamIamPageControls from './RamIamPageControls.vue'
const props = defineProps<{ selectedResourceGroup?: { id: string } }>()
const busy = ref(false)
const filterId = ref('')
const form = reactive({
  principalType: 'user' as CreateRamAuthorizationDto['principalType'],
  principalId: '',
  policyId: '',
  scopeType: 'account' as CreateRamAuthorizationDto['scopeType'],
  scopeResourceId: '',
  scopeArn: '',
})
const records = useIamManagementPage((query) =>
  ramService.listAuthorizationPage({
    ...query,
    ...(filterId.value.trim() ? { principalId: filterId.value.trim() } : {}),
  }),
)
watch(filterId, records.clear)
watch(
  () => props.selectedResourceGroup,
  (id) => {
    if (id && !busy.value) {
      form.scopeType = 'resource-group'
      form.scopeResourceId = id.id
    }
  },
)
const complete = computed(
  () =>
    !!form.principalId.trim() &&
    !!form.policyId.trim() &&
    (form.scopeType === 'account' ||
      (form.scopeType === 'resource' ? !!form.scopeArn.trim() : !!form.scopeResourceId.trim())),
)
const resize = (size: number) => {
  records.pageSize.value = size
  void records.load(1)
}
const create = async () => {
  if (busy.value || !complete.value) return
  const body: CreateRamAuthorizationDto = {
    principalType: form.principalType,
    principalId: form.principalId.trim(),
    policyId: form.policyId.trim(),
    scopeType: form.scopeType,
    ...(form.scopeType === 'resource'
      ? { scopeArn: form.scopeArn.trim() }
      : form.scopeType === 'resource-group'
        ? { scopeResourceId: form.scopeResourceId.trim() }
        : {}),
  }
  busy.value = true
  try {
    await ramService.createAuthorization(body)
    await records.load(1)
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('RamManagement.scopedWriteFailed'))
  } finally {
    busy.value = false
  }
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
.scoped-form,
.scoped-toolbar {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 12px;
}
.scoped-form .el-form-item {
  min-width: 180px;
  flex: 1;
}
.scoped-toolbar .el-input {
  max-width: 360px;
}
code {
  overflow-wrap: anywhere;
}
</style>
