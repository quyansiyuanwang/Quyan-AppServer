<template>
  <div class="message-input">
    <div class="selects-row">
      <el-select
        class="selector"
        v-model="selectedToken"
        :placeholder="i18ns.t('chat.selectToken')"
        :disabled="sending || !tokens.length"
      >
        <el-option
          v-for="token in tokens"
          :key="token.id"
          :label="token.name || token.token"
          :value="token.id"
        />
      </el-select>
      <el-select
        class="selector"
        v-model="selectedModel"
        :placeholder="i18ns.t('chat.selectModel')"
        :disabled="sending || !availableModels.length"
      >
        <el-option v-for="model in availableModels" :key="model" :label="model" :value="model" />
      </el-select>
    </div>
    <el-input
      v-model="content"
      type="textarea"
      :rows="3"
      :placeholder="i18ns.t('chat.inputPlaceholder')"
      :disabled="sending"
      @keydown.enter.exact="handleEnter"
    />
    <el-button
      v-if="sending"
      class="send-btn"
      type="danger"
      plain
      @click="$emit('stop')"
      >{{ i18ns.t('chat.stop') }}</el-button
    >
    <el-button
      v-else
      class="send-btn"
      type="primary"
      :disabled="!content.trim() || !selectedModel"
      @click="handleSend"
      >{{ i18ns.t('chat.send') }}</el-button
    >
    >
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { ChatToken } from '@/types/chat'
import { i18ns } from '@/locales'
import StorageKey from '@/constant/storagekey'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { getScopedStorageKey } from '@/utils/storageScope'

const props = defineProps<{
  tokens: ChatToken[]
  sending?: boolean
}>()

const emit = defineEmits<{
  send: [content: string, model: string, tokenId?: string]
  stop: []
}>()

const content = ref('')
const selectedTokenStorageKey = getScopedStorageKey(StorageKey.Chat.SELECTED_TOKEN_ID)
const selectedModelStorageKey = getScopedStorageKey(StorageKey.Chat.SELECTED_MODEL)
const selectedToken = ref<string | null>(TypedLocalStorage.getItem(selectedTokenStorageKey))
const selectedModel = ref(TypedLocalStorage.getItem(selectedModelStorageKey) || '')

watch(
  () => props.tokens,
  (tokens) => {
    if (!tokens.length) {
      selectedToken.value = null
      selectedModel.value = ''
      return
    }

    const hasSelectedToken = tokens.some((token) => token.id === selectedToken.value)
    const firstToken = tokens[0]
    if (!hasSelectedToken && firstToken) {
      selectedToken.value = firstToken.id
    }
  },
  { immediate: true },
)

const availableModels = computed(() => {
  const token = props.tokens.find((t) => t.id === selectedToken.value)
  if (!token?.allowedModels) return []
  return token.allowedModels
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
})

watch(
  availableModels,
  (models) => {
    if (!models.length) {
      selectedModel.value = ''
      return
    }
    if (!models.includes(selectedModel.value)) {
      selectedModel.value = models[0] || ''
    }
  },
  { immediate: true },
)

watch(
  selectedToken,
  (tokenId) => {
    if (tokenId) TypedLocalStorage.setItem(selectedTokenStorageKey, tokenId)
    else TypedLocalStorage.removeItem(selectedTokenStorageKey)
  },
  { immediate: true },
)

watch(
  selectedModel,
  (model) => {
    if (model) TypedLocalStorage.setItem(selectedModelStorageKey, model)
    else TypedLocalStorage.removeItem(selectedModelStorageKey)
  },
  { immediate: true },
)

function handleSend() {
  if (props.sending) return
  if (!content.value.trim() || !selectedModel.value) return
  emit('send', content.value, selectedModel.value, selectedToken.value || undefined)
  content.value = ''
}

function handleEnter(event: KeyboardEvent) {
  if (event.isComposing) return
  event.preventDefault()
  handleSend()
}
</script>

<style scoped>
.message-input {
  padding: 16px;
  border-top: 1px solid var(--color-border);
  background: var(--surface-card-bg);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.selects-row {
  display: flex;
  gap: 8px;
}

.selector {
  width: 200px;
}

.send-btn {
  align-self: flex-end;
}

@media (max-width: 768px) {
  .message-input {
    padding: 12px 12px calc(12px + env(safe-area-inset-bottom));
    gap: 10px;
  }

  .selects-row {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .selector {
    width: 100%;
  }

  .send-btn {
    width: 100%;
    align-self: stretch;
  }
}
</style>
