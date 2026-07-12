<template>
  <el-dialog
    v-model="permDialogVisible"
    :title="i18ns.t('GroupManagement.editPermissions')"
    :width="isDesktop ? '760px' : '96%'"
    :close-on-click-modal="false"
  >
    <div class="perm-dialog-toolbar">
      <div class="perm-stats">
        <span class="perm-stat-selected">{{ selectedPermissions.length }}</span>
        <span class="perm-stat-sep">/</span>
        <span class="perm-stat-total">{{ ALL_PERMISSIONS.length }}</span>
        <span v-if="isDesktop" class="perm-stat-label">{{
          i18ns.t('GroupManagement.permSelected')
        }}</span>
      </div>
      <el-input
        v-model="permSearch"
        :placeholder="i18ns.t('GroupManagement.permSearch')"
        clearable
        size="small"
        :style="isDesktop ? 'width: 220px' : undefined"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <div class="perm-global-actions">
        <el-button size="small" @click="selectAllPermissions">
          {{ i18ns.t('GroupManagement.permSelectAll') }}
        </el-button>
        <el-button size="small" @click="clearAllPermissions">
          {{ i18ns.t('GroupManagement.permClearAll') }}
        </el-button>
      </div>
    </div>

    <div class="perm-categories">
      <div
        v-for="category in filteredPermissionCategories"
        :key="category.name"
        class="perm-category"
      >
        <div class="perm-category-header">
          <div class="perm-category-title">
            <span :class="isDesktop ? 'perm-category-name' : undefined">{{ category.name }}</span>
            <el-tag size="small" type="info" effect="plain">
              {{ getCategorySelectedCount(category) }}/{{ category.permissions.length }}
            </el-tag>
          </div>
          <div class="perm-category-actions">
            <el-button link size="small" type="primary" @click="selectCategory(category)">
              {{ i18ns.t('GroupManagement.permSelectAllCategory') }}
            </el-button>
            <el-button link size="small" type="danger" @click="clearCategory(category)">
              {{ i18ns.t('GroupManagement.permClearCategory') }}
            </el-button>
          </div>
        </div>
        <div class="perm-items">
          <div
            v-for="permission in category.permissions"
            :key="permission"
            class="perm-item"
            :class="{ 'is-selected': selectedPermissions.includes(permission) }"
            @click="togglePermission(permission)"
          >
            <el-icon class="perm-check-icon">
              <Check v-if="selectedPermissions.includes(permission)" />
              <Plus v-else />
            </el-icon>
            <div class="perm-item-content">
              <span class="perm-display-name">{{ getPermissionDisplayName(permission) }}</span>
              <span class="perm-value">{{ permission }}</span>
            </div>
          </div>
        </div>
      </div>
      <div v-if="filteredPermissionCategories.length === 0" class="perm-empty">
        <el-empty
          :description="i18ns.t('PermissionSelector.noMatchingPermissions')"
          :image-size="60"
        />
      </div>
    </div>

    <template #footer>
      <el-button @click="permDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button type="primary" :loading="permSaving" @click="handleSavePermissions">
        {{ i18ns.t('save') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { Check, Plus, Search } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { useGroupManagementContext } from '../context'

const {
  isDesktop,
  permDialogVisible,
  permSaving,
  selectedPermissions,
  permSearch,
  filteredPermissionCategories,
  getCategorySelectedCount,
  togglePermission,
  selectAllPermissions,
  clearAllPermissions,
  selectCategory,
  clearCategory,
  getPermissionDisplayName,
  handleSavePermissions,
  ALL_PERMISSIONS,
} = useGroupManagementContext()
</script>
