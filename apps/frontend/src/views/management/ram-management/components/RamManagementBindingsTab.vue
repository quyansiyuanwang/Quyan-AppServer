<template>
  <el-tab-pane :label="i18ns.t('RamManagement.bindings')" name="bindings">
    <div v-if="canReadBindings" class="section-toolbar">
      <el-select
        v-model="selectedRoleId"
        filterable
        :placeholder="i18ns.t('RamManagement.selectRole')"
        style="width: 280px"
        @change="loadBindings"
      >
        <el-option v-for="role in roles" :key="role.id" :label="role.name" :value="role.id" />
      </el-select>
    </div>

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

    <el-empty v-else :description="i18ns.t('message.error.forbidden')" />
  </el-tab-pane>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useRamManagementContext } from '../context'

const {
  bindings,
  canDeleteBindings,
  canReadBindings,
  getBindingTargetName,
  loadBindings,
  loading,
  roles,
  selectedRoleId,
  unbind,
} = useRamManagementContext()
</script>
