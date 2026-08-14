<template>
  <div v-if="workspaceState.visible" class="floating-workspace" :style="workspaceStyle">
    <div class="floating-workspace__header" @pointerdown="onHeaderPointerDown">
      <div class="floating-workspace__title-group">
        <span class="floating-workspace__title">{{ i18ns.t('workspace.title') }}</span>
        <span class="floating-workspace__subtitle">{{ activeTabTitle }}</span>
      </div>
      <div class="floating-workspace__actions">
        <button type="button" class="workspace-action" @click.stop="openDocs">
          {{ i18ns.t('workspace.docsShort') }}
        </button>
        <button type="button" class="workspace-icon-button" @click.stop="closeWorkspace">×</button>
      </div>
    </div>

    <div class="floating-workspace__body">
      <div class="floating-workspace__toolbar">
        <div class="floating-workspace__tabs">
          <button
            v-for="tab in workspaceState.tabs"
            :key="tab.id"
            type="button"
            class="workspace-tab"
            :class="{ 'is-active': tab.id === workspaceState.activeTabId }"
            @click="workspaceStore.setActiveTab(tab.id)"
          >
            <span class="workspace-tab__label">{{ tab.title }}</span>
            <span
              v-if="tab.closable"
              class="workspace-tab__close"
              @click.stop="workspaceStore.closeTab(tab.id)"
            >
              ×
            </span>
          </button>
        </div>
        <div class="floating-workspace__toolbar-actions">
          <button type="button" class="workspace-link-button" @click="openSwagger">
            {{ i18ns.t('workspace.swaggerTitle') }}
          </button>
        </div>
      </div>

    <div class="floating-workspace__frame-shell">
        <SupportAssistantPanel v-if="activeTab?.type === 'support'" />
        <iframe
          v-else-if="activeTab"
          :key="activeTab.id"
          class="floating-workspace__frame"
          :src="activeTab.src"
          :title="activeTab.title"
          loading="lazy"
          referrerpolicy="strict-origin-when-cross-origin"
        />
        <div v-else class="floating-workspace__empty">
          <h3>{{ i18ns.t('workspace.emptyTitle') }}</h3>
          <p>{{ i18ns.t('workspace.emptyDescription') }}</p>
          <div class="floating-workspace__empty-actions">
            <button type="button" class="workspace-link-button" @click="openDocs">
              {{ i18ns.t('workspace.openDocs') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="floating-workspace__resize-handle" @pointerdown.stop="onResizePointerDown"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import router from '@/router'
import { i18ns } from '@/locales'
import { useFloatingWorkspaceStore } from '@/stores/floatingWorkspaceStore'
import { swaggerDocsService } from '@/service/swaggerDocsService'
import SupportAssistantPanel from '@/components/support/SupportAssistantPanel.vue'

const workspaceStore = useFloatingWorkspaceStore()
const workspaceState = computed(() => workspaceStore.state)
const activeTab = computed(() => workspaceStore.activeTab)
const activeTabTitle = computed(() => activeTab.value?.title ?? i18ns.t('workspace.placeholder'))

const workspaceStyle = computed(() => ({
  width: `${workspaceState.value.rect.width}px`,
  height: `${workspaceState.value.rect.height}px`,
  maxWidth: '80vw',
  maxHeight: '80vh',
  right: `${workspaceState.value.rect.right}px`,
  bottom: `${workspaceState.value.rect.bottom}px`,
}))

const dragState = ref<{
  pointerId: number
  startX: number
  startY: number
  right: number
  bottom: number
} | null>(null)

const resizeState = ref<{
  pointerId: number
  startX: number
  startY: number
  width: number
  height: number
  right: number
  bottom: number
} | null>(null)

const activePointerTarget = ref<HTMLElement | null>(null)

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const getViewportSizeLimits = () => ({
  maxWidth: Math.max(0, Math.floor(window.innerWidth * 0.8)),
  maxHeight: Math.max(0, Math.floor(window.innerHeight * 0.8)),
})

const openDocs = () => {
  const routeName =
    typeof router.currentRoute.value.name === 'string' ? router.currentRoute.value.name : null
  workspaceStore.openDocs(routeName)
}

const openSwagger = async () => {
  const accessLink = await swaggerDocsService.generateAccessLink()
  const backendBaseUrl = (import.meta.env.VITE_BACKEND_URL || window.location.origin).replace(
    /\/$/,
    '',
  )
  const protectedUrl = swaggerDocsService.buildDocsUrl(`${backendBaseUrl}/docs`, accessLink.reurl)
  const src = new URL(protectedUrl)
  src.searchParams.set('embed', '1')
  workspaceStore.openSwagger(src.toString())
}

const closeWorkspace = () => {
  workspaceStore.hide()
}

const onPointerMove = (event: PointerEvent) => {
  if (dragState.value && event.pointerId === dragState.value.pointerId) {
    const nextRight = clamp(
      dragState.value.right - (event.clientX - dragState.value.startX),
      12,
      Math.max(window.innerWidth - 240, 12),
    )
    const nextBottom = clamp(
      dragState.value.bottom - (event.clientY - dragState.value.startY),
      12,
      Math.max(window.innerHeight - 80, 12),
    )
    workspaceStore.updateRect({ right: nextRight, bottom: nextBottom })
  }

  if (resizeState.value && event.pointerId === resizeState.value.pointerId) {
    const deltaX = event.clientX - resizeState.value.startX
    const deltaY = event.clientY - resizeState.value.startY
    const { maxWidth, maxHeight } = getViewportSizeLimits()
    const nextWidth = clamp(
      resizeState.value.width + deltaX,
      0,
      Math.min(Math.max(resizeState.value.width + resizeState.value.right - 12, 0), maxWidth),
    )
    const nextHeight = clamp(
      resizeState.value.height + deltaY,
      0,
      Math.min(Math.max(resizeState.value.height + resizeState.value.bottom - 12, 0), maxHeight),
    )
    const nextRight = clamp(
      resizeState.value.right - (nextWidth - resizeState.value.width),
      12,
      Math.max(window.innerWidth - 12, 12),
    )
    const nextBottom = clamp(
      resizeState.value.bottom - (nextHeight - resizeState.value.height),
      12,
      Math.max(window.innerHeight - 12, 12),
    )
    workspaceStore.updateRect({
      width: nextWidth,
      height: nextHeight,
      right: nextRight,
      bottom: nextBottom,
    })
  }
}

const clearPointerTracking = () => {
  const pointerId = dragState.value?.pointerId ?? resizeState.value?.pointerId ?? null
  if (activePointerTarget.value) {
    activePointerTarget.value.removeEventListener('lostpointercapture', onPointerUp)
    if (pointerId !== null && activePointerTarget.value.hasPointerCapture(pointerId)) {
      activePointerTarget.value.releasePointerCapture(pointerId)
    }
  }

  activePointerTarget.value = null
  dragState.value = null
  resizeState.value = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  window.removeEventListener('blur', onPointerUp)
}

const onPointerUp = () => {
  clearPointerTracking()
}

const startPointerTracking = () => {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('blur', onPointerUp)
}

const capturePointer = (event: PointerEvent) => {
  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  if (!target) {
    return
  }

  activePointerTarget.value?.removeEventListener('lostpointercapture', onPointerUp)
  activePointerTarget.value = target
  target.addEventListener('lostpointercapture', onPointerUp)

  if (!target.hasPointerCapture(event.pointerId)) {
    target.setPointerCapture(event.pointerId)
  }
}

const onPointerDown = (event: PointerEvent) => {
  if (event.button !== 0) {
    return
  }

  event.preventDefault()
  clearPointerTracking()

  dragState.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    right: workspaceState.value.rect.right,
    bottom: workspaceState.value.rect.bottom,
  }
  capturePointer(event)
  startPointerTracking()
}

const onHeaderPointerDown = (event: PointerEvent) => {
  const target = event.target instanceof HTMLElement ? event.target : null
  if (target?.closest('button, a, input, textarea, select, [role="button"]')) {
    return
  }

  onPointerDown(event)
}

const onResizePointerDown = (event: PointerEvent) => {
  if (event.button !== 0) {
    return
  }

  event.preventDefault()
  clearPointerTracking()

  resizeState.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    width: workspaceState.value.rect.width,
    height: workspaceState.value.rect.height,
    right: workspaceState.value.rect.right,
    bottom: workspaceState.value.rect.bottom,
  }
  capturePointer(event)
  startPointerTracking()
}

onBeforeUnmount(() => {
  clearPointerTracking()
})
</script>

<style scoped>
.floating-workspace {
  position: fixed;
  z-index: 1900;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 6px;
  overflow: hidden;
  background: var(--el-bg-color);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
}

.floating-workspace__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 56px;
  padding: 0 14px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  user-select: none;
}

.floating-workspace__title-group {
  min-width: 0;
  display: grid;
  cursor: move;
}

.floating-workspace__title {
  font-size: 13px;
  font-weight: 600;
}

.floating-workspace__subtitle {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.floating-workspace__actions,
.floating-workspace__toolbar-actions,
.floating-workspace__empty-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.workspace-action,
.workspace-link-button,
.workspace-icon-button {
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 6px;
  background: var(--el-bg-color);
  color: inherit;
  cursor: pointer;
}

.workspace-action,
.workspace-link-button {
  min-height: 32px;
  padding: 0 10px;
}

.workspace-icon-button {
  width: 32px;
  height: 32px;
  font-size: 18px;
}

.floating-workspace__body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.floating-workspace__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  background: var(--el-fill-color-lighter);
}

.floating-workspace__tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow-x: auto;
}

.workspace-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 6px;
  background: var(--el-bg-color);
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.workspace-tab.is-active {
  background: var(--el-fill-color-light);
  border-color: rgba(148, 163, 184, 0.28);
}

.workspace-tab__close {
  font-size: 14px;
  line-height: 1;
}

.floating-workspace__frame-shell {
  min-height: 0;
  background: var(--el-bg-color-page);
}

.floating-workspace__frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
  background: #fff;
}

.floating-workspace__empty {
  height: 100%;
  display: grid;
  place-content: center;
  gap: 12px;
  text-align: center;
  padding: 24px;
}

.floating-workspace__empty h3,
.floating-workspace__empty p {
  margin: 0;
}

.floating-workspace__resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  user-select: none;
  background: linear-gradient(
    135deg,
    transparent 0 46%,
    rgba(148, 163, 184, 0.55) 46% 54%,
    transparent 54%
  );
}
</style>
