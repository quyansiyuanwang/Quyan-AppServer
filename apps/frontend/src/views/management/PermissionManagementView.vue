<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="permission-management">
      <el-card class="page-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('PermissionManagement.title') }}</span>
            <el-button type="primary" @click="handleRefresh" :icon="Refresh">{{
              i18ns.t('refresh')
            }}</el-button>
          </div>
        </template>

        <!-- 搜索栏 -->
        <div class="search-bar">
          <el-row :gutter="12" align="middle">
            <el-col :span="8">
              <el-input
                v-model="keyword"
                :placeholder="i18ns.t('PermissionManagement.searchKeyword')"
                clearable
                @keyup.enter="handleSearch"
                @clear="handleSearch"
              />
            </el-col>
            <el-col :span="6">
              <el-select
                v-model="searchGroupId"
                :placeholder="i18ns.t('PermissionManagement.filterGroup')"
                clearable
                style="width: 100%"
                @change="handleSearch"
              >
                <el-option
                  v-for="g in groups"
                  :key="g.id"
                  :label="g.name || g.username"
                  :value="g.id"
                />
              </el-select>
            </el-col>
            <el-col :span="6">
              <el-switch
                v-model="showRamUsers"
                :active-text="i18ns.t('PermissionManagement.showRamUsers')"
                @change="handleSearch"
              />
            </el-col>
          </el-row>
        </div>

        <!-- 用户列表 -->
        <el-table v-loading="loading" :data="userList" stripe border>
          <template #empty>
            <el-empty :description="i18ns.t('noData')" />
          </template>
          <el-table-column prop="username" :label="i18ns.t('username')" min-width="120" />
          <el-table-column
            prop="name"
            :label="i18ns.t('PermissionManagement.name')"
            min-width="120"
          />
          <el-table-column
            prop="groupName"
            :label="i18ns.t('PermissionManagement.groupName')"
            min-width="120"
            class-name="hide-on-mobile"
          >
            <template #default="{ row }">
              <el-tag size="small">{{ row.groupName || row.groupId }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('actions')" fixed="right" width="200">
            <template #default="{ row }">
              <el-button link type="primary" @click="handleViewPermissions(row)">
                {{ i18ns.t('PermissionManagement.viewPermissions') }}
              </el-button>
              <PermissionWrapper
                :any-require="[Permission.PERMISSION_ADD, Permission.PERMISSION_REMOVE]"
                mode="disabled"
              >
                <el-button link type="primary" @click="handleEditPermissions(row)">
                  {{ i18ns.t('edit') }}
                </el-button>
              </PermissionWrapper>
            </template>
          </el-table-column>
        </el-table>

        <!-- 分页 -->
        <div class="pagination-wrapper desktop-pagination">
          <el-pagination
            v-model:current-page="pagination.page"
            v-model:page-size="pagination.pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="pagination.total"
            layout="total, sizes, prev, pager, next, jumper"
            @size-change="handlePageSizeChange"
            @current-change="handlePageChange"
          />
        </div>
      </el-card>

      <!-- 查看权限对话框 -->
      <el-dialog
        v-model="viewDialogVisible"
        :title="i18ns.t('PermissionManagement.userPermissionDetail')"
        width="800px"
        :close-on-click-modal="false"
      >
        <div v-if="selectedUserPermissions" v-loading="permissionLoading">
          <!-- 权限概览卡片 -->
          <div class="permission-summary-cards">
            <div class="summary-card summary-card--effective">
              <div class="summary-card__value">
                {{ selectedUserPermissions.effectivePermissions.length }}
              </div>
              <div class="summary-card__label">
                {{ i18ns.t('PermissionManagement.effectivePermissions') }}
              </div>
            </div>
            <div class="summary-card summary-card--group">
              <div class="summary-card__value">
                {{ selectedUserPermissions.groupPermissions.length }}
              </div>
              <div class="summary-card__label">
                {{ i18ns.t('PermissionManagement.groupPermissions') }}
              </div>
            </div>
            <div class="summary-card summary-card--added">
              <div class="summary-card__value">
                {{ selectedUserPermissions.additionalPermissions.length }}
              </div>
              <div class="summary-card__label">
                {{ i18ns.t('PermissionManagement.additionalPermissions') }}
              </div>
            </div>
            <div class="summary-card summary-card--removed">
              <div class="summary-card__value">
                {{ selectedUserPermissions.removedPermissions.length }}
              </div>
              <div class="summary-card__label">
                {{ i18ns.t('PermissionManagement.removedPermissions') }}
              </div>
            </div>
          </div>

          <el-tabs>
            <el-tab-pane>
              <template #label>
                <span>
                  {{ i18ns.t('PermissionManagement.effectivePermissions') }}
                  <el-badge
                    :value="selectedUserPermissions.effectivePermissions.length"
                    type="success"
                    class="tab-badge"
                  />
                </span>
              </template>
              <PermissionList :permissions="selectedUserPermissions.effectivePermissions" />
            </el-tab-pane>
            <el-tab-pane>
              <template #label>
                <span>
                  {{ i18ns.t('PermissionManagement.groupPermissions') }}
                  <el-badge
                    :value="selectedUserPermissions.groupPermissions.length"
                    type="primary"
                    class="tab-badge"
                  />
                </span>
              </template>
              <PermissionList
                :permissions="selectedUserPermissions.groupPermissions"
                tag-type="primary"
              />
            </el-tab-pane>
            <el-tab-pane>
              <template #label>
                <span>
                  {{ i18ns.t('PermissionManagement.additionalPermissions') }}
                  <el-badge
                    :value="selectedUserPermissions.additionalPermissions.length"
                    type="warning"
                    class="tab-badge"
                  />
                </span>
              </template>
              <PermissionList
                :permissions="selectedUserPermissions.additionalPermissions"
                tag-type="warning"
              />
            </el-tab-pane>
            <el-tab-pane>
              <template #label>
                <span>
                  {{ i18ns.t('PermissionManagement.removedPermissions') }}
                  <el-badge
                    :value="selectedUserPermissions.removedPermissions.length"
                    type="danger"
                    class="tab-badge"
                  />
                </span>
              </template>
              <PermissionList
                :permissions="selectedUserPermissions.removedPermissions"
                tag-type="danger"
              />
            </el-tab-pane>
          </el-tabs>
        </div>
      </el-dialog>

      <!-- 编辑权限对话框 -->
      <UserPermissionDialog
        v-model="editDialogVisible"
        :user="selectedUser"
        :user-permissions="selectedUserPermissions"
        @success="handleEditSuccess"
      />
    </div>
  </div>
  <div v-else class="mobile-page">
    <div class="permission-management-mobile">
      <el-card class="mobile-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('PermissionManagement.title') }}</span>
            <el-button type="primary" :icon="Refresh" @click="handleRefresh">{{
              i18ns.t('refresh')
            }}</el-button>
          </div>
        </template>

        <div class="search-bar mobile-search-bar">
          <el-input
            v-model="keyword"
            :placeholder="i18ns.t('PermissionManagement.searchKeyword')"
            clearable
            @keyup.enter="handleSearch"
            @clear="handleSearch"
          />
          <div style="display: flex; gap: 8px; margin-top: 8px">
            <el-select
              v-model="searchGroupId"
              :placeholder="i18ns.t('PermissionManagement.filterGroup')"
              clearable
              style="flex: 1"
              @change="handleSearch"
            >
              <el-option
                v-for="g in groups"
                :key="g.id"
                :label="g.name || g.username"
                :value="g.id"
              />
            </el-select>
            <el-switch
              v-model="showRamUsers"
              :active-text="i18ns.t('PermissionManagement.showRamUsers')"
              @change="handleSearch"
            />
          </div>
        </div>

        <el-skeleton :loading="loading" :rows="5" animated>
          <div v-if="userList.length" class="user-list">
            <el-card
              v-for="row in userList"
              :key="row.id"
              class="user-item mobile-card"
              shadow="never"
            >
              <div class="item-header">
                <div>
                  <div class="username">{{ row.username }}</div>
                  <div class="secondary">{{ row.name || '-' }}</div>
                </div>
                <el-tag size="small">{{ row.groupName || row.groupId || '-' }}</el-tag>
              </div>

              <div class="actions">
                <el-button
                  plain
                  size="small"
                  type="primary"
                  :icon="View"
                  @click="handleViewPermissions(row)"
                >
                  {{ i18ns.t('button.viewDetails') }}
                </el-button>
                <PermissionWrapper
                  :any-require="[Permission.PERMISSION_ADD, Permission.PERMISSION_REMOVE]"
                  mode="disabled"
                >
                  <el-button
                    plain
                    size="small"
                    type="primary"
                    :icon="Edit"
                    @click="handleEditPermissions(row)"
                  >
                    {{ i18ns.t('edit') }}
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
            :page-sizes="[10, 20, 50, 100]"
            :total="pagination.total"
            layout="total, prev, pager, next"
            @size-change="handlePageSizeChange"
            @current-change="handlePageChange"
          />
        </div>
      </el-card>

      <el-dialog
        v-model="viewDialogVisible"
        :title="i18ns.t('PermissionManagement.userPermissionDetail')"
        width="96%"
        :close-on-click-modal="false"
      >
        <div v-if="selectedUserPermissions" v-loading="permissionLoading">
          <div class="permission-summary-cards">
            <div class="summary-card summary-card--effective">
              <div class="summary-card__value">
                {{ selectedUserPermissions.effectivePermissions.length }}
              </div>
              <div class="summary-card__label">
                {{ i18ns.t('PermissionManagement.effectivePermissions') }}
              </div>
            </div>
            <div class="summary-card summary-card--group">
              <div class="summary-card__value">
                {{ selectedUserPermissions.groupPermissions.length }}
              </div>
              <div class="summary-card__label">
                {{ i18ns.t('PermissionManagement.groupPermissions') }}
              </div>
            </div>
            <div class="summary-card summary-card--added">
              <div class="summary-card__value">
                {{ selectedUserPermissions.additionalPermissions.length }}
              </div>
              <div class="summary-card__label">
                {{ i18ns.t('PermissionManagement.additionalPermissions') }}
              </div>
            </div>
            <div class="summary-card summary-card--removed">
              <div class="summary-card__value">
                {{ selectedUserPermissions.removedPermissions.length }}
              </div>
              <div class="summary-card__label">
                {{ i18ns.t('PermissionManagement.removedPermissions') }}
              </div>
            </div>
          </div>

          <el-tabs>
            <el-tab-pane>
              <template #label>{{ i18ns.t('PermissionManagement.effectivePermissions') }}</template>
              <PermissionList :permissions="selectedUserPermissions.effectivePermissions" />
            </el-tab-pane>
            <el-tab-pane>
              <template #label>{{ i18ns.t('PermissionManagement.groupPermissions') }}</template>
              <PermissionList
                :permissions="selectedUserPermissions.groupPermissions"
                tag-type="primary"
              />
            </el-tab-pane>
            <el-tab-pane>
              <template #label>{{
                i18ns.t('PermissionManagement.additionalPermissions')
              }}</template>
              <PermissionList
                :permissions="selectedUserPermissions.additionalPermissions"
                tag-type="warning"
              />
            </el-tab-pane>
            <el-tab-pane>
              <template #label>{{ i18ns.t('PermissionManagement.removedPermissions') }}</template>
              <PermissionList
                :permissions="selectedUserPermissions.removedPermissions"
                tag-type="danger"
              />
            </el-tab-pane>
          </el-tabs>
        </div>
      </el-dialog>

      <UserPermissionDialog
        v-model="editDialogVisible"
        :user="selectedUser"
        :user-permissions="selectedUserPermissions"
        @success="handleEditSuccess"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { ref, onMounted } from 'vue'
import { i18ns } from '@/locales'
import { ElMessage } from 'element-plus'
import { Refresh, View, Edit } from '@element-plus/icons-vue'
import type { UserDto, UserFullPermissionsDto } from '@/client/types.gen'
import { usePermissionStore } from '@/stores/permissionStore'
import UserPermissionDialog from '@/components/permission/UserPermissionDialog.vue'
import PermissionList from '@/components/permission/PermissionList.vue'
import { userService } from '@/service/userService'
import { groupService } from '@/service/groupService'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import { Permission } from '@/constant/permission'

const userList = ref<UserDto[]>([])
const groups = ref<Array<{ id: string; name?: string | null; username: string }>>([])
const loading = ref(false)
const permissionLoading = ref(false)

const keyword = ref('')
const searchGroupId = ref('')
const showRamUsers = ref(false)

const pagination = ref({
  page: 1,
  pageSize: 10,
  total: 0,
})

const viewDialogVisible = ref(false)
const editDialogVisible = ref(false)
const selectedUser = ref<UserDto | null>(null)
const selectedUserPermissions = ref<UserFullPermissionsDto | null>(null)

const permissionStore = usePermissionStore()

const loadUserList = async () => {
  loading.value = true
  try {
    const response = await userService.getAllUsers({
      page: pagination.value.page,
      pageSize: pagination.value.pageSize,
      excludeCurrentUser: true,
      keyword: keyword.value || undefined,
      groupId: searchGroupId.value || undefined,
      hasRamPermission: showRamUsers.value || undefined,
    })
    userList.value = response.users
    pagination.value.total = response.total
  } catch (error) {
    ElMessage.error(i18ns.t('PermissionManagement.loadUserListFailed'))
    console.error(error)
  } finally {
    loading.value = false
  }
}

const loadGroups = async () => {
  try {
    const response = await groupService.getAllGroups()
    groups.value = Array.isArray(response) ? response : response.groups
  } catch {
    // non-critical
  }
}

const handleSearch = () => {
  pagination.value.page = 1
  loadUserList()
}

const loadUserPermissions = async (userId: string) => {
  try {
    const permissions = await permissionStore.loadUserPermissions(userId)
    return permissions
  } catch (error) {
    console.error('加载用户权限失败:', error)
    return null
  }
}

const handleViewPermissions = async (user: UserDto) => {
  if (!user.id) return
  selectedUser.value = user
  permissionLoading.value = true
  viewDialogVisible.value = true
  try {
    const permissions = await loadUserPermissions(user.id)
    selectedUserPermissions.value = permissions?.data || null
  } catch {
    ElMessage.error(i18ns.t('PermissionManagement.loadPermissionFailed'))
  } finally {
    permissionLoading.value = false
  }
}

const handleEditPermissions = async (user: UserDto) => {
  if (!user.id) return
  selectedUser.value = user
  permissionLoading.value = true
  try {
    const permissions = await loadUserPermissions(user.id)
    selectedUserPermissions.value = permissions?.data || null
    editDialogVisible.value = true
  } catch {
    ElMessage.error(i18ns.t('PermissionManagement.loadPermissionFailed'))
  } finally {
    permissionLoading.value = false
  }
}

const handleEditSuccess = async () => {
  if (selectedUser.value?.id) {
    const permissions = await loadUserPermissions(selectedUser.value.id)
    selectedUserPermissions.value = permissions?.data || null
  }
}

const handleRefresh = () => {
  keyword.value = ''
  searchGroupId.value = ''
  showRamUsers.value = false
  pagination.value.page = 1
  loadUserList()
}

const handlePageChange = () => {
  loadUserList()
}

const handlePageSizeChange = () => {
  pagination.value.page = 1
  loadUserList()
}

onMounted(() => {
  loadGroups()
  loadUserList()
})

const { isDesktop } = usePageDevice()
</script>

<style scoped lang="scss">
.permission-management {
  width: 100%;
  min-width: 0;

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .card-title {
      font-size: 18px;
      font-weight: 600;
    }
  }

  .search-bar {
    margin-bottom: 16px;
  }

  .pagination-wrapper {
    margin-top: 20px;
    display: flex;
    justify-content: flex-end;
  }

  .permission-summary-cards {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-bottom: 24px;

    .summary-card {
      padding: 16px;
      border-radius: 8px;
      text-align: center;
      border: 1px solid var(--el-border-color-lighter);

      &__value {
        font-size: 28px;
        font-weight: 700;
        margin-bottom: 4px;
      }

      &__label {
        font-size: 13px;
        color: var(--el-text-color-secondary);
      }

      &--effective {
        background-color: var(--el-color-success-light-9);
        border-color: var(--el-color-success-light-5);
        .summary-card__value {
          color: var(--el-color-success);
        }
      }

      &--group {
        background-color: var(--el-color-primary-light-9);
        border-color: var(--el-color-primary-light-5);
        .summary-card__value {
          color: var(--el-color-primary);
        }
      }

      &--added {
        background-color: var(--el-color-warning-light-9);
        border-color: var(--el-color-warning-light-5);
        .summary-card__value {
          color: var(--el-color-warning);
        }
      }

      &--removed {
        background-color: var(--el-color-danger-light-9);
        border-color: var(--el-color-danger-light-5);
        .summary-card__value {
          color: var(--el-color-danger);
        }
      }
    }
  }

  .tab-badge {
    margin-left: 6px;
    :deep(.el-badge__content) {
      font-size: 11px;
    }
  }
}

@media (max-width: 768px) {
  :deep(.hide-on-mobile) {
    display: none;
  }
  .permission-management .permission-summary-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .permission-management .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  .permission-management .permission-summary-cards {
    grid-template-columns: 1fr;
  }
  .permission-management .el-tabs :deep(.el-tabs__item) {
    font-size: 13px;
    padding: 0 8px;
  }
}
</style>

<style scoped>
.permission-management-mobile {
  padding: 8px;
}

.permission-management-mobile .card-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.permission-management-mobile .card-title {
  font-size: 17px;
  font-weight: 600;
}

.permission-management-mobile .search-bar {
  margin-bottom: 12px;
}

.permission-management-mobile .mobile-search-bar {
  padding: 0 4px;
}

.permission-management-mobile .user-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.permission-management-mobile .user-item {
  border: 1px solid var(--el-border-color-lighter);
}

.permission-management-mobile .item-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.permission-management-mobile .username {
  font-weight: 600;
}

.permission-management-mobile .secondary {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.permission-management-mobile .actions {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.permission-management-mobile .actions .el-button {
  width: 100%;
  min-height: 34px;
  margin-left: 0 !important;
}

.permission-management-mobile .pagination-wrapper {
  display: flex;
}

.desktop-pagination {
  margin-top: 20px;
  justify-content: flex-end;
}

.permission-management-mobile .mobile-pagination {
  margin-top: 14px;
  justify-content: center;
}

.permission-management-mobile .permission-summary-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.permission-management-mobile .summary-card {
  padding: 12px;
  border-radius: 8px;
  text-align: center;
  border: 1px solid var(--el-border-color-lighter);
}

.permission-management-mobile .summary-card__value {
  font-size: 22px;
  font-weight: 700;
}

.permission-management-mobile .summary-card__label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.permission-management-mobile .summary-card--effective {
  background-color: var(--el-color-success-light-9);
}

.permission-management-mobile .summary-card--group {
  background-color: var(--el-color-primary-light-9);
}

.permission-management-mobile .summary-card--added {
  background-color: var(--el-color-warning-light-9);
}

.permission-management-mobile .summary-card--removed {
  background-color: var(--el-color-danger-light-9);
}

@media (max-width: 420px) {
  .permission-management-mobile .actions {
    grid-template-columns: 1fr;
  }

  .permission-management-mobile .permission-summary-cards {
    grid-template-columns: 1fr;
  }
}

/* mobile dialog polish */
.permission-management-mobile :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

:deep(.el-dialog__header) {
  padding: 14px 14px 8px;
}

:deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}

:deep(.el-dialog__footer) {
  padding: 8px 14px 14px;
}

:deep(.el-dialog__footer .el-button) {
  min-height: 36px;
}

:deep(.el-dialog__footer .el-button + .el-button) {
  margin-left: 8px !important;
}
</style>
