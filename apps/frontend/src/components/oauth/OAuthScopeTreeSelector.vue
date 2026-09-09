<template>
  <div class="oauth-scope-tree-selector">
    <el-input v-model="keyword" clearable :placeholder="i18ns.t('oauthScopes.search')" />
    <div class="oauth-scope-tree-selector__toolbar">
      <el-button size="small" @click="selectAllGrantable">
        {{ i18ns.t('oauthScopes.selectAll') }}
      </el-button>
      <el-button size="small" @click="clearSelection">
        {{ i18ns.t('oauthScopes.clear') }}
      </el-button>
      <el-button size="small" @click="setExpanded(true)">
        {{ i18ns.t('oauthScopes.expandAll') }}
      </el-button>
      <el-button size="small" @click="setExpanded(false)">
        {{ i18ns.t('oauthScopes.collapseAll') }}
      </el-button>
    </div>
    <el-alert
      v-if="highRiskCount"
      class="oauth-scope-tree-selector__alert"
      type="warning"
      :closable="false"
      show-icon
    >
      {{ i18ns.t('oauthScopes.highRiskSelection', { count: highRiskCount }) }}
    </el-alert>
    <el-tree
      ref="treeRef"
      class="oauth-scope-tree-selector__tree"
      :data="treeData"
      node-key="value"
      show-checkbox
      check-on-click-node
      :expand-on-click-node="false"
      :filter-node-method="filterNode"
      @check="emitSelection"
    >
      <template #default="{ data }">
        <el-tooltip :content="data.description" placement="right" :show-after="300">
          <span class="oauth-scope-tree-selector__node">
            <span>{{ data.label }}</span>
            <el-tag v-if="data.riskLevel === 'high'" type="warning" size="small">
              {{ i18ns.t('oauthScopes.highRisk') }}
            </el-tag>
            <code v-if="!data.children?.length">{{ data.value }}</code>
          </span>
        </el-tooltip>
      </template>
    </el-tree>
    <el-empty v-if="!treeData.length" :description="i18ns.t('oauthScopes.noGrantableScopes')" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { TreeInstance } from 'element-plus'
import { getPermissionLabel, getPermissionTooltip } from '@/constant/permission'
import { i18ns } from '@/locales'
import { getPermissionCategoryTranslationKey } from '@/views/management/permission-tree'

export interface OAuthScopeOption {
  scope: string
  kind: 'identity' | 'permission' | 'legacy'
  category: string
  riskLevel: 'normal' | 'high'
  legacy: boolean
  labelKey: string
  descriptionKey: string
  categoryKey: string
  grantable: boolean
}

interface ScopeTreeNode {
  value: string
  label: string
  description: string
  riskLevel: 'normal' | 'high'
  children?: ScopeTreeNode[]
}

const props = defineProps<{ modelValue: string[]; scopes: OAuthScopeOption[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()
const treeRef = ref<TreeInstance>()
const keyword = ref('')

const localize = (option: OAuthScopeOption, description = false) => {
  if (option.kind === 'permission') {
    if (i18ns.locale === 'emoji') return `🛂 ${option.scope}`
    return description
      ? getPermissionTooltip(option.scope, i18ns.locale)
      : getPermissionLabel(option.scope, i18ns.locale)
  }
  return i18ns.t((description ? option.descriptionKey : option.labelKey) as never)
}

const treeData = computed<ScopeTreeNode[]>(() => {
  const groups = new Map<string, OAuthScopeOption[]>()
  for (const option of props.scopes.filter(
    (item) => item.grantable || props.modelValue.includes(item.scope),
  )) {
    const items = groups.get(option.category) ?? []
    items.push(option)
    groups.set(option.category, items)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, items]) => ({
      value: `category:${category}`,
      label:
        items[0]?.kind === 'permission'
          ? i18ns.t(getPermissionCategoryTranslationKey(category, 'label'))
          : i18ns.t((items[0]?.categoryKey || 'oauthScopes.categories.general') as never),
      description: i18ns.t('oauthScopes.categoryDescription'),
      riskLevel: 'normal' as const,
      children: items
        .sort((a, b) => localize(a).localeCompare(localize(b)))
        .map((item) => ({
          value: item.scope,
          label: localize(item),
          description: localize(item, true),
          riskLevel: item.riskLevel,
        })),
    }))
})

const highRiskCount = computed(
  () =>
    props.modelValue.filter(
      (scope) => props.scopes.find((item) => item.scope === scope)?.riskLevel === 'high',
    ).length,
)

const filterNode = (value: string, data: ScopeTreeNode) => {
  const query = value.trim().toLowerCase()
  if (!query) return true
  return [data.label, data.description, data.value].some((item) =>
    item.toLowerCase().includes(query),
  )
}

const emitSelection = () => {
  const checked = treeRef.value?.getCheckedKeys(true).map(String) ?? []
  emit('update:modelValue', checked)
}

const selectAllGrantable = () => {
  emit(
    'update:modelValue',
    props.scopes.filter((scope) => scope.grantable).map((scope) => scope.scope),
  )
}

const clearSelection = () => emit('update:modelValue', [])

const setExpanded = (expanded: boolean) => {
  treeRef.value?.store._getAllNodes().forEach((node) => {
    node.expanded = expanded
  })
}

watch(keyword, (value) => treeRef.value?.filter(value))
watch(
  () => [props.modelValue, treeData.value] as const,
  async () => {
    await nextTick()
    treeRef.value?.setCheckedKeys(props.modelValue)
  },
  { deep: true, immediate: true },
)
</script>

<style scoped>
.oauth-scope-tree-selector__alert {
  margin: 12px 0;
}
.oauth-scope-tree-selector__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.oauth-scope-tree-selector__tree {
  margin-top: 12px;
  max-height: 360px;
  overflow: auto;
}
.oauth-scope-tree-selector__node {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.oauth-scope-tree-selector__node code {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
