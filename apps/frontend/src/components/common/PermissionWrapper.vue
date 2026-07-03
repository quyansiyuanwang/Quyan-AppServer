<template>
  <slot v-if="isAllowed" />
  <template v-else-if="mode === 'disabled'">
    <slot name="fallback">
      <component :is="disabledVNode" v-if="disabledVNode" />
    </slot>
  </template>
  <slot v-else-if="mode === 'hide'" name="fallback" />
</template>

<script setup lang="ts">
import { computed, useSlots, cloneVNode, type VNode } from 'vue'
import { usePermissionStore } from '@/stores/permissionStore'

interface PermissionProps {
  require?: string | string[]
  anyRequire?: string | string[]
  mode?: 'hide' | 'disabled'
}

const props = withDefaults(defineProps<PermissionProps>(), {
  require: undefined,
  anyRequire: undefined,
  mode: 'hide',
})

defineSlots<{
  default?: () => any
  fallback?: () => any
}>()

const permissionStore = usePermissionStore()
const slots = useSlots()

// 检查是否有权限
const isAllowed = computed(() => {
  const filterUndefined = (arr: (string | undefined)[]) =>
    arr.filter((x) => x !== undefined) as string[]

  const requiredPermissions = filterUndefined(
    Array.isArray(props.require) ? props.require : [props.require],
  )
  const anyRequiredPermissions = filterUndefined(
    Array.isArray(props.anyRequire) ? props.anyRequire : [props.anyRequire],
  )

  const hasAllRequired = requiredPermissions.every((perm) => permissionStore.hasPermission(perm))
  const hasAnyRequired =
    anyRequiredPermissions.length === 0 ||
    anyRequiredPermissions.some((perm) => permissionStore.hasPermission(perm))

  return hasAllRequired && hasAnyRequired
})

// 获取带 disabled 属性的克隆 VNode
const disabledVNode = computed<VNode | null>(() => {
  const defaultSlot = slots.default?.()
  if (!defaultSlot || defaultSlot.length === 0) return null

  // 找到第一个有效的组件/元素节点
  for (const vnode of defaultSlot) {
    if (vnode.type && typeof vnode.type !== 'symbol') {
      // 使用 cloneVNode 克隆节点并添加 disabled 属性
      return cloneVNode(vnode, { disabled: true })
    }
  }
  return null
})
</script>
