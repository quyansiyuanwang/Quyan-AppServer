<template>
  <section class="ram-section">
    <div v-if="canReadBindings" class="section-toolbar">
      <el-select
        v-model="selectedRoleId"
        filterable
        :placeholder="i18ns.t('RamManagement.selectRole')"
        style="width: 280px"
        @change="changeBindingRole"
      >
        <el-option v-for="role in roles" :key="role.id" :label="role.name" :value="role.id" />
      </el-select>
      <el-button :icon="Refresh" @click="refreshBindings">{{ i18ns.t('refresh') }}</el-button>
    </div>

    <el-alert
      v-if="canReadBindings && rolePage.failed.value"
      :title="i18ns.t('RamManagement.scopedLoadFailed')"
      type="error"
      :closable="false"
    />
    <RamIamPageControls
      v-if="canReadBindings"
      :page="rolePage.page.value"
      :page-size="rolePage.pageSize.value"
      :has-next="rolePage.hasNext.value"
      :loading="rolePage.loading.value"
      @previous="loadRoles(rolePage.page.value - 1)"
      @next="loadRoles(rolePage.page.value + 1)"
      @size="resizeRolesPage"
    />
    <el-table v-if="canReadBindings" v-loading="loading.bindings" :data="bindings" border stripe>
      <el-table-column prop="roleName" :label="i18ns.t('RamManagement.roleName')" min-width="150" />
      <el-table-column :label="i18ns.t('RamManagement.bindingType')" width="120">
        <template #default="{ row }">
          {{
            row.source === 'user' ? i18ns.t('RamManagement.user') : i18ns.t('RamManagement.group')
          }}
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('RamManagement.bindingTarget')" min-width="180">
        <template #default="{ row }">{{ getBindingTargetName(row) }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('RamManagement.permissionCount')" width="130">
        <template #default="{ row }">
          <el-tooltip :content="(row.permissions ?? []).join(', ') || '-'" placement="top">
            <el-tag round type="info">{{ row.permissions?.length ?? 0 }}</el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('actions')" fixed="right" width="120">
        <template #default="{ row }">
          <el-button v-if="canDeleteBindings" link type="danger" @click="unbind(row)">
            {{ i18ns.t('delete') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-alert
      v-if="canReadBindings && bindingPage.failed.value"
      :title="i18ns.t('RamManagement.scopedLoadFailed')"
      type="error"
      :closable="false"
    />
    <RamIamPageControls
      v-if="canReadBindings"
      :page="bindingPage.page.value"
      :page-size="bindingPage.pageSize.value"
      :has-next="bindingPage.hasNext.value"
      :loading="bindingPage.loading.value"
      @previous="loadBindings(bindingPage.page.value - 1)"
      @next="loadBindings(bindingPage.page.value + 1)"
      @size="resizeBindingsPage"
    />
    <el-empty v-if="!canReadBindings" :description="i18ns.t('message.error.forbidden')" />
  </section>
</template>

<script setup lang="ts">
import RamIamPageControls from './RamIamPageControls.vue'
import { Refresh } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { useRamManagementContext } from '../context'

const {
  bindings,
  canDeleteBindings,
  canReadBindings,
  getBindingTargetName,
  loadBindings,
  bindingPage,
  resizeBindingsPage,
  changeBindingRole,
  loadGroups,
  loadRoles,
  rolePage,
  resizeRolesPage,
  loadUsers,
  loading,
  roles,
  selectedRoleId,
  unbind,
} = useRamManagementContext()

const refreshBindings = async () => {
  await Promise.all([loadRoles(), loadUsers(), loadGroups()])
}
</script>
