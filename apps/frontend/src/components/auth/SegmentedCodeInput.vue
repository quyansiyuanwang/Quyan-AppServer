<template>
  <div class="segmented-input" :class="{ 'is-disabled': disabled }" @paste="handlePaste">
    <template v-for="(cell, index) in cells" :key="index">
      <input
        :ref="(el) => setInputRef(el, index)"
        class="seg-cell"
        :value="cell"
        :disabled="disabled"
        :inputmode="allowAlphanumeric ? 'text' : 'numeric'"
        autocomplete="one-time-code"
        :aria-label="`${resolvedAriaLabel} ${index + 1}`"
        :aria-describedby="ariaDescribedby"
        maxlength="1"
        @focus="handleFocus(index)"
        @input="onCellInput(index, $event)"
        @keydown="onCellKeydown(index, $event)"
      />
      <span
        v-if="hasSeparator && index === computedSeparatorIndex - 1"
        class="seg-separator"
        aria-hidden="true"
      >
        -
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    length?: number
    disabled?: boolean
    allowAlphanumeric?: boolean
    uppercase?: boolean
    separatorIndex?: number
    autofocus?: boolean
    ariaLabel?: string
    ariaDescribedby?: string
  }>(),
  {
    length: 6,
    disabled: false,
    allowAlphanumeric: false,
    uppercase: false,
    autofocus: false,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'complete', value: string): void
  (e: 'enter'): void
}>()

const inputRefs = ref<Array<HTMLInputElement | null>>([])

const resolvedAriaLabel = computed(() => props.ariaLabel || 'verification code')

const hasSeparator = computed(
  () =>
    typeof props.separatorIndex === 'number' &&
    props.separatorIndex > 0 &&
    props.separatorIndex < props.length,
)

const computedSeparatorIndex = computed(() => props.separatorIndex ?? props.length)

const normalizeCompact = (value: string): string => {
  let normalized = props.allowAlphanumeric
    ? value.replace(/[^a-zA-Z0-9]/g, '')
    : value.replace(/\D/g, '')

  if (normalized.length > props.length) {
    normalized = normalized.slice(0, props.length)
  }

  if (props.uppercase) normalized = normalized.toUpperCase()

  return normalized
}

const formatValue = (compact: string): string => {
  if (!hasSeparator.value) return compact
  const separatorIndex = computedSeparatorIndex.value
  if (compact.length <= separatorIndex) return compact
  return `${compact.slice(0, separatorIndex)}-${compact.slice(separatorIndex)}`
}

const compactValue = computed(() => normalizeCompact(props.modelValue || ''))

const cells = computed(() =>
  Array.from({ length: props.length }, (_, index) => compactValue.value[index] || ''),
)

const emitValue = (compact: string) => {
  const normalizedCompact = normalizeCompact(compact)
  const value = formatValue(normalizedCompact)
  emit('update:modelValue', value)

  if (normalizedCompact.length === props.length) {
    emit('complete', value)
  }
}

const setInputRef = (el: Element | { $el?: Element } | null, index: number) => {
  const htmlElement = (el && '$el' in el ? el.$el : el) as HTMLInputElement | null
  inputRefs.value[index] = htmlElement
}

const focusIndex = (index: number) => {
  const clamped = Math.max(0, Math.min(index, props.length - 1))
  const input = inputRefs.value[clamped]
  if (!input) return
  input.focus()
  input.select()
}

const focusFirstInput = async () => {
  if (props.disabled) return
  await nextTick()
  focusIndex(0)
}

const handleFocus = (index: number) => {
  const input = inputRefs.value[index]
  if (input) input.select()
}

const onCellInput = (index: number, event: Event) => {
  if (props.disabled) return

  const target = event.target as HTMLInputElement
  const nextChar = normalizeCompact(target.value).slice(-1)

  const chars = Array.from({ length: props.length }, (_, i) => compactValue.value[i] || '')
  chars[index] = nextChar || ''

  emitValue(chars.join(''))

  if (nextChar && index < props.length - 1) {
    focusIndex(index + 1)
  }
}

const onCellKeydown = (index: number, event: KeyboardEvent) => {
  if (props.disabled) return

  if (event.key === 'Backspace') {
    event.preventDefault()

    const chars = Array.from({ length: props.length }, (_, i) => compactValue.value[i] || '')
    const removeIndex = chars[index] ? index : index - 1
    if (removeIndex < 0) return

    chars[removeIndex] = ''
    emitValue(chars.join(''))
    focusIndex(removeIndex)
    return
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    focusIndex(index - 1)
    return
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    focusIndex(index + 1)
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    emit('enter')
  }
}

const handlePaste = (event: ClipboardEvent) => {
  if (props.disabled) return

  const text = event.clipboardData?.getData('text') || ''
  const compact = normalizeCompact(text)
  if (!compact) return

  event.preventDefault()
  emitValue(compact)
  focusIndex(Math.min(compact.length, props.length) - 1)
}

onMounted(() => {
  if (props.autofocus) {
    void focusFirstInput()
  }
})

watch(
  () => ({ autofocus: props.autofocus, disabled: props.disabled }),
  (current, previous) => {
    if (!current.autofocus || current.disabled) return
    if (
      !previous ||
      previous.autofocus !== current.autofocus ||
      previous.disabled !== current.disabled
    ) {
      void focusFirstInput()
    }
  },
)

defineExpose({
  focusFirstInput,
})
</script>

<style scoped>
.segmented-input {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
}

.seg-cell {
  width: 46px;
  height: 50px;
  border: 1px solid var(--surface-control-border);
  border-radius: 10px;
  background: var(--surface-control-bg);
  color: var(--color-heading);
  text-align: center;
  font-size: 24px;
  line-height: 1;
  font-weight: 650;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  text-transform: uppercase;
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.seg-cell:focus {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8);
  transform: translateY(-1px);
}

.seg-cell:disabled {
  opacity: 0.72;
  cursor: not-allowed;
}

.seg-separator {
  color: var(--el-text-color-secondary);
  font-size: 24px;
  line-height: 1;
  font-weight: 600;
}

.is-disabled {
  opacity: 0.86;
}

@media (max-width: 768px) {
  .segmented-input {
    gap: 6px;
  }

  .seg-cell {
    width: 40px;
    height: 44px;
    font-size: 20px;
    border-radius: 9px;
  }

  .seg-separator {
    font-size: 20px;
  }
}
</style>
