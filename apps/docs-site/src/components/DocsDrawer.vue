<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="docs-drawer"
      :aria-label="title"
      @close="open = false"
      @cancel.prevent="open = false"
      @click="handleBackdrop"
    >
      <div class="drawer-header">
        <strong>{{ title }}</strong
        ><button type="button" :aria-label="closeLabel" @click="open = false">
          {{ closeLabel }} <span aria-hidden="true">×</span>
        </button>
      </div>
      <div class="drawer-content"><slot /></div>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
defineProps<{ title: string; closeLabel: string }>()
const open = defineModel<boolean>({ required: true })
const dialog = ref<HTMLDialogElement | null>(null)
let restoreFocus: HTMLElement | null = null
let previousOverflow: string | undefined
const unlock = () => {
  if (previousOverflow !== undefined) document.documentElement.style.overflow = previousOverflow
  previousOverflow = undefined
}
watch(
  [open, dialog],
  ([isOpen, element]) => {
    if (!element) return
    if (isOpen && !element.open) {
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      previousOverflow = document.documentElement.style.overflow
      element.showModal()
      document.documentElement.style.overflow = 'hidden'
    } else if (!isOpen && element.open) {
      element.close()
      unlock()
      if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true })
    }
  },
  { flush: 'post' },
)
function handleBackdrop(event: MouseEvent) {
  if (event.target !== dialog.value) return
  const bounds = dialog.value!.getBoundingClientRect()
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    open.value = false
}
onBeforeUnmount(() => {
  dialog.value?.close()
  unlock()
})
</script>

<style scoped>
.docs-drawer {
  position: fixed;
  inset: 0 auto 0 0;
  width: min(380px, calc(100% - 24px));
  max-width: none;
  height: 100dvh;
  max-height: 100dvh;
  margin: 0;
  padding: 0;
  border: 0;
  border-right: 1px solid var(--docs-border);
  background: var(--docs-surface);
  color: var(--docs-text);
  box-shadow: 16px 0 60px #02061740;
}
.docs-drawer[open] {
  display: flex;
  flex-direction: column;
}
.docs-drawer::backdrop {
  background: #02061780;
}
.drawer-header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--docs-border);
}
.drawer-header strong {
  font-size: 14px;
}
.drawer-header button {
  min-height: 44px;
  padding: 0 10px;
  border: 1px solid var(--docs-border);
  border-radius: 6px;
  background: transparent;
  color: var(--docs-text);
  cursor: pointer;
  font-size: 13px;
}
.drawer-header button span {
  padding-left: 6px;
  font-size: 20px;
}
.drawer-content {
  flex: 1;
  min-height: 0;
}
</style>
