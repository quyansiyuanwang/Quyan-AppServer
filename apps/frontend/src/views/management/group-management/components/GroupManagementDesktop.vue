<template>
  <div class="desktop-page">
    <div class="group-management">
      <el-card class="page-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('GroupManagement.title') }}</span>
            <div>
              <PermissionWrapper :require="[Permission.GROUP_CREATE]">
                <el-button type="primary" :icon="Plus" @click="handleCreate">
                  {{ i18ns.t('GroupManagement.createGroup') }}
                </el-button>
              </PermissionWrapper>
              <el-button :icon="Refresh" @click="handleRefresh">{{ i18ns.t('refresh') }}</el-button>
            </div>
          </div>
        </template>

        <div class="search-bar">
          <el-row :gutter="12" align="middle">
            <el-col :span="8">
              <el-input
                v-model="keyword"
                :placeholder="i18ns.t('GroupManagement.searchKeyword')"
                clearable
                @keyup.enter="handleSearch"
                @clear="handleSearch"
              />
            </el-col>
            <el-col :span="6">
              <el-switch
                v-model="showRamGroups"
                :active-text="i18ns.t('GroupManagement.showRamGroups')"
                @change="handleSearch"
              />
            </el-col>
          </el-row>
        </div>

        <el-table v-loading="loading" :data="groupList" stripe border>
          <template #empty>
            <el-empty :description="i18ns.t('noData')" />
          </template>
          <el-table-column
            prop="username"
            :label="i18ns.t('GroupManagement.username')"
            min-width="120"
          />
          <el-table-column prop="name" :label="i18ns.t('GroupManagement.name')" min-width="120" />
          <el-table-column
            prop="level"
            :label="i18ns.t('GroupManagement.level')"
            min-width="80"
            class-name="hide-on-mobile"
          />
          <el-table-column
            prop="description"
            :label="i18ns.t('GroupManagement.description')"
            min-width="180"
            class-name="hide-on-mobile"
          />
          <el-table-column :label="i18ns.t('GroupManagement.permissionCount')" min-width="100">
            <template #default="{ row }">
              <el-tag>{{ row.permissions?.length ?? 0 }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('actions')" fixed="right" width="220">
            <template #default="{ row }">
              <PermissionWrapper :require="[Permission.GROUP_UPDATE]" mode="disabled">
                <el-button link type="primary" @click="handleEdit(row)">{{
                  i18ns.t('edit')
                }}</el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.GROUP_PERMISSION_ADD]" mode="disabled">
                <el-button link type="primary" @click="handleEditPermissions(row)">
                  {{ i18ns.t('GroupManagement.permissions') }}
                </el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.GROUP_DELETE]" mode="disabled">
                <el-button link type="danger" @click="handleDelete(row)">{{
                  i18ns.t('delete')
                }}</el-button>
              </PermissionWrapper>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-wrapper desktop-pagination">
          <el-pagination
            v-model:current-page="pagination.page"
            v-model:page-size="pagination.pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="displayTotal"
            layout="total, sizes, prev, pager, next, jumper"
            @current-change="handlePageChange"
            @size-change="handlePageSizeChange"
          />
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus, Refresh } from '@element-plus/icons-vue'
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
