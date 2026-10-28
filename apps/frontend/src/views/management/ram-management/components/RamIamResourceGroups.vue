<template>
  <section class="scoped-section">
    <h3>{{ i18ns.t('RamManagement.scopedResourceGroups') }}</h3>
    <el-alert :title="i18ns.t('RamManagement.scopedGroupsHint')" type="info" :closable="false" />
    <div class="scoped-toolbar">
      <el-input
        v-model="name"
        data-test="resource-group-name"
        :disabled="busy"
        :maxlength="128"
        :placeholder="i18ns.t('RamManagement.scopedGroupName')"
      />
      <el-button
        data-test="resource-group-create"
        :disabled="busy || !name.trim()"
        @click="createGroup"
        >{{ i18ns.t('RamManagement.scopedCreateGroup') }}</el-button
      >
      <el-button
        data-test="resource-group-load"
        :disabled="busy || groups.loading.value"
        @click="groups.load(1)"
        >{{ i18ns.t('RamManagement.scopedLoad') }}</el-button
      >
    </div>
    <el-alert
      v-if="groups.failed.value"
      :title="i18ns.t('RamManagement.scopedLoadFailed')"
      type="error"
      :closable="false"
    />
    <el-table :data="groups.items.value" v-loading="groups.loading.value" row-key="id">
      <el-table-column prop="id" :label="i18ns.t('RamManagement.scopedGroupId')" min-width="180" />
      <el-table-column
        prop="name"
        :label="i18ns.t('RamManagement.scopedGroupName')"
        min-width="180"
      />
      <el-table-column :label="i18ns.t('RamManagement.scopedOperations')" min-width="260"
        ><template #default="{ row }">
          <el-button :disabled="busy" @click="selectGroup(row)">{{
            i18ns.t('RamManagement.scopedMembers')
          }}</el-button>
          <el-button :disabled="busy" @click="$emit('select', row.id)">{{
            i18ns.t('RamManagement.scopedUseGroup')
          }}</el-button>
        </template></el-table-column
      >
    </el-table>
    <RamIamPageControls
      :page="groups.page.value"
      :page-size="groups.pageSize.value"
      :has-next="groups.hasNext.value"
      :loading="groups.loading.value || busy"
      @previous="groups.previous"
      @next="groups.next"
      @size="resizeGroups"
    />
    <template v-if="selected">
      <h4>
        {{ i18ns.t('RamManagement.scopedMembers') }}: {{ selected.name }}
        <code>{{ selected.id }}</code>
      </h4>
      <div class="scoped-toolbar">
        <el-input
          v-model="resourceArn"
          data-test="resource-member-arn"
          :disabled="busy"
          :placeholder="i18ns.t('RamManagement.scopedResourceArn')"
        />
        <el-button
          data-test="resource-member-add"
          :disabled="busy || !resourceArn.trim()"
          @click="addMember"
          >{{ i18ns.t('RamManagement.scopedAddMember') }}</el-button
        >
        <el-button :disabled="busy || members.loading.value" @click="members.load(1)">{{
          i18ns.t('RamManagement.scopedLoad')
        }}</el-button>
      </div>
      <el-alert
        v-if="members.failed.value"
        :title="i18ns.t('RamManagement.scopedLoadFailed')"
        type="error"
        :closable="false"
      />
      <el-table :data="members.items.value" v-loading="members.loading.value" row-key="id">
        <el-table-column
          prop="resourceArn"
          :label="i18ns.t('RamManagement.scopedResourceArn')"
          min-width="360"
        />
        <el-table-column :label="i18ns.t('RamManagement.scopedOperations')" width="120"
          ><template #default="{ row }"
            ><el-button type="danger" :disabled="busy" @click="removeMember(row.id)">{{
              i18ns.t('RamManagement.scopedRemoveMember')
            }}</el-button></template
          ></el-table-column
        >
      </el-table>
      <RamIamPageControls
        :page="members.page.value"
        :page-size="members.pageSize.value"
        :has-next="members.hasNext.value"
        :loading="members.loading.value || busy"
        @previous="members.previous"
        @next="members.next"
        @size="resizeMembers"
      />
    </template>
    <p>{{ i18ns.t('RamManagement.scopedPageHint') }}</p>
  </section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { IamResourceGroupSummary } from '@quyan/shared'
import { ramService } from '@/service/ramService'
import { i18ns } from '@/locales'
import { ElMessageBox } from '@/utils/elementPlusRuntime'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import { useIamManagementPage } from '../useIamManagementPage'
import RamIamPageControls from './RamIamPageControls.vue'
defineEmits<{ select: [groupId: string] }>()
const busy = ref(false)
const name = ref('')
const resourceArn = ref('')
const selected = shallowRef<IamResourceGroupSummary>()
const groups = useIamManagementPage((query) => ramService.listResourceGroupPage(query))
const members = useIamManagementPage((query) => {
  if (!selected.value) return Promise.reject(new Error('No selected resource group'))
  return ramService.listResourceGroupMemberPage(selected.value.id, query)
})
const resizeGroups = (size: number) => {
  groups.pageSize.value = size
  void groups.load(1)
}
const resizeMembers = (size: number) => {
  members.pageSize.value = size
  void members.load(1)
}
const selectGroup = (group: IamResourceGroupSummary) => {
  if (busy.value) return
  selected.value = group
  resourceArn.value = ''
  members.clear()
  void members.load(1)
}
const createGroup = async () => {
  if (busy.value || !name.value.trim()) return
  busy.value = true
  try {
    const group = await ramService.createResourceGroup({ name: name.value.trim() })
    name.value = ''
    await groups.load(1)
    selectCreatedGroup(group)
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('RamManagement.scopedWriteFailed'))
  } finally {
    busy.value = false
  }
}
const selectCreatedGroup = (group: IamResourceGroupSummary) => {
  selected.value = group
  resourceArn.value = ''
  members.clear()
  void members.load(1)
}
const addMember = async () => {
  if (busy.value || !selected.value || !resourceArn.value.trim()) return
  const groupId = selected.value.id
  busy.value = true
  try {
    await ramService.addResourceGroupMember(groupId, resourceArn.value.trim())
    resourceArn.value = ''
    await members.load(1)
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('RamManagement.scopedWriteFailed'))
  } finally {
    busy.value = false
  }
}
const removeMember = async (memberId: string) => {
  if (busy.value || !selected.value) return
  const groupId = selected.value.id
  try {
    await ElMessageBox.confirm(
      i18ns.t('RamManagement.scopedRemoveMemberConfirm'),
      i18ns.t('RamManagement.scopedRemoveMember'),
      { type: 'warning' },
    )
  } catch {
    return
  }
  if (busy.value || selected.value?.id !== groupId) return
  busy.value = true
  try {
    await ramService.removeResourceGroupMember(groupId, memberId)
    await members.load()
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('RamManagement.scopedWriteFailed'))
  } finally {
    busy.value = false
  }
}
onMounted(() => void groups.load())
onBeforeUnmount(() => {
  groups.clear()
  members.clear()
})
</script>
<style scoped>
.scoped-section {
  display: grid;
  gap: 12px;
  margin-bottom: 24px;
}
.scoped-toolbar {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.scoped-toolbar .el-input {
  max-width: 480px;
  flex: 1;
  min-width: 240px;
}
code {
  overflow-wrap: anywhere;
}
</style>
