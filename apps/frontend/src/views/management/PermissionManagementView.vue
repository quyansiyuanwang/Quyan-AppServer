<template>
  <div class="permission-management desktop-page">
    <el-card class="page-card">
      <template #header>
        <div class="permission-management__header">
          <div>
            <h1>{{ page.title() }}</h1>
            <p>{{ page.description() }}</p>
          </div>
          <el-button :icon="Refresh" @click="handleRefresh">{{ i18ns.t('refresh') }}</el-button>
        </div>
      </template>

      <div class="permission-management__filters">
        <el-input
          v-model="keyword"
          :placeholder="i18ns.t('PermissionManagement.searchKeyword')"
          clearable
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-select
          v-model="searchGroupId"
          :placeholder="i18ns.t('PermissionManagement.filterGroup')"
          clearable
          @change="handleSearch"
        >
          <el-option
            v-for="group in groups"
            :key="group.id"
            :label="group.name || group.username"
            :value="group.id"
          />
        </el-select>
        <el-switch
          v-model="showRamUsers"
          :active-text="i18ns.t('PermissionManagement.showRamUsers')"
          @change="handleSearch"
        />
      </div>

      <el-table v-loading="loading" :data="userList" border stripe>
        <template #empty><el-empty :description="i18ns.t('noData')" /></template>
        <el-table-column prop="username" :label="i18ns.t('username')" min-width="140" />
        <el-table-column
          prop="name"
          :label="i18ns.t('PermissionManagement.name')"
          min-width="140"
        />
        <el-table-column :label="i18ns.t('PermissionManagement.groupName')" min-width="140">
          <template #default="{ row }"
            ><el-tag size="small">{{ row.groupName || row.groupId }}</el-tag></template
          >
        </el-table-column>
        <el-table-column :label="i18ns.t('actions')" fixed="right" width="160">
          <template #default="{ row }">
            <PermissionWrapper
              v-if="mode === 'authorizations'"
              :any-require="[Permission.PERMISSION_ADD, Permission.PERMISSION_REMOVE]"
              mode="disabled"
            >
              <el-button link type="primary" @click="handleEditPermissions(row)">
                {{ i18ns.t('edit') }}
              </el-button>
            </PermissionWrapper>
            <el-button v-else link type="primary" @click="handleInspectPermissions(row)">
              {{ inspectLabel }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="permission-management__pagination">
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

    <el-dialog
      v-model="inspectDialogVisible"
      :title="inspectTitle"
      width="min(960px, 96vw)"
      :close-on-click-modal="false"
    >
      <div v-if="selectedUserPermissions" v-loading="permissionLoading">
        <el-alert
          v-if="mode === 'diagnostics'"
          type="info"
          :closable="false"
          :title="diagnosticsExplanation"
          class="permission-management__diagnostics-note"
        />

        <div class="permission-management__summary">
          <div class="summary-card summary-card--effective">
            <strong>{{ selectedUserPermissions.effectivePermissions.length }}</strong>
            <span>{{ i18ns.t('PermissionManagement.effectivePermissions') }}</span>
          </div>
          <div class="summary-card summary-card--group">
            <strong>{{ selectedUserPermissions.groupPermissions.length }}</strong>
            <span>{{ i18ns.t('PermissionManagement.groupPermissions') }}</span>
          </div>
          <div class="summary-card summary-card--added">
            <strong>{{ selectedUserPermissions.additionalPermissions.length }}</strong>
            <span>{{ i18ns.t('PermissionManagement.additionalPermissions') }}</span>
          </div>
          <div class="summary-card summary-card--removed">
            <strong>{{ selectedUserPermissions.removedPermissions.length }}</strong>
            <span>{{ i18ns.t('PermissionManagement.removedPermissions') }}</span>
          </div>
        </div>

        <section class="permission-management__source-section">
          <h2>{{ i18ns.t('PermissionManagement.effectivePermissions') }}</h2>
          <PermissionList
            :permissions="selectedUserPermissions.effectivePermissions"
            tag-type="success"
          />
        </section>
        <section class="permission-management__source-section">
          <h2>{{ i18ns.t('PermissionManagement.groupPermissions') }}</h2>
          <PermissionList
            :permissions="selectedUserPermissions.groupPermissions"
            tag-type="primary"
          />
        </section>
        <section class="permission-management__source-section">
          <h2>{{ i18ns.t('PermissionManagement.additionalPermissions') }}</h2>
          <PermissionList
            :permissions="selectedUserPermissions.additionalPermissions"
            tag-type="warning"
          />
        </section>
        <section class="permission-management__source-section">
          <h2>{{ i18ns.t('PermissionManagement.removedPermissions') }}</h2>
          <PermissionList
            :permissions="selectedUserPermissions.removedPermissions"
            tag-type="danger"
          />
        </section>
      </div>
    </el-dialog>

    <UserPermissionDialog
      v-model="editDialogVisible"
      :user="selectedUser"
      :user-permissions="selectedUserPermissions"
      @success="handleEditSuccess"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import type { UserDto, UserFullPermissionsDto } from '@/client/types.gen'
import PermissionList from '@/components/permission/PermissionList.vue'
import UserPermissionDialog from '@/components/permission/UserPermissionDialog.vue'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import { Permission } from '@/constant/permission'
import { i18ns, type I18nENAvailableKeys } from '@/locales'
import { groupService } from '@/service/groupService'
import { userService } from '@/service/userService'
import { usePermissionStore } from '@/stores/permissionStore'

type PermissionPageMode = 'authorizations' | 'policies' | 'diagnostics'

const props = withDefaults(defineProps<{ mode?: PermissionPageMode }>(), {
  mode: 'authorizations',
})

const inspectLabel = i18ns.t('PermissionManagement.inspect' as I18nENAvailableKeys)
const diagnosticsExplanation = i18ns.t(
  'PermissionManagement.diagnosticsExplanation' as I18nENAvailableKeys,
)

const page = computed(() => {
  if (props.mode === 'policies') {
    return {
      title: () => i18ns.t('IamPermissionPages.policiesTitle' as I18nENAvailableKeys),
      description: () => i18ns.t('IamPermissionPages.policiesDescription' as I18nENAvailableKeys),
    }
  }
  if (props.mode === 'diagnostics') {
    return {
      title: () => i18ns.t('IamPermissionPages.diagnosticsTitle' as I18nENAvailableKeys),
      description: () =>
        i18ns.t('IamPermissionPages.diagnosticsDescription' as I18nENAvailableKeys),
    }
  }
  return {
    title: () => i18ns.t('IamPermissionPages.authorizationsTitle' as I18nENAvailableKeys),
    description: () =>
      i18ns.t('IamPermissionPages.authorizationsDescription' as I18nENAvailableKeys),
  }
})

const userList = ref<UserDto[]>([])
const groups = ref<Array<{ id: string; name?: string | null; username: string }>>([])
const loading = ref(false)
const permissionLoading = ref(false)
const keyword = ref('')
const searchGroupId = ref('')
const showRamUsers = ref(false)
const pagination = ref({ page: 1, pageSize: 10, total: 0 })
const inspectDialogVisible = ref(false)
const editDialogVisible = ref(false)
const selectedUser = ref<UserDto | null>(null)
const selectedUserPermissions = ref<UserFullPermissionsDto | null>(null)
const permissionStore = usePermissionStore()

const inspectTitle = computed(() => {
  const username = selectedUser.value?.username ?? ''
  const pageTitle =
    props.mode === 'diagnostics'
      ? i18ns.t('IamPermissionPages.diagnosticsTitle')
      : i18ns.t('IamPermissionPages.policiesTitle')
  return `${pageTitle}: ${username}`
})

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
    // Group filtering is optional for this screen.
  }
}

const loadUserPermissions = async (user: UserDto) => {
  if (!user.id) return false
  selectedUser.value = user
  permissionLoading.value = true
  try {
    const response = await permissionStore.loadUserPermissions(user.id)
    selectedUserPermissions.value = response?.data ?? null
    return selectedUserPermissions.value !== null
  } catch (error) {
    ElMessage.error(i18ns.t('PermissionManagement.loadPermissionFailed'))
    console.error(error)
    return false
  } finally {
    permissionLoading.value = false
  }
}

const handleInspectPermissions = async (user: UserDto) => {
  inspectDialogVisible.value = true
  await loadUserPermissions(user)
}

const handleEditPermissions = async (user: UserDto) => {
  if (await loadUserPermissions(user)) editDialogVisible.value = true
}

const handleEditSuccess = async () => {
  if (selectedUser.value) await loadUserPermissions(selectedUser.value)
}

const handleSearch = () => {
  pagination.value.page = 1
  void loadUserList()
}

const handleRefresh = () => {
  keyword.value = ''
  searchGroupId.value = ''
  showRamUsers.value = false
  pagination.value.page = 1
  void loadUserList()
}

const handlePageChange = () => void loadUserList()
const handlePageSizeChange = () => {
  pagination.value.page = 1
  void loadUserList()
}

onMounted(() => {
  void loadGroups()
  void loadUserList()
})
</script>

<style scoped lang="scss">
.permission-management__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.permission-management__header h1,
.permission-management__source-section h2 {
  margin: 0;
}

.permission-management__header h1 {
  font-size: 18px;
}

.permission-management__header p {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
}

.permission-management__filters {
  display: grid;
  grid-template-columns: minmax(200px, 1fr) minmax(180px, 0.6fr) auto;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.permission-management__pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

.permission-management__diagnostics-note {
  margin-bottom: 16px;
}

.permission-management__summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.summary-card {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

.summary-card strong {
  font-size: 24px;
}

.summary-card span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.summary-card--effective {
  background: var(--el-color-success-light-9);
}
.summary-card--group {
  background: var(--el-color-primary-light-9);
}
.summary-card--added {
  background: var(--el-color-warning-light-9);
}
.summary-card--removed {
  background: var(--el-color-danger-light-9);
}

.permission-management__source-section + .permission-management__source-section {
  margin-top: 24px;
}

.permission-management__source-section h2 {
  margin-bottom: 12px;
  font-size: 15px;
}

@media (max-width: 760px) {
  .permission-management__header,
  .permission-management__filters {
    grid-template-columns: 1fr;
  }

  .permission-management__header {
    display: grid;
  }

  .permission-management__summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .permission-management__pagination {
    justify-content: center;
  }
}
</style>
