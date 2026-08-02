<template>
  <div class="conversation-list">
    <div class="header">
      <el-button type="primary" @click="$emit('create')">{{
        i18ns.t('chat.newConversation')
      }}</el-button>
    </div>
    <el-scrollbar class="list">
      <div
        v-for="conv in conversations"
        :key="conv.id"
        :class="['item', { active: current?.id === conv.id }]"
        @click="handleSelect(conv.id)"
      >
        <div class="title">{{ conv.title || i18ns.t('chat.newConversationTitle') }}</div>
        <div class="actions">
          <el-button size="small" text @click.stop="$emit('rename', conv.id, conv.title || null)">
            {{ i18ns.t('chat.rename') }}
          </el-button>
          <el-button type="danger" size="small" text @click.stop="$emit('delete', conv.id)">
            {{ i18ns.t('chat.delete') }}
          </el-button>
        </div>
      </div>
      <div v-if="hasMore" class="load-more">
        <el-button text :loading="loading" @click="$emit('load-more')">{{
          i18ns.t('chat.loadMore')
        }}</el-button>
      </div>
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import type { Conversation } from '@/types/chat'
import { i18ns } from '@/locales'

const props = defineProps<{
  conversations: Conversation[]
  current: Conversation | null
  hasMore?: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  create: []
  rename: [id: string, title: string | null]
  delete: [id: string]
  'load-more': []
}>()

function handleSelect(id: string) {
  if (props.current?.id === id) return
  emit('select', id)
}
</script>

<style scoped>
.conversation-list {
  width: min(280px, 100%);
  border-left: 1px solid var(--el-border-color);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.header {
  padding: 16px;
  border-bottom: 1px solid var(--el-border-color);
}
.list {
  flex: 1;
  min-height: 0;
}
.item {
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid var(--el-border-color-lighter);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.item:hover {
  background: var(--el-fill-color-light);
}
.item.active {
  background: var(--el-color-primary-light-9);
}
.title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
}
.load-more {
  display: flex;
  justify-content: center;
  padding: 10px;
}

@media (max-width: 768px) {
  .conversation-list {
    border-left: none;
  }

  .header {
    padding: 14px 12px;
  }

  .item {
    min-height: 52px;
    padding: 10px 12px;
  }
}
</style>
