import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { i18ns } from '@/locales'
import { usePageDevice } from '@/composables/usePageDevice'
import { groupService } from '@/service/groupService'
import {
  Permission,
  ALL_PERMISSIONS,
  getPermissionCategory,
  getPermissionDisplayName,
} from '@/constant/permission'

export interface GroupItem {
  id: string
  username: string
  name?: string | null
  permissions: string[]
  level: number
  description?: string | null
}

export interface PermissionCategory {
  name: string
  permissions: string[]
}

export const useGroupManagement = () => {
  const { isDesktop } = usePageDevice()

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

  const permissionCategories = computed<PermissionCategory[]>(() => {
    const map = new Map<string, string[]>()
    for (const perm of ALL_PERMISSIONS) {
      const category = getPermissionCategory(perm)
      if (!map.has(category)) {
        map.set(category, [])
      }
      map.get(category)!.push(perm)
    }
    return Array.from(map.entries()).map(([name, permissions]) => ({ name, permissions }))
  })

  const filteredPermissionCategories = computed(() => {
    const keywordValue = permSearch.value.toLowerCase().trim()
    if (!keywordValue) {
      return permissionCategories.value
    }

    return permissionCategories.value
      .map((category) => ({
        ...category,
        permissions: category.permissions.filter(
          (perm) =>
            perm.toLowerCase().includes(keywordValue) ||
            getPermissionDisplayName(perm).toLowerCase().includes(keywordValue) ||
            category.name.toLowerCase().includes(keywordValue),
        ),
      }))
      .filter((category) => category.permissions.length > 0)
  })

  const getCategorySelectedCount = (category: Pick<PermissionCategory, 'permissions'>) =>
    category.permissions.filter((permission) => selectedPermissions.value.includes(permission)).length

  const togglePermission = (permission: string) => {
    const index = selectedPermissions.value.indexOf(permission)
    if (index >= 0) {
      selectedPermissions.value.splice(index, 1)
      return
    }
    selectedPermissions.value.push(permission)
  }

  const selectAllPermissions = () => {
    selectedPermissions.value = [...ALL_PERMISSIONS]
  }

  const clearAllPermissions = () => {
    selectedPermissions.value = []
  }

  const selectCategory = (category: Pick<PermissionCategory, 'permissions'>) => {
    const toAdd = category.permissions.filter(
      (permission) => !selectedPermissions.value.includes(permission),
    )
    selectedPermissions.value = [...selectedPermissions.value, ...toAdd]
  }

  const clearCategory = (category: Pick<PermissionCategory, 'permissions'>) => {
    const permissionSet = new Set(category.permissions)
    selectedPermissions.value = selectedPermissions.value.filter(
      (permission) => !permissionSet.has(permission),
    )
  }

  const formData = reactive({
    username: '',
    name: '',
    level: 50,
    description: '',
  })

  const formRules = reactive<FormRules>({
    username: [
      {
        required: true,
        message: () => i18ns.t('GroupManagement.usernameRequired'),
        trigger: 'blur',
      },
    ],
    level: [
      {
        required: true,
        message: () => i18ns.t('GroupManagement.levelRequired'),
        trigger: 'blur',
      },
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
    } catch (error) {
      ElMessage.error(i18ns.t('GroupManagement.loadFailed'))
      console.error('Failed to load groups:', error)
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
      void loadGroups()
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error(i18ns.t('GroupManagement.deleteFailed'))
      }
    }
  }

  const handleEditPermissions = async (row: GroupItem) => {
    editingPermGroupId.value = row.id
    try {
      selectedPermissions.value = (await groupService.getGroupPermissions(row.id)).permissions
    } catch (error) {
      selectedPermissions.value = [...(row.permissions || [])]
      throw error
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
      void loadGroups()
    } catch (error) {
      ElMessage.error(i18ns.t('GroupManagement.permissionSaveFailed'))
      throw error
    } finally {
      permSaving.value = false
    }
  }

  const handleSubmit = async () => {
    if (!formRef.value) {
      return
    }
    const valid = await formRef.value.validate().catch(() => false)
    if (!valid) {
      return
    }

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
      void loadGroups()
    } catch (error) {
      ElMessage.error(
        isEdit.value
          ? i18ns.t('GroupManagement.updateFailed')
          : i18ns.t('GroupManagement.createFailed'),
      )
      throw error
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
    void loadGroups()
  }

  const handleSearch = () => {
    pagination.value.page = 1
    void loadGroups()
  }

  const handlePageChange = () => {
    void loadGroups()
  }

  const handlePageSizeChange = () => {
    pagination.value.page = 1
    void loadGroups()
  }

  onMounted(() => {
    void loadGroups()
  })

  return {
    isDesktop,
    groupList,
    loading,
    dialogVisible,
    isEdit,
    submitting,
    editingGroupId,
    formRef,
    keyword,
    showRamGroups,
    pagination,
    displayTotal,
    permDialogVisible,
    permSaving,
    editingPermGroupId,
    selectedPermissions,
    permSearch,
    permissionCategories,
    filteredPermissionCategories,
    formData,
    formRules,
    getCategorySelectedCount,
    togglePermission,
    selectAllPermissions,
    clearAllPermissions,
    selectCategory,
    clearCategory,
    getPermissionDisplayName,
    loadGroups,
    handleCreate,
    handleEdit,
    handleDelete,
    handleEditPermissions,
    handleSavePermissions,
    handleSubmit,
    resetForm,
    handleRefresh,
    handleSearch,
    handlePageChange,
    handlePageSizeChange,
    ALL_PERMISSIONS,
    Permission,
  }
}

export type GroupManagementState = ReturnType<typeof useGroupManagement>
