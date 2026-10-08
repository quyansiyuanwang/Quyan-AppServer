<template>
  <section class="ram-section">
    <RamIamResourceGroups @select="selectedResourceGroup = { id: $event }" />
    <RamIamScopedAuthorizations :selected-resource-group="selectedResourceGroup" />
    <el-divider />
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

    <el-alert
      v-if="canReadUsers && userPage.failed.value"
      :title="i18ns.t('RamManagement.scopedLoadFailed')"
      type="error"
      :closable="false"
    />
    <RamIamPageControls
      v-if="canReadUsers"
      :page="userPage.page.value"
      :page-size="userPage.pageSize.value"
      :has-next="userPage.hasNext.value"
      :loading="userPage.loading.value"
      @previous="loadUsers(userPage.page.value - 1)"
      @next="loadUsers(userPage.page.value + 1)"
      @size="resizeUsersPage"
    />
    <div v-if="authUserId && effectivePerms" class="auth-summary">
      <el-alert
        v-if="effectivePerms.authorizationMode === 'enforce'"
        :title="i18ns.t('RamManagement.effectiveIamProjectionHint')"
        type="info"
        :closable="false"
      />
      <el-descriptions :column="1" border>
        <el-descriptions-item :label="i18ns.t('username')">
          {{ effectivePerms.ramUsername }}
        </el-descriptions-item>
        <el-descriptions-item
          :label="
            i18ns.t('RamManagement.totalEffective', {
              count: effectivePerms.effectivePermissions.length,
            })
          "
        >
          <el-tag
            v-for="perm in effectivePerms.effectivePermissions"
            :key="perm"
            round
            style="margin: 2px"
          >
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
  </section>
</template>

<script setup lang="ts">
import RamIamPageControls from './RamIamPageControls.vue'
import { ref } from 'vue'
import RamIamResourceGroups from './RamIamResourceGroups.vue'
import RamIamScopedAuthorizations from './RamIamScopedAuthorizations.vue'
import { i18ns } from '@/locales'
import { useRamManagementContext } from '../context'

const selectedResourceGroup = ref<{ id: string }>()

const {
  Refresh,
  authUserId,
  effectivePerms,
  getPermLabel,
  getPermTooltip,
  loadEffectivePermissions,
  permissionBreakdownSource,
  users,
  userPage,
  canReadUsers,
  loadUsers,
  resizeUsersPage,
} = useRamManagementContext()
</script>
