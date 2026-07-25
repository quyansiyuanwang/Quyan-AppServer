<template>
  <div class="mobile-page">
    <div class="group-management-mobile">
      <el-card class="mobile-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('GroupManagement.title') }}</span>
            <div class="header-actions">
              <PermissionWrapper :require="[Permission.GROUP_CREATE]">
                <el-button type="primary" :icon="Plus" @click="handleCreate">
                  {{ i18ns.t('GroupManagement.createGroup') }}
                </el-button>
              </PermissionWrapper>
              <el-button :icon="Refresh" @click="handleRefresh">{{ i18ns.t('refresh') }}</el-button>
            </div>
          </div>
        </template>

        <div class="search-bar mobile-search-bar">
          <el-input
            v-model="keyword"
            :placeholder="i18ns.t('GroupManagement.searchKeyword')"
            clearable
            @keyup.enter="handleSearch"
            @clear="handleSearch"
          />
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px">
            <el-switch
              v-model="showRamGroups"
              :active-text="i18ns.t('GroupManagement.showRamGroups')"
              @change="handleSearch"
            />
          </div>
        </div>

        <el-skeleton :loading="loading" :rows="5" animated>
          <div v-if="groupList.length" class="group-list">
            <el-card
              v-for="row in groupList"
              :key="row.id"
              class="group-item mobile-card"
              shadow="never"
            >
              <div class="group-item-header">
                <div>
                  <div class="group-username">{{ row.username }}</div>
                  <div class="group-name">{{ row.name || '-' }}</div>
                </div>
                <el-tag size="small">{{ row.permissions?.length ?? 0 }}</el-tag>
              </div>

              <div class="meta">
                <div>{{ i18ns.t('GroupManagement.level') }}: {{ row.level }}</div>
                <div>
                  {{ i18ns.t('GroupManagement.description') }}: {{ row.description || '-' }}
                </div>
              </div>

              <div class="actions">
                <PermissionWrapper :require="[Permission.GROUP_UPDATE]" mode="disabled">
                  <el-button
                    plain
                    size="small"
                    type="primary"
                    :icon="Edit"
                    @click="handleEdit(row)"
                  >
                    {{ i18ns.t('edit') }}
                  </el-button>
                </PermissionWrapper>
                <PermissionWrapper
                  :any-require="[
                    Permission.GROUP_PERMISSION_ADD,
                    Permission.GROUP_PERMISSION_REMOVE,
                  ]"
                  mode="disabled"
                >
                  <el-button
                    plain
                    size="small"
                    type="primary"
                    :icon="Key"
                    @click="handleEditPermissions(row)"
                  >
                    {{ i18ns.t('GroupManagement.permissions') }}
                  </el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.GROUP_DELETE]" mode="disabled">
                  <el-button
                    plain
                    size="small"
                    type="danger"
                    :icon="Delete"
                    @click="handleDelete(row)"
                  >
                    {{ i18ns.t('delete') }}
                  </el-button>
                </PermissionWrapper>
              </div>
            </el-card>
          </div>
          <el-empty v-else />
        </el-skeleton>

        <div class="pagination-wrapper mobile-pagination">
          <el-pagination
            v-model:current-page="pagination.page"
            v-model:page-size="pagination.pageSize"
            :page-sizes="[10, 20, 50]"
            :total="displayTotal"
            layout="total, prev, pager, next"
            @current-change="handlePageChange"
            @size-change="handlePageSizeChange"
          />
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Delete, Edit, Key, Plus, Refresh } from '@element-plus/icons-vue'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import { i18ns } from '@/locales'
import { useGroupManagementContext } from '../context'

const {
  groupList,
  loading,
  keyword,
  showRamGroups,
  pagination,
  displayTotal,
  handleCreate,
  handleRefresh,
  handleSearch,
  handleEdit,
  handleEditPermissions,
  handleDelete,
  handlePageChange,
  handlePageSizeChange,
  Permission,
} = useGroupManagementContext()
</script>
