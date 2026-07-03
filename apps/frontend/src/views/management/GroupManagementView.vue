<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="group-management">
      <el-card class="page-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('GroupManagement.title') }}</span>
            <div>
              <PermissionWrapper :require="[Permission.GROUP_CREATE]">
                <el-button type="primary" @click="handleCreate" :icon="Plus">
                  {{ i18ns.t('GroupManagement.createGroup') }}
                </el-button>
              </PermissionWrapper>
              <el-button @click="handleRefresh" :icon="Refresh">{{ i18ns.t('refresh') }}</el-button>
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

      <!-- Create/Edit Dialog -->
      <el-dialog
        v-model="dialogVisible"
        :title="
          isEdit ? i18ns.t('GroupManagement.editGroup') : i18ns.t('GroupManagement.createGroup')
        "
        width="500px"
        :close-on-click-modal="false"
        @closed="resetForm"
      >
        <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
          <el-form-item v-if="!isEdit" :label="i18ns.t('GroupManagement.username')" prop="username">
            <el-input v-model="formData.username" />
          </el-form-item>
          <el-form-item :label="i18ns.t('GroupManagement.name')" prop="name">
            <el-input v-model="formData.name" />
          </el-form-item>
          <el-form-item :label="i18ns.t('GroupManagement.level')" prop="level">
            <el-input-number v-model="formData.level" :min="0" :max="100" />
          </el-form-item>
          <el-form-item :label="i18ns.t('GroupManagement.description')" prop="description">
            <el-input v-model="formData.description" type="textarea" :rows="3" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="submitting" @click="handleSubmit">
            {{ i18ns.t('confirm') }}
          </el-button>
        </template>
      </el-dialog>

      <!-- Permission Edit Dialog -->
      <el-dialog
        v-model="permDialogVisible"
        :title="i18ns.t('GroupManagement.editPermissions')"
        width="760px"
        :close-on-click-modal="false"
      >
        <!-- 统计栏 + 搜索 -->
        <div class="perm-dialog-toolbar">
          <div class="perm-stats">
            <span class="perm-stat-selected">{{ selectedPermissions.length }}</span>
            <span class="perm-stat-sep">/</span>
            <span class="perm-stat-total">{{ ALL_PERMISSIONS.length }}</span>
            <span class="perm-stat-label">{{ i18ns.t('GroupManagement.permSelected') }}</span>
          </div>
          <el-input
            v-model="permSearch"
            :placeholder="i18ns.t('GroupManagement.permSearch')"
            clearable
            size="small"
            style="width: 220px"
          >
            <template #prefix
              ><el-icon><Search /></el-icon
            ></template>
          </el-input>
          <div class="perm-global-actions">
            <el-button size="small" @click="selectAllPermissions">{{
              i18ns.t('GroupManagement.permSelectAll')
            }}</el-button>
            <el-button size="small" @click="clearAllPermissions">{{
              i18ns.t('GroupManagement.permClearAll')
            }}</el-button>
          </div>
        </div>

        <!-- 分类列表 -->
        <div class="perm-categories">
          <div
            v-for="category in filteredPermissionCategories"
            :key="category.name"
            class="perm-category"
          >
            <div class="perm-category-header">
              <div class="perm-category-title">
                <span class="perm-category-name">{{ category.name }}</span>
                <el-tag size="small" type="info" effect="plain">
                  {{ getCategorySelectedCount(category) }}/{{ category.permissions.length }}
                </el-tag>
              </div>
              <div class="perm-category-actions">
                <el-button link size="small" type="primary" @click="selectCategory(category)">{{
                  i18ns.t('GroupManagement.permSelectAllCategory')
                }}</el-button>
                <el-button link size="small" type="danger" @click="clearCategory(category)">{{
                  i18ns.t('GroupManagement.permClearCategory')
                }}</el-button>
              </div>
            </div>
            <div class="perm-items">
              <div
                v-for="perm in category.permissions"
                :key="perm"
                class="perm-item"
                :class="{ 'is-selected': selectedPermissions.includes(perm) }"
                @click="togglePermission(perm)"
              >
                <el-icon class="perm-check-icon">
                  <Check v-if="selectedPermissions.includes(perm)" />
                  <Plus v-else />
                </el-icon>
                <div class="perm-item-content">
                  <span class="perm-display-name">{{ getPermissionDisplayName(perm) }}</span>
                  <span class="perm-value">{{ perm }}</span>
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
    </div>
  </div>
  <div v-else class="mobile-page">
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
                    >{{ i18ns.t('edit') }}</el-button
                  >
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.GROUP_PERMISSION_ADD]" mode="disabled">
                  <el-button
                    plain
                    size="small"
                    type="primary"
                    :icon="Key"
                    @click="handleEditPermissions(row)"
                    >{{ i18ns.t('GroupManagement.permissions') }}</el-button
                  >
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.GROUP_DELETE]" mode="disabled">
                  <el-button
                    plain
                    size="small"
                    type="danger"
                    :icon="Delete"
                    @click="handleDelete(row)"
                    >{{ i18ns.t('delete') }}</el-button
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

      <el-dialog
        v-model="dialogVisible"
        :title="
          isEdit ? i18ns.t('GroupManagement.editGroup') : i18ns.t('GroupManagement.createGroup')
        "
        width="92%"
        :close-on-click-modal="false"
        @closed="resetForm"
      >
        <el-form ref="formRef" :model="formData" :rules="formRules" label-position="top">
          <el-form-item v-if="!isEdit" :label="i18ns.t('GroupManagement.username')" prop="username">
            <el-input v-model="formData.username" />
          </el-form-item>
          <el-form-item :label="i18ns.t('GroupManagement.name')" prop="name">
            <el-input v-model="formData.name" />
          </el-form-item>
          <el-form-item :label="i18ns.t('GroupManagement.level')" prop="level">
            <el-input-number v-model="formData.level" :min="0" :max="100" style="width: 100%" />
          </el-form-item>
          <el-form-item :label="i18ns.t('GroupManagement.description')" prop="description">
            <el-input v-model="formData.description" type="textarea" :rows="3" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="submitting" @click="handleSubmit">{{
            i18ns.t('confirm')
          }}</el-button>
        </template>
      </el-dialog>

      <el-dialog
        v-model="permDialogVisible"
        :title="i18ns.t('GroupManagement.editPermissions')"
        width="96%"
        :close-on-click-modal="false"
      >
        <div class="perm-dialog-toolbar">
          <div class="perm-stats">
            <span class="perm-stat-selected">{{ selectedPermissions.length }}</span>
            <span class="perm-stat-sep">/</span>
            <span class="perm-stat-total">{{ ALL_PERMISSIONS.length }}</span>
          </div>
          <el-input
            v-model="permSearch"
            :placeholder="i18ns.t('GroupManagement.permSearch')"
            clearable
            size="small"
          >
            <template #prefix
              ><el-icon><Search /></el-icon
            ></template>
          </el-input>
          <div class="perm-global-actions">
            <el-button size="small" @click="selectAllPermissions">{{
              i18ns.t('GroupManagement.permSelectAll')
            }}</el-button>
            <el-button size="small" @click="clearAllPermissions">{{
              i18ns.t('GroupManagement.permClearAll')
            }}</el-button>
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
                <span>{{ category.name }}</span>
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
                v-for="perm in category.permissions"
                :key="perm"
                class="perm-item"
                :class="{ 'is-selected': selectedPermissions.includes(perm) }"
                @click="togglePermission(perm)"
              >
                <el-icon class="perm-check-icon">
                  <Check v-if="selectedPermissions.includes(perm)" />
                  <Plus v-else />
                </el-icon>
                <div class="perm-item-content">
                  <span class="perm-display-name">{{ getPermissionDisplayName(perm) }}</span>
                  <span class="perm-value">{{ perm }}</span>
                </div>
              </div>
            </div>
          </div>
          <el-empty
            v-if="filteredPermissionCategories.length === 0"
            :description="i18ns.t('PermissionSelector.noMatchingPermissions')"
            :image-size="60"
          />
        </div>

        <template #footer>
          <el-button @click="permDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="permSaving" @click="handleSavePermissions">{{
            i18ns.t('save')
          }}</el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { ref, reactive, computed, onMounted } from 'vue'
import { i18ns } from '@/locales'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { Plus, Refresh, Search, Check, Edit, Delete, Key } from '@element-plus/icons-vue'
import { groupService } from '@/service/groupService'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import {
  Permission,
  ALL_PERMISSIONS,
  getPermissionCategory,
  getPermissionDisplayName,
} from '@/constant/permission'

interface GroupItem {
  id: string
  username: string
  name?: string | null
  permissions: string[]
  level: number
  description?: string | null
}

const groupList = ref<GroupItem[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitting = ref(false)
const editingGroupId = ref('')
const formRef = ref<FormInstance>()

const keyword = ref('')
const showRamGroups = ref(false)
const pagination = ref({ page: 1, pageSize: 10, total: 0 })
const displayTotal = computed(() => pagination.value.total)

const permDialogVisible = ref(false)
const permSaving = ref(false)
const editingPermGroupId = ref('')
const selectedPermissions = ref<string[]>([])
const permSearch = ref('')

const permissionCategories = computed(() => {
  const map = new Map<string, string[]>()
  for (const perm of ALL_PERMISSIONS) {
    const cat = getPermissionCategory(perm)
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(perm)
  }
  return Array.from(map.entries()).map(([name, permissions]) => ({ name, permissions }))
})

const filteredPermissionCategories = computed(() => {
  const keyword = permSearch.value.toLowerCase().trim()
  if (!keyword) return permissionCategories.value
  return permissionCategories.value
    .map((cat) => ({
      ...cat,
      permissions: cat.permissions.filter(
        (perm) =>
          perm.toLowerCase().includes(keyword) ||
          getPermissionDisplayName(perm).toLowerCase().includes(keyword) ||
          cat.name.toLowerCase().includes(keyword),
      ),
    }))
    .filter((cat) => cat.permissions.length > 0)
})

const getCategorySelectedCount = (category: { permissions: string[] }) =>
  category.permissions.filter((p) => selectedPermissions.value.includes(p)).length

const togglePermission = (perm: string) => {
  const idx = selectedPermissions.value.indexOf(perm)
  if (idx >= 0) selectedPermissions.value.splice(idx, 1)
  else selectedPermissions.value.push(perm)
}

const selectAllPermissions = () => {
  selectedPermissions.value = [...ALL_PERMISSIONS]
}

const clearAllPermissions = () => {
  selectedPermissions.value = []
}

const selectCategory = (category: { permissions: string[] }) => {
  const toAdd = category.permissions.filter((p) => !selectedPermissions.value.includes(p))
  selectedPermissions.value = [...selectedPermissions.value, ...toAdd]
}

const clearCategory = (category: { permissions: string[] }) => {
  const set = new Set(category.permissions)
  selectedPermissions.value = selectedPermissions.value.filter((p) => !set.has(p))
}

const formData = reactive({
  username: '',
  name: '',
  level: 50,
  description: '',
})

const formRules = reactive<FormRules>({
  username: [
    { required: true, message: () => i18ns.t('GroupManagement.usernameRequired'), trigger: 'blur' },
  ],
  level: [
    { required: true, message: () => i18ns.t('GroupManagement.levelRequired'), trigger: 'blur' },
  ],
})

const loadGroups = async () => {
  loading.value = true
  try {
    const response = await groupService.getAllGroups({
      keyword: keyword.value || undefined,
      page: pagination.value.page,
      pageSize: pagination.value.pageSize,
      hasRamPermission: showRamGroups.value || undefined,
    })
    groupList.value = response.groups
    pagination.value.total = response.total
  } catch (err) {
    ElMessage.error(i18ns.t('GroupManagement.loadFailed'))
    console.error('Failed to load groups:', err)
  } finally {
    loading.value = false
  }
}

const handleCreate = () => {
  isEdit.value = false
  dialogVisible.value = true
}

const handleEdit = (row: GroupItem) => {
  isEdit.value = true
  editingGroupId.value = row.id
  formData.name = row.name || ''
  formData.level = row.level
  formData.description = row.description || ''
  dialogVisible.value = true
}

const handleDelete = async (row: GroupItem) => {
  try {
    await ElMessageBox.confirm(
      i18ns.t('GroupManagement.deleteConfirm', { username: row.username }),
      i18ns.t('GroupManagement.deleteConfirmTitle'),
      { type: 'warning', confirmButtonClass: 'el-button--danger' },
    )
    await groupService.deleteGroup(row.id)
    ElMessage.success(i18ns.t('message.information.deleteSuccess'))
    loadGroups()
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(i18ns.t('GroupManagement.deleteFailed'))
  }
}

const handleEditPermissions = async (row: GroupItem) => {
  editingPermGroupId.value = row.id
  try {
    selectedPermissions.value = (await groupService.getGroupPermissions(row.id)).permissions
  } catch (err) {
    selectedPermissions.value = [...(row.permissions || [])]
    throw err
  }
  permDialogVisible.value = true
}

const handleSavePermissions = async () => {
  permSaving.value = true
  try {
    await groupService.setGroupPermissions(
      editingPermGroupId.value,
      selectedPermissions.value as Permission[],
    )
    ElMessage.success(i18ns.t('message.information.saveSuccess'))
    permDialogVisible.value = false
    loadGroups()
  } catch (err) {
    ElMessage.error(i18ns.t('GroupManagement.permissionSaveFailed'))
    throw err
  } finally {
    permSaving.value = false
  }
}

const handleSubmit = async () => {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    if (isEdit.value) {
      await groupService.updateGroup(editingGroupId.value, {
        name: formData.name || undefined,
        level: formData.level,
        description: formData.description || undefined,
      })
      ElMessage.success(i18ns.t('message.information.editSuccess'))
    } else {
      await groupService.createGroup({
        username: formData.username,
        name: formData.name || undefined,
        level: formData.level,
        description: formData.description || undefined,
      })
      ElMessage.success(i18ns.t('message.information.createSuccess'))
    }
    dialogVisible.value = false
    loadGroups()
  } catch (err) {
    ElMessage.error(
      isEdit.value
        ? i18ns.t('GroupManagement.updateFailed')
        : i18ns.t('GroupManagement.createFailed'),
    )
    throw err
  } finally {
    submitting.value = false
  }
}

const resetForm = () => {
  formData.username = ''
  formData.name = ''
  formData.level = 50
  formData.description = ''
  editingGroupId.value = ''
  formRef.value?.resetFields()
}

const handleRefresh = () => {
  keyword.value = ''
  showRamGroups.value = false
  pagination.value.page = 1
  loadGroups()
}

const handleSearch = () => {
  pagination.value.page = 1
  loadGroups()
}

const handlePageChange = () => loadGroups()
const handlePageSizeChange = () => {
  pagination.value.page = 1
  loadGroups()
}

onMounted(() => loadGroups())

const { isDesktop } = usePageDevice()
</script>

<style scoped lang="scss">
.group-management {
  padding: 20px;

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
    display: flex;
  }

  .desktop-pagination {
    margin-top: 20px;
    justify-content: flex-end;
  }
}

.group-management-mobile {
  padding: 8px;

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .card-title {
      font-size: 18px;
      font-weight: 600;
    }
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }

  .search-bar {
    margin-bottom: 12px;
  }

  .mobile-search-bar {
    padding: 0 4px;
  }

  .pagination-wrapper {
    display: flex;
  }

  .mobile-pagination {
    margin-top: 12px;
    justify-content: center;
  }
}

/* ===== Permission Dialog ===== */

.perm-dialog-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  margin-bottom: 14px;

  .perm-stats {
    display: flex;
    align-items: baseline;
    gap: 3px;
    flex-shrink: 0;

    .perm-stat-selected {
      font-size: 22px;
      font-weight: 700;
      color: var(--el-color-primary);
      line-height: 1;
    }

    .perm-stat-sep {
      color: var(--el-text-color-placeholder);
      font-size: 14px;
    }

    .perm-stat-total {
      font-size: 15px;
      color: var(--el-text-color-secondary);
    }

    .perm-stat-label {
      font-size: 12px;
      color: var(--el-text-color-secondary);
      margin-left: 4px;
    }
  }

  .perm-global-actions {
    display: flex;
    gap: 4px;
    margin-left: auto;
    flex-shrink: 0;
  }
}

.perm-categories {
  max-height: 460px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;

  .perm-empty {
    padding: 24px 0;
    text-align: center;
  }
}

.perm-category {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;

  .perm-category-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 12px;
    background: var(--el-fill-color);
    border-bottom: 1px solid var(--el-border-color);

    .perm-category-title {
      display: flex;
      align-items: center;
      gap: 8px;

      .perm-category-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--el-text-color-primary);
      }
    }

    .perm-category-actions {
      display: flex;
      gap: 2px;
    }
  }

  .perm-items {
    display: grid;
    grid-template-columns: repeat(2, 1fr);

    .perm-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      min-height: 52px;
      cursor: pointer;
      transition: background-color 0.12s;
      border-right: 1px solid var(--el-border-color-lighter);
      border-bottom: 1px solid var(--el-border-color-lighter);
      box-sizing: border-box;

      &:nth-child(even) {
        border-right: none;
      }

      &:hover {
        background: var(--el-fill-color-light);
      }

      &.is-selected {
        background: var(--el-color-primary-light-9);

        .perm-check-icon {
          color: var(--el-color-primary);
        }

        .perm-display-name {
          color: var(--el-color-primary);
          font-weight: 500;
        }
      }

      .perm-check-icon {
        font-size: 13px;
        color: var(--el-text-color-placeholder);
        flex-shrink: 0;
        align-self: center;
      }

      .perm-item-content {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 3px;
        min-width: 0;
        flex: 1;

        .perm-display-name {
          font-size: 13px;
          color: var(--el-text-color-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.4;
        }

        .perm-value {
          font-size: 11px;
          color: var(--el-text-color-placeholder);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-family: ui-monospace, monospace;
          line-height: 1.3;
        }
      }
    }
  }
}

@media (max-width: 768px) {
  :deep(.hide-on-mobile) {
    display: none;
  }
  .perm-dialog-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .perm-items {
    grid-template-columns: 1fr !important;
  }
  .perm-global-actions {
    margin-left: 0 !important;
    justify-content: flex-end;
  }
}

@media (max-width: 480px) {
  .group-management .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
}
</style>

<style scoped>
.group-management-mobile {
  padding: 8px;
}

.group-management-mobile .card-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.group-management-mobile .card-title {
  font-size: 17px;
  font-weight: 600;
}

.group-management-mobile .header-actions {
  display: flex;
  gap: 8px;
}

.group-management-mobile .header-actions .el-button {
  flex: 1;
}

.group-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.group-item {
  border: 1px solid var(--el-border-color-lighter);
}

.group-item-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.group-username {
  font-weight: 600;
}

.group-name,
.meta {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.meta {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.group-management-mobile .actions {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.group-management-mobile .actions .el-button {
  flex: 1;
  min-width: 80px;
  min-height: 34px;
  margin-left: 0 !important;
}

.group-management-mobile .perm-dialog-toolbar {
  display: grid;
  gap: 8px;
  margin-bottom: 10px;
}

.group-management-mobile .perm-stats {
  display: flex;
  align-items: baseline;
  gap: 3px;
}

.perm-stat-selected {
  font-size: 20px;
  font-weight: 700;
  color: var(--el-color-primary);
}

.perm-stat-total,
.perm-stat-sep {
  color: var(--el-text-color-secondary);
}

.group-management-mobile .perm-global-actions {
  display: flex;
  gap: 8px;
}

.group-management-mobile .perm-global-actions .el-button {
  flex: 1;
}

.group-management-mobile .perm-categories {
  max-height: 62vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-management-mobile .perm-category {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
}

.group-management-mobile .perm-category-header {
  padding: 8px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.group-management-mobile .perm-category-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.group-management-mobile .perm-category-actions {
  margin-top: 4px;
  display: flex;
  gap: 8px;
}

.group-management-mobile .perm-items {
  display: flex;
  flex-direction: column;
}

.group-management-mobile .perm-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 10px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.group-management-mobile .perm-item:first-child {
  border-top: none;
}

.group-management-mobile .perm-item.is-selected {
  background: var(--el-color-primary-light-9);
}

.group-management-mobile .perm-check-icon {
  margin-top: 2px;
  color: var(--el-text-color-placeholder);
}

.group-management-mobile .perm-item.is-selected .perm-check-icon {
  color: var(--el-color-primary);
}

.group-management-mobile .perm-item-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.group-management-mobile .perm-display-name {
  font-size: 13px;
}

.group-management-mobile .perm-value {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  word-break: break-all;
}

/* mobile dialog polish */
.group-management-mobile :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.group-management-mobile :deep(.el-dialog__header) {
  padding: 14px 14px 8px;
}

.group-management-mobile :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}

.group-management-mobile :deep(.el-dialog__footer) {
  padding: 8px 14px 14px;
}

.group-management-mobile :deep(.el-dialog__footer .el-button) {
  min-height: 36px;
}
</style>
