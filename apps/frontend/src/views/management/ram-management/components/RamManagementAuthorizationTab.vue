<template>
  <el-tab-pane :label="i18ns.t('RamManagement.authorization')" name="authorization">
    <div class="section-toolbar">
      <el-select
        v-model="authUserId"
        filterable
        :placeholder="i18ns.t('RamManagement.selectUser')"
        style="width: 320px"
        @change="loadEffectivePermissions"
      >
        <el-option
          v-for="user in users"
          :key="user.id"
          :label="user.displayName || user.ramUsername || user.username"
          :value="user.id"
        />
      </el-select>
      <el-button :icon="Refresh" @click="authUserId && loadEffectivePermissions()">
        {{ i18ns.t('refresh') }}
      </el-button>
    </div>

    <div v-if="authUserId && effectivePerms" class="auth-summary">
      <el-descriptions :column="1" border>
        <el-descriptions-item :label="i18ns.t('username')">
          {{ effectivePerms.ramUsername }}
        </el-descriptions-item>
        <el-descriptions-item
          :label="i18ns.t('RamManagement.totalEffective', { count: effectivePerms.effectivePermissions.length })"
        >
          <el-tag v-for="perm in effectivePerms.effectivePermissions" :key="perm" round style="margin: 2px">
            <el-tooltip :content="getPermTooltip(perm)" placement="top" :show-after="300">
              <span>{{ getPermLabel(perm) }}</span>
              <code class="perm-source">{{ perm }}</code>
            </el-tooltip>
          </el-tag>
          <el-empty v-if="effectivePerms.effectivePermissions.length === 0" />
        </el-descriptions-item>
      </el-descriptions>

      <el-divider />

      <el-table :data="permissionBreakdownSource" border stripe>
        <el-table-column
          :label="i18ns.t('RamManagement.permissionSource')"
          width="160"
          prop="source"
        />
        <el-table-column :label="i18ns.t('RamManagement.permissions')" min-width="400">
          <template #default="{ row }">
            <el-tag v-for="perm in row.permissions" :key="perm" round style="margin: 2px">
              <el-tooltip :content="getPermTooltip(perm)" placement="top" :show-after="300">
                <span>{{ getPermLabel(perm) }}</span>
                <code class="perm-source">{{ perm }}</code>
              </el-tooltip>
            </el-tag>
            <span v-if="row.permissions.length === 0" class="text-secondary">-</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-empty v-else-if="!authUserId" :description="i18ns.t('RamManagement.selectUser')" />
  </el-tab-pane>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useRamManagementContext } from '../context'

const {
  Refresh,
  authUserId,
  effectivePerms,
  getPermLabel,
  getPermTooltip,
  loadEffectivePermissions,
  permissionBreakdownSource,
  users,
} = useRamManagementContext()
</script>
