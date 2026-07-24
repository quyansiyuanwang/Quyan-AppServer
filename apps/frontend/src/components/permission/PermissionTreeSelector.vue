<template>
  <div class="permission-tree-selector">
    <el-input
      v-if="filterable"
      v-model="keyword"
      :placeholder="searchPlaceholder"
      :prefix-icon="Search"
      clearable
      class="permission-tree-search"
    />

    <div v-if="displayTree.length > 0" class="permission-tree-toolbar">
      <el-button-group>
        <el-tooltip :content="i18ns.t('PermissionSelector.selectAll')" placement="top">
          <el-button :icon="CircleCheck" @click="selectAllPermissions" />
        </el-tooltip>
        <el-tooltip :content="i18ns.t('PermissionSelector.clearAll')" placement="top">
          <el-button :icon="CircleClose" @click="clearSelectablePermissions" />
        </el-tooltip>
      </el-button-group>
      <el-button-group>
        <el-tooltip :content="i18ns.t('PermissionSelector.expandAll')" placement="top">
          <el-button :icon="FolderOpened" @click="expandAllNodes" />
        </el-tooltip>
        <el-tooltip :content="i18ns.t('PermissionSelector.collapseAll')" placement="top">
          <el-button :icon="Folder" @click="collapseAllNodes" />
        </el-tooltip>
        <el-tooltip :content="i18ns.t('PermissionSelector.expandNextLevel')" placement="top">
          <el-button :icon="DArrowRight" @click="expandNextLevel" />
        </el-tooltip>
      </el-button-group>
    </div>

    <el-tree
      v-if="displayTree.length > 0"
      ref="treeRef"
      :data="displayTree"
      :props="treeProps"
      show-checkbox
      node-key="value"
      :filter-node-method="filterNode"
      @check="emitCheckedPermissions"
      @node-expand="rememberExpandedNode"
      @node-collapse="forgetExpandedNode"
    >
      <template #default="{ data }">
        <el-tooltip v-if="data.tooltip" :content="data.tooltip" placement="right" :show-after="300">
          <span
            class="permission-tree-node"
            :class="{ 'is-branch': Boolean(data.children?.length) }"
          >
            <span>{{ data.label }}</span>
            <code v-if="!data.children?.length && showSource" class="permission-tree-source">{{
              data.value
            }}</code>
          </span>
        </el-tooltip>
        <span v-else>{{ data.label }}</span>
      </template>
    </el-tree>
    <el-empty v-else :description="emptyText" :image-size="60" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  CircleCheck,
  CircleClose,
  DArrowRight,
  Folder,
  FolderOpened,
  Search,
} from '@element-plus/icons-vue'
import type { TreeInstance } from 'element-plus'
import { i18ns } from '@/locales'
import type { PermissionTreeNode } from '@/views/management/permission-tree'

interface TreeNode extends PermissionTreeNode {
  disabled?: boolean
  children?: TreeNode[]
}

interface Props {
  modelValue: string[]
  data: PermissionTreeNode[]
  isPermissionDisabled?: (permission: string) => boolean
  filterable?: boolean
  searchPlaceholder?: string
  emptyText?: string
  showSource?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isPermissionDisabled: undefined,
  filterable: false,
  searchPlaceholder: '',
  emptyText: '',
  showSource: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const treeRef = ref<TreeInstance>()
const keyword = ref('')
const expandedNodeKeys = ref(new Set<string>())
let lastTreeEmission = ''
const treeProps = { disabled: 'disabled' }

interface BranchNode {
  value: string
  parentValue?: string
}

const decorateNodes = (nodes: PermissionTreeNode[]): TreeNode[] =>
  nodes.map((node) => {
    const children = node.children ? decorateNodes(node.children) : undefined
    return {
      ...node,
      children,
      disabled:
        !children?.length && props.isPermissionDisabled
          ? props.isPermissionDisabled(node.value)
          : false,
    }
  })

const displayTree = computed(() => decorateNodes(props.data))

const filterNode = (value: string, data: TreeNode) => {
  const query = value.trim().toLowerCase()
  if (!query) return true
  return [data.label, data.tooltip, data.value].some((item) => item.toLowerCase().includes(query))
}

const normalizeKeys = (keys: readonly string[]) => [...keys].sort().join('\u0000')

const collectLeafNodes = (nodes: TreeNode[]): TreeNode[] =>
  nodes.flatMap((node) => (node.children?.length ? collectLeafNodes(node.children) : [node]))

const collectBranchNodes = (nodes: TreeNode[], parentValue?: string): BranchNode[] =>
  nodes.flatMap((node) => {
    if (!node.children?.length) return []
    return [{ value: node.value, parentValue }, ...collectBranchNodes(node.children, node.value)]
  })

const updateSelectedPermissions = async (permissions: string[]) => {
  const normalized = Array.from(new Set(permissions))
  lastTreeEmission = normalizeKeys(normalized)
  await nextTick()
  treeRef.value?.setCheckedKeys(normalized)
  emit('update:modelValue', normalized)
}

const selectAllPermissions = () => {
  const selectable = collectLeafNodes(displayTree.value)
    .filter((node) => !node.disabled)
    .map((node) => node.value)
  void updateSelectedPermissions([...props.modelValue, ...selectable])
}

const clearSelectablePermissions = () => {
  const selectable = new Set(
    collectLeafNodes(displayTree.value)
      .filter((node) => !node.disabled)
      .map((node) => node.value),
  )
  void updateSelectedPermissions(
    props.modelValue.filter((permission) => !selectable.has(permission)),
  )
}

const expandNodes = (nodes: BranchNode[]) => {
  for (const { value } of nodes) {
    treeRef.value?.getNode(value)?.expand()
    expandedNodeKeys.value.add(value)
  }
}

const expandAllNodes = () => expandNodes(collectBranchNodes(displayTree.value))

const collapseAllNodes = () => {
  for (const { value } of collectBranchNodes(displayTree.value)) {
    treeRef.value?.getNode(value)?.collapse()
  }
  expandedNodeKeys.value.clear()
}

const expandNextLevel = () => {
  const nextLevel = collectBranchNodes(displayTree.value).filter(
    ({ value, parentValue }) =>
      !expandedNodeKeys.value.has(value) &&
      (!parentValue || expandedNodeKeys.value.has(parentValue)),
  )
  expandNodes(nextLevel)
}

const restoreExpandedNodes = async () => {
  await nextTick()
  for (const key of expandedNodeKeys.value) {
    treeRef.value?.getNode(key)?.expand()
  }
}

const rememberExpandedNode = (data: TreeNode) => expandedNodeKeys.value.add(data.value)
const forgetExpandedNode = (data: TreeNode) => expandedNodeKeys.value.delete(data.value)

const syncCheckedKeys = async () => {
  const modelValue = props.modelValue.map(String)
  if (normalizeKeys(modelValue) === lastTreeEmission) {
    lastTreeEmission = ''
    return
  }
  await nextTick()
  treeRef.value?.setCheckedKeys(modelValue)
}

const emitCheckedPermissions = () => {
  const checked = treeRef.value?.getCheckedKeys(true) ?? []
  const permissions = checked.map(String)
  lastTreeEmission = normalizeKeys(permissions)
  emit('update:modelValue', permissions)
}

watch(keyword, (value) => treeRef.value?.filter(value))
watch(() => props.modelValue, syncCheckedKeys, { deep: true, immediate: true })
watch(
  () => props.data,
  () => {
    expandedNodeKeys.value.clear()
    void syncCheckedKeys()
  },
  { deep: true },
)
watch(displayTree, () => void restoreExpandedNodes(), { flush: 'post' })
</script>

<style scoped>
.permission-tree-selector {
  min-width: 0;
}

.permission-tree-search {
  margin-bottom: 12px;
}

.permission-tree-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.permission-tree-node {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.permission-tree-node.is-branch {
  font-weight: 600;
}

.permission-tree-source {
  color: var(--el-text-color-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  font-weight: 400;
}
</style>
