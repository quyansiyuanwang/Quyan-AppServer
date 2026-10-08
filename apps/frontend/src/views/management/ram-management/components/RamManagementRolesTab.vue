<template>
  <section class="ram-section">
    <div v-if="canReadRoles" class="section-toolbar">
      <div class="toolbar-left">
        <el-button v-if="canCreateRoles" type="primary" :icon="Plus" @click="openRoleDialog()">
          {{ i18ns.t('RamManagement.createRole') }}
        </el-button>
        <el-button
          v-if="selectedRoles.length > 0 && canDeleteRoles"
          type="danger"
          :icon="Delete"
          @click="batchDeleteRoles"
        >
          {{ i18ns.t('RamManagement.batchDelete') }} ({{ selectedRoles.length }})
        </el-button>
        <el-button :icon="Refresh" @click="refreshRoles">{{ i18ns.t('refresh') }}</el-button>
      </div>
      <el-input
        v-model="roleSearch"
        :prefix-icon="Search"
        :placeholder="i18ns.t('RamManagement.pageSearchPlaceholder')"
        clearable
        style="width: 280px"
      />
    </div>

    <el-table
      v-if="canReadRoles"
      v-loading="loading.roles"
      :data="filteredRoles"
      border
      stripe
      @current-change="selectRole"
      @selection-change="handleSelectionChange"
    >
      <el-table-column type="selection" width="55" />
      <el-table-column prop="name" :label="i18ns.t('RamManagement.roleName')" min-width="160" />
      <el-table-column
        prop="description"
        :label="i18ns.t('description')"
        min-width="220"
        show-overflow-tooltip
      />
      <el-table-column :label="i18ns.t('RamManagement.permissionCount')" width="130">
        <template #default="{ row }">
          <el-tag round type="info">{{ row.permissions?.length ?? 0 }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column
        prop="maxSessionDuration"
        :label="i18ns.t('RamManagement.maxSessionDuration')"
        width="150"
      />
      <el-table-column :label="i18ns.t('actions')" fixed="right" width="340">
        <template #default="{ row }">
          <el-button v-if="canCreateRoles" link type="info" @click="cloneRole(row)">
            {{ i18ns.t('RamManagement.clone') }}
          </el-button>
          <el-button v-if="canUpdateRoles" link type="primary" @click="openRoleDialog(row)">
            {{ i18ns.t('edit') }}
          </el-button>
          <el-button
            v-if="canCreateBindings"
            link
            type="primary"
            @click="openBindDialog(row, 'user')"
          >
            {{ i18ns.t('RamManagement.bindUser') }}
          </el-button>
          <el-button
            v-if="canCreateBindings"
            link
            type="primary"
            @click="openBindDialog(row, 'group')"
          >
            {{ i18ns.t('RamManagement.bindGroup') }}
          </el-button>
          <el-button link type="primary" @click="trustRole = row">{{
            i18ns.t('RamManagement.trustEditorTitle')
          }}</el-button>
          <el-button v-if="canDeleteRoles" link type="danger" @click="deleteRole(row)">
            {{ i18ns.t('delete') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-alert
      v-if="canReadRoles && rolePage.failed.value"
      :title="i18ns.t('RamManagement.scopedLoadFailed')"
      type="error"
      :closable="false"
    />
    <RamIamPageControls
      v-if="canReadRoles"
      :page="rolePage.page.value"
      :page-size="rolePage.pageSize.value"
      :has-next="rolePage.hasNext.value"
      :loading="rolePage.loading.value"
      @previous="loadRoles(rolePage.page.value - 1)"
      @next="loadRoles(rolePage.page.value + 1)"
      @size="resizeRolesPage"
    />
    <p v-if="canReadRoles">{{ i18ns.t('RamManagement.scopedPageHint') }}</p>

    <RamIamRoleTrustEditor :role="trustRole" @close="trustRole = null" @saved="loadRoles()" />
    <el-empty v-if="!canReadRoles" :description="i18ns.t('message.error.forbidden')" />
  </section>
</template>

<script setup lang="ts">
import { shallowRef } from 'vue'
import RamIamPageControls from './RamIamPageControls.vue'
import RamIamRoleTrustEditor from './RamIamRoleTrustEditor.vue'
import { Delete, Plus, Refresh, Search } from '@element-plus/icons-vue'
import type { RamRoleDto } from '@/client/types.gen'
import { i18ns } from '@/locales'
import { useRamManagementContext } from '../context'

const {
  batchDeleteRoles,
  canCreateBindings,
  canCreateRoles,
  canDeleteRoles,
  canReadRoles,
  canUpdateRoles,
  cloneRole,
  deleteRole,
  filteredRoles,
  loading,
  loadGroups,
  loadRoles,
  rolePage,
  resizeRolesPage,
  loadUsers,
  openBindDialog,
  openRoleDialog,
  roleSearch,
  selectRole,
  selectedRoles,
} = useRamManagementContext()

const trustRole = shallowRef<RamRoleDto | null>(null)

const refreshRoles = () => void Promise.all([loadRoles(), loadUsers(), loadGroups()])

const handleSelectionChange = (value: RamRoleDto[]) => {
  selectedRoles.value = value
}
</script>
