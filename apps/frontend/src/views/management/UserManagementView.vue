<template>
  <div>
    <div v-if="isDesktop" class="user-management desktop-page">
      <el-card class="page-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('UserManagement.title') }}</span>
            <div class="header-actions">
              <PermissionWrapper :require="[Permission.USER_CREATE]">
                <el-button :icon="Plus" type="primary" @click="handleCreate">
                  {{ i18ns.t('UserManagement.createUser') }}
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
                :placeholder="i18ns.t('UserManagement.searchKeyword')"
                clearable
                @keyup.enter="handleSearch"
                @clear="handleSearch"
              />
            </el-col>
            <el-col :span="6">
              <el-select
                v-model="searchGroupId"
                :placeholder="i18ns.t('UserManagement.filterGroup')"
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
                :active-text="i18ns.t('UserManagement.showRamUsers')"
                @change="handleSearch"
              />
            </el-col>
          </el-row>
        </div>

        <el-table v-loading="loading" :data="userList" border stripe>
          <template #empty>
            <el-empty :description="i18ns.t('noData')" />
          </template>
          <el-table-column
            prop="username"
            :label="i18ns.t('UserManagement.username')"
            min-width="120"
          />
          <el-table-column prop="name" :label="i18ns.t('UserManagement.name')" min-width="120" />
          <el-table-column prop="email" :label="i18ns.t('UserManagement.email')" min-width="180" />
          <el-table-column :label="i18ns.t('UserManagement.status')" min-width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === ACCOUNT_STATUS.ACTIVE ? 'success' : 'danger'">
                {{
                  row.status === ACCOUNT_STATUS.ACTIVE
                    ? i18ns.t('UserManagement.statusActive')
                    : i18ns.t('UserManagement.statusDisabled')
                }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('UserManagement.group')" min-width="120">
            <template #default="{ row }">{{ getGroupName(row.groupId) }}</template>
          </el-table-column>
          <el-table-column :label="i18ns.t('UserManagement.createdAt')" min-width="180">
            <template #default="{ row }">{{
              row.createdAt ? new Date(row.createdAt).toLocaleString() : ''
            }}</template>
          </el-table-column>
          <el-table-column :label="i18ns.t('actions')" fixed="right" width="300">
            <template #default="{ row }">
              <PermissionWrapper :require="[Permission.USER_UPDATE]" mode="disabled">
                <el-button link size="small" type="primary" @click="handleEdit(row)">{{
                  i18ns.t('edit')
                }}</el-button>
              </PermissionWrapper>
              <PermissionWrapper
                :require="[Permission.USER_CHANGE_OTHERS_PASSWORD]"
                mode="disabled"
              >
                <el-button link size="small" type="warning" @click="handleResetPassword(row)">{{
                  i18ns.t('UserManagement.resetPassword')
                }}</el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.USER_DELETE]" mode="disabled">
                <el-button link size="small" type="danger" @click="handleDelete(row)">{{
                  i18ns.t('delete')
                }}</el-button>
              </PermissionWrapper>
              <PermissionWrapper
                :anyRequire="[Permission.USER_IMPERSONATE_VIEW, Permission.USER_IMPERSONATE_ACT]"
                mode="hide"
              >
                <el-button
                  link
                  size="small"
                  type="warning"
                  :disabled="impersonationStore.isImpersonating"
                  @click="handleImpersonate(row)"
                  >{{ i18ns.t('UserManagement.impersonateBtn') }}</el-button
                >
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

    <div v-else class="user-management-mobile mobile-page">
      <el-card class="mobile-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('UserManagement.title') }}</span>
            <div class="header-actions">
              <PermissionWrapper :require="[Permission.USER_CREATE]">
                <el-button :icon="Plus" type="primary" @click="handleCreate">
                  {{ i18ns.t('UserManagement.createUser') }}
                </el-button>
              </PermissionWrapper>
              <el-button :icon="Refresh" @click="handleRefresh">{{ i18ns.t('refresh') }}</el-button>
            </div>
          </div>
        </template>

        <div class="search-bar mobile-search-bar">
          <el-input
            v-model="keyword"
            :placeholder="i18ns.t('UserManagement.searchKeyword')"
            clearable
            @keyup.enter="handleSearch"
            @clear="handleSearch"
          />
          <div style="display: flex; gap: 8px; margin-top: 8px">
            <el-select
              v-model="searchGroupId"
              :placeholder="i18ns.t('UserManagement.filterGroup')"
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
              :active-text="i18ns.t('UserManagement.showRamUsers')"
              @change="handleSearch"
            />
          </div>
        </div>

        <el-skeleton :loading="loading" :rows="5" animated>
          <div v-if="userList.length > 0" class="user-list">
            <el-card
              v-for="row in userList"
              :key="row.id"
              class="user-item mobile-card"
              shadow="never"
            >
              <div class="user-item-header">
                <div>
                  <div class="username">{{ row.username }}</div>
                  <div class="secondary">{{ row.name || '-' }}</div>
                </div>
                <el-tag
                  :type="row.status === ACCOUNT_STATUS.ACTIVE ? 'success' : 'danger'"
                  size="small"
                >
                  {{
                    row.status === ACCOUNT_STATUS.ACTIVE
                      ? i18ns.t('UserManagement.statusActive')
                      : i18ns.t('UserManagement.statusDisabled')
                  }}
                </el-tag>
              </div>

              <div class="meta">
                <div>{{ i18ns.t('UserManagement.email') }}: {{ row.email || '-' }}</div>
                <div>
                  {{ i18ns.t('UserManagement.group') }}:
                  {{ row.groupId ? getGroupName(row.groupId) : '-' }}
                </div>
                <div>
                  {{ i18ns.t('UserManagement.createdAt') }}:
                  {{ row.createdAt ? new Date(row.createdAt).toLocaleString() : '-' }}
                </div>
              </div>

              <div class="actions">
                <PermissionWrapper :require="[Permission.USER_UPDATE]" mode="disabled">
                  <el-button plain size="small" type="primary" @click="handleEdit(row)">{{
                    i18ns.t('edit')
                  }}</el-button>
                </PermissionWrapper>
                <PermissionWrapper
                  :require="[Permission.USER_CHANGE_OTHERS_PASSWORD]"
                  mode="disabled"
                >
                  <el-button plain size="small" type="warning" @click="handleResetPassword(row)">{{
                    i18ns.t('UserManagement.resetPassword')
                  }}</el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.USER_DELETE]" mode="disabled">
                  <el-button plain size="small" type="danger" @click="handleDelete(row)">{{
                    i18ns.t('delete')
                  }}</el-button>
                </PermissionWrapper>
                <PermissionWrapper
                  :anyRequire="[Permission.USER_IMPERSONATE_VIEW, Permission.USER_IMPERSONATE_ACT]"
                  mode="hide"
                >
                  <el-button
                    plain
                    size="small"
                    type="warning"
                    :disabled="impersonationStore.isImpersonating"
                    @click="handleImpersonate(row)"
                    >{{ i18ns.t('UserManagement.impersonateBtn') }}</el-button
                  >
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

    <el-dialog
      v-model="dialogVisible"
      :close-on-click-modal="false"
      :title="isEdit ? i18ns.t('UserManagement.editUser') : i18ns.t('UserManagement.createUser')"
      :width="isDesktop ? '500px' : '92%'"
      @closed="resetForm"
    >
      <el-form
        ref="formRef"
        :model="formData"
        :rules="formRules"
        :label-width="isDesktop ? '80px' : undefined"
        :label-position="isDesktop ? 'right' : 'top'"
      >
        <el-form-item v-if="!isEdit" :label="i18ns.t('UserManagement.username')" prop="username">
          <el-input v-model="formData.username" />
        </el-form-item>
        <el-form-item v-if="!isEdit" :label="i18ns.t('password')" prop="password">
          <el-input v-model="formData.password" show-password type="password" />
        </el-form-item>
        <el-form-item :label="i18ns.t('UserManagement.name')" prop="name">
          <el-input v-model="formData.name" />
        </el-form-item>
        <el-form-item :label="i18ns.t('UserManagement.email')" prop="email">
          <el-input v-model="formData.email" />
        </el-form-item>
        <el-form-item :label="i18ns.t('UserManagement.group')" prop="groupId">
          <el-select v-model="formData.groupId" style="width: 100%">
            <el-option
              v-for="g in groups"
              :key="g.id"
              :label="g.name || g.username"
              :value="g.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="isEdit" :label="i18ns.t('UserManagement.status')" prop="status">
          <el-select v-model="formData.status" style="width: 100%">
            <el-option
              :label="i18ns.t('UserManagement.statusActive')"
              :value="ACCOUNT_STATUS.ACTIVE"
            />
            <el-option
              :label="i18ns.t('UserManagement.statusDisabled')"
              :value="ACCOUNT_STATUS.DISABLED"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button :loading="submitting" type="primary" @click="handleSubmit">{{
          i18ns.t('confirm')
        }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="resetPasswordDialogVisible"
      :close-on-click-modal="false"
      :title="i18ns.t('UserManagement.resetPasswordTitle')"
      :width="isDesktop ? '400px' : '92%'"
      @closed="resetPasswordForm.newPassword = ''"
    >
      <p style="margin: 0 0 16px; color: var(--el-text-color-secondary)">
        {{
          i18ns.t('UserManagement.resetPasswordConfirm', {
            username: resetPasswordTarget?.username ?? '',
          })
        }}
      </p>
      <el-form ref="resetPasswordFormRef" :model="resetPasswordForm" :rules="resetPasswordRules">
        <el-form-item
          :label="i18ns.t('UserManagement.newPasswordLabel')"
          prop="newPassword"
          label-width="80px"
        >
          <el-input v-model="resetPasswordForm.newPassword" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetPasswordDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button
          :loading="resetPasswordSubmitting"
          type="warning"
          @click="handleResetPasswordSubmit"
        >
          {{ i18ns.t('UserManagement.resetPassword') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { Plus, Refresh } from '@element-plus/icons-vue'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import { Permission } from '@/constant/permission'
import { ACCOUNT_STATUS } from '@/constant/status'
import { usePageDevice } from '@/composables/usePageDevice'
import { useImpersonationStore } from '@/stores/impersonationStore'
import { impersonationService } from '@/service/impersonationService'

const { isDesktop } = usePageDevice()
import { computed, onMounted, reactive, ref } from 'vue'
import { i18ns } from '@/locales'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import type { UserDto } from '@/client/types.gen'
import { userService } from '@/service/userService'
import { groupService } from '@/service/groupService'

interface GroupItem {
  id: string
  username: string
  name?: string | null
}

const impersonationStore = useImpersonationStore()
const userList = ref<UserDto[]>([])
const groups = ref<GroupItem[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitting = ref(false)
const editingUserId = ref('')
const formRef = ref<FormInstance>()

const resetPasswordDialogVisible = ref(false)
const resetPasswordSubmitting = ref(false)
const resetPasswordTarget = ref<UserDto | null>(null)
const resetPasswordFormRef = ref<FormInstance>()
const resetPasswordForm = reactive({ newPassword: '' })
const resetPasswordRules = reactive<FormRules>({
  newPassword: [
    {
      required: true,
      message: () => i18ns.t('UserManagement.newPasswordRequired'),
      trigger: 'blur',
    },
  ],
})

const pagination = ref({ page: 1, pageSize: 10, total: 0 })
const displayTotal = computed(() => pagination.value.total)

const keyword = ref('')
const searchGroupId = ref('')
const showRamUsers = ref(false)

const formData = reactive({
  username: '',
  password: '',
  name: '',
  email: '',
  groupId: '',
  status: ACCOUNT_STATUS.ACTIVE as number,
})

const formRules = reactive<FormRules>({
  username: [
    {
      required: true,
      message: () => i18ns.t('UserManagement.usernameRequired'),
      trigger: 'blur',
    },
  ],
  password: [
    {
      required: true,
      message: () => i18ns.t('UserManagement.passwordRequired'),
      trigger: 'blur',
    },
  ],
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
      userType: showRamUsers.value ? 'ram_user' : undefined,
    })
    userList.value = response.users
    pagination.value.total = response.total
  } catch {
    ElMessage.error(i18ns.t('UserManagement.loadFailed'))
  } finally {
    loading.value = false
  }
}

const loadGroups = async () => {
  try {
    const response = await groupService.getAllGroups()
    groups.value = Array.isArray(response) ? response : response.groups
  } catch {
    ElMessage.error(i18ns.t('GroupManagement.loadFailed'))
  }
}

const getGroupName = (groupId: string): string => {
  const group = groups.value.find((g) => g.id === groupId)
  return group ? group.name || group.username : groupId
}

const handleResetPassword = (row: UserDto) => {
  resetPasswordTarget.value = row
  resetPasswordForm.newPassword = ''
  resetPasswordDialogVisible.value = true
}

const handleResetPasswordSubmit = async () => {
  if (!resetPasswordFormRef.value) return
  const valid = await resetPasswordFormRef.value.validate().catch(() => false)
  if (!valid) return

  resetPasswordSubmitting.value = true
  try {
    await userService.changePassword({
      userId: resetPasswordTarget.value!.id,
      newPassword: resetPasswordForm.newPassword,
    })
    ElMessage.success(i18ns.t('UserManagement.resetPasswordSuccess'))
    resetPasswordDialogVisible.value = false
  } catch {
    ElMessage.error(i18ns.t('UserManagement.resetPasswordFailed'))
  } finally {
    resetPasswordSubmitting.value = false
  }
}

const handleCreate = () => {
  isEdit.value = false
  dialogVisible.value = true
}

const handleEdit = (row: UserDto) => {
  isEdit.value = true
  editingUserId.value = row.id
  formData.name = row.name || ''
  formData.email = row.email || ''
  formData.groupId = row.groupId || ''
  formData.status = row.status ?? ACCOUNT_STATUS.ACTIVE
  dialogVisible.value = true
}

const handleDelete = async (row: UserDto) => {
  try {
    await ElMessageBox.confirm(
      i18ns.t('UserManagement.deleteConfirm', { username: row.username }),
      i18ns.t('UserManagement.deleteConfirmTitle'),
      { type: 'warning', confirmButtonClass: 'el-button--danger' },
    )
    await userService.deleteUser(row.id)
    ElMessage.success(i18ns.t('message.information.deleteSuccess'))
    loadUserList()
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error(i18ns.t('UserManagement.deleteFailed'))
    }
  }
}

const handleImpersonate = async (row: UserDto) => {
  try {
    await ElMessageBox.confirm(
      i18ns.t('UserManagement.impersonateConfirmMsg', { username: row.username }),
      i18ns.t('UserManagement.impersonateConfirmTitle'),
      { type: 'warning' },
    )
    await impersonationService.startImpersonation(row)
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error(
        i18ns.t('UserManagement.impersonateFailed', {
          msg:
            err instanceof Error ? err.message : i18ns.t('UserManagement.impersonateFailedUnknown'),
        }),
      )
    }
  }
}

const handleSubmit = async () => {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    if (isEdit.value) {
      await userService.updateUser(editingUserId.value, {
        name: formData.name || undefined,
        email: formData.email || undefined,
        groupId: formData.groupId || undefined,
        status: formData.status,
      })
      ElMessage.success(i18ns.t('message.information.editSuccess'))
    } else {
      await userService.createUser({
        username: formData.username,
        password: formData.password,
        name: formData.name || undefined,
        email: formData.email || undefined,
        groupId: formData.groupId || undefined,
      })
      ElMessage.success(i18ns.t('message.information.createSuccess'))
    }
    dialogVisible.value = false
    loadUserList()
  } catch {
    ElMessage.error(
      isEdit.value
        ? i18ns.t('UserManagement.updateFailed')
        : i18ns.t('UserManagement.createFailed'),
    )
  } finally {
    submitting.value = false
  }
}

const resetForm = () => {
  formData.username = ''
  formData.password = ''
  formData.name = ''
  formData.email = ''
  formData.groupId = ''
  formData.status = ACCOUNT_STATUS.ACTIVE
  editingUserId.value = ''
  formRef.value?.resetFields()
}

const handleRefresh = () => {
  keyword.value = ''
  searchGroupId.value = ''
  showRamUsers.value = false
  pagination.value.page = 1
  loadUserList()
}
const handleSearch = () => {
  pagination.value.page = 1
  loadUserList()
}
const handlePageChange = () => loadUserList()
const handlePageSizeChange = () => {
  pagination.value.page = 1
  loadUserList()
}

onMounted(() => {
  loadGroups()
  loadUserList()
})
</script>

<style scoped lang="scss">
.user-management {
  width: 100%;
  min-width: 0;
}

.user-management-mobile {
  padding: 8px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-size: 18px;
  font-weight: 600;
}

.search-bar {
  margin-bottom: 16px;
}

.mobile-search-bar {
  padding: 0 4px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.pagination-wrapper {
  display: flex;
}

.desktop-pagination {
  margin-top: 20px;
  justify-content: flex-end;
}

.mobile-pagination {
  margin-top: 14px;
  justify-content: center;
}

.user-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.user-item {
  border: 1px solid var(--el-border-color-lighter);
}

.user-item-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.username {
  font-weight: 600;
}

.secondary,
.meta {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.actions .el-button {
  flex: 1;
}

@media (max-width: 768px) {
  .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .header-actions {
    width: 100%;
  }

  .header-actions .el-button {
    flex: 1;
  }
}
</style>
