<template>
  <section class="ram-section">
    <div v-if="canReadUsers" class="section-toolbar">
      <div class="toolbar-left">
        <el-button v-if="canCreateUsers" type="primary" :icon="Plus" @click="openUserDialog()">
          {{ i18ns.t('RamManagement.createUser') }}
        </el-button>
        <el-button
          v-if="selectedUsers.length > 0 && canDeleteUsers"
          type="danger"
          :icon="Delete"
          @click="batchDeleteUsers"
        >
          {{ i18ns.t('RamManagement.batchDelete') }} ({{ selectedUsers.length }})
        </el-button>
        <el-button :icon="Refresh" @click="refreshUsers">{{ i18ns.t('refresh') }}</el-button>
      </div>
      <el-input
        v-model="userSearch"
        :prefix-icon="Search"
        :placeholder="i18ns.t('RamManagement.searchPlaceholder')"
        clearable
        style="width: 280px"
      />
    </div>

    <el-table
      v-if="canReadUsers"
      v-loading="loading.users"
      :data="filteredUsers"
      border
      stripe
      @selection-change="handleSelectionChange"
    >
      <el-table-column type="selection" width="55" />
      <el-table-column prop="username" :label="i18ns.t('username')" min-width="150" />
      <el-table-column
        prop="ramUsername"
        :label="i18ns.t('RamManagement.ramUsername')"
        min-width="150"
      />
      <el-table-column
        prop="displayName"
        :label="i18ns.t('RamManagement.displayName')"
        min-width="150"
      />
      <el-table-column prop="email" :label="i18ns.t('email')" min-width="180" />
      <el-table-column :label="i18ns.t('status')" width="110">
        <template #default="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'danger'" round effect="plain">
            {{
              row.status === 1 ? i18ns.t('RamManagement.active') : i18ns.t('RamManagement.disabled')
            }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('actions')" fixed="right" width="180">
        <template #default="{ row }">
          <el-button v-if="canUpdateUsers" link type="primary" @click="openUserDialog(row)">
            {{ i18ns.t('edit') }}
          </el-button>
          <el-button v-if="canDeleteUsers" link type="danger" @click="deleteUser(row)">
            {{ i18ns.t('delete') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-else :description="i18ns.t('message.error.forbidden')" />
  </section>
</template>

<script setup lang="ts">
import { Delete, Plus, Refresh, Search } from '@element-plus/icons-vue'
import type { RamUserDto } from '@/client/types.gen'
import { i18ns } from '@/locales'
import { useRamManagementContext } from '../context'

const {
  batchDeleteUsers,
  canCreateUsers,
  canDeleteUsers,
  canReadUsers,
  canUpdateUsers,
  deleteUser,
  filteredUsers,
  loading,
  loadGroups,
  loadUsers,
  openUserDialog,
  selectedUsers,
  userSearch,
} = useRamManagementContext()

const refreshUsers = () => void Promise.all([loadUsers(), loadGroups()])

const handleSelectionChange = (value: RamUserDto[]) => {
  selectedUsers.value = value
}
</script>
