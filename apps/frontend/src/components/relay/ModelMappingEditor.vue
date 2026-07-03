<template>
  <div class="model-mapping-editor">
    <el-alert
      v-if="totalWarnings > 0"
      :title="i18ns.t('relay.modelMappingConflictBanner', { count: totalWarnings })"
      type="warning"
      show-icon
      :closable="false"
      class="mb-2"
    />
    <el-table :data="entries" size="small" border max-height="300">
      <el-table-column :label="i18ns.t('relay.modelMappingSource')" min-width="220">
        <template #default="{ row, $index }">
          <div class="flex items-center gap-1">
            <el-input
              v-model="row.source"
              size="small"
              :placeholder="i18ns.t('relay.modelMappingSourcePlaceholder')"
              clearable
            />
            <el-tooltip
              v-if="rowWarnings[$index]?.length"
              :content="rowWarnings[$index].join('; ')"
              placement="top"
              :show-after="200"
            >
              <span class="text-amber-400 cursor-pointer shrink-0 text-sm font-bold">⚠️</span>
            </el-tooltip>
          </div>
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.modelMappingTarget')" min-width="200">
        <template #default="{ row }">
          <el-select
            v-model="row.target"
            size="small"
            filterable
            allow-create
            default-first-option
            clearable
            :placeholder="i18ns.t('relay.modelMappingTargetPlaceholder')"
          >
            <el-option v-for="m in resolvedAvailableModels" :key="m" :label="m" :value="m" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.modelMappingAction')" width="80">
        <template #default="{ $index }">
          <el-button type="danger" size="small" @click="removeEntry($index)">
            {{ i18ns.t('delete') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="mt-2 flex items-center gap-2">
      <el-button size="small" @click="addEntry">
        + {{ i18ns.t('relay.modelMappingAdd') }}
      </el-button>
      <el-button size="small" @click="copyAsJson">
        {{ i18ns.t('relay.modelMappingCopyJson') }}
      </el-button>
      <el-button size="small" @click="addIdentityMappings">
        {{ i18ns.t('relay.modelMappingAddIdentity') }}
      </el-button>
    </div>
    <div class="mt-1 text-[#909399] text-xs leading-relaxed">
      {{ i18ns.t('relay.modelMappingWildcardHelp') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { i18ns } from '@/locales'
import { copyTextWithFallback } from '@/utils/clipboard'

// ── Wildcard overlap detection (matches backend logic) ──

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const regexStr = escaped.replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${regexStr}$`)
}

function countLiteralChars(pattern: string): number {
  let count = 0
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== '*' && pattern[i] !== '?') count++
  }
  return count
}

/**
 * Heuristic check: do two wildcard patterns potentially overlap?
 * Constructs a sample input from each pattern (replace ? with 'x', remove *)
 * and checks if it matches the other pattern.
 */
function patternsPotentiallyOverlap(p1: string, p2: string): boolean {
  const sample1 = p1.replace(/\?/g, 'x').replace(/\*/g, '')
  const sample2 = p2.replace(/\?/g, 'x').replace(/\*/g, '')
  const re1 = patternToRegex(p1)
  const re2 = patternToRegex(p2)
  return re1.test(sample2) || re2.test(sample1)
}

interface MappingEntry {
  source: string
  target: string
}

const props = withDefaults(
  defineProps<{
    modelValue?: Record<string, string>
    availableModels?: string[]
  }>(),
  {
    modelValue: () => ({}),
    availableModels: () => [],
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, string>): void
}>()

// Flatten available models that might be objects with a model key
const resolvedAvailableModels = computed<string[]>(() => {
  return props.availableModels.map((m: string | unknown) => {
    if (typeof m === 'object' && m !== null && 'model' in (m as Record<string, unknown>)) {
      return String((m as Record<string, unknown>).model)
    }
    return String(m)
  })
})

/** Detect patterns that may be overshadowed by more specific ones. */
const overlapWarnings = computed<Record<number, string[]>>(() => {
  const warnings: Record<number, string[]> = {}
  const items = entries.value
  for (let i = 0; i < items.length; i++) {
    const entry = items[i]
    if (!entry) continue
    const p1 = entry.source?.trim()
    if (!p1) continue
    const lit1 = countLiteralChars(p1)
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue
      const other = items[j]
      if (!other) continue
      const p2 = other.source?.trim()
      if (!p2) continue
      const lit2 = countLiteralChars(p2)
      // If p2 is more specific and their match domains overlap, p1 might be overshadowed
      if (lit2 > lit1 && patternsPotentiallyOverlap(p1, p2)) {
        ;(warnings[i] ??= []).push(
          i18ns.t('relay.modelMappingOverlapWarning', { less: p1, more: p2 }),
        )
      }
    }
  }
  return warnings
})

/** Detect duplicate source patterns — earlier entries are silently overridden. */
const duplicateWarnings = computed<Record<number, string[]>>(() => {
  const warnings: Record<number, string[]> = {}
  const seen = new Map<string, number>()
  const items = entries.value
  for (let i = 0; i < items.length; i++) {
    const source = items[i]?.source?.trim()
    if (!source) continue
    if (seen.has(source)) {
      // The earlier occurrence will be overridden
      const earlierIdx = seen.get(source)!
      ;(warnings[earlierIdx] ??= []).push(
        i18ns.t('relay.modelMappingDuplicateSource', { pattern: source }),
      )
    }
    seen.set(source, i)
  }
  return warnings
})

/** Combined warnings per row (overlap + duplicate). */
const rowWarnings = computed<Record<number, string[]>>(() => {
  const combined: Record<number, string[]> = {}
  for (const [idx, msgs] of Object.entries(overlapWarnings.value)) {
    combined[Number(idx)] = [...msgs]
  }
  for (const [idx, msgs] of Object.entries(duplicateWarnings.value)) {
    ;(combined[Number(idx)] ??= []).push(...msgs)
  }
  return combined
})

const totalWarnings = computed(() => Object.keys(rowWarnings.value).length)

function mappingToEntries(mapping: Record<string, string>): MappingEntry[] {
  return Object.entries(mapping).map(([source, target]) => ({
    source,
    target,
  }))
}

function entriesToMapping(entries: MappingEntry[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const entry of entries) {
    if (entry.source.trim()) {
      mapping[entry.source.trim()] = entry.target.trim()
    }
  }
  return mapping
}

const entries = ref<MappingEntry[]>(mappingToEntries(props.modelValue))

let updating = false

watch(
  () => props.modelValue,
  (newVal) => {
    if (updating) return
    entries.value = mappingToEntries(newVal ?? {})
  },
  { deep: true },
)

watch(
  entries,
  (newEntries) => {
    updating = true
    emit('update:modelValue', entriesToMapping(newEntries))
    setTimeout(() => {
      updating = false
    }, 0)
  },
  { deep: true },
)

async function copyAsJson(): Promise<void> {
  const mapping = entriesToMapping(entries.value)
  const json = JSON.stringify(mapping, null, 2)
  const copied = await copyTextWithFallback(json)
  if (!copied) {
    ElMessage.error(i18ns.t('copyFailed'))
    return
  }
  ElMessage.success(i18ns.t('copySuccess'))
}

function addEntry(): void {
  entries.value.push({ source: '', target: '' })
}

function removeEntry(index: number): void {
  entries.value.splice(index, 1)
}

function addIdentityMappings(): void {
  const existingSources = new Set(entries.value.map((e) => e.source.trim()).filter(Boolean))
  for (const model of resolvedAvailableModels.value) {
    if (!existingSources.has(model)) {
      entries.value.push({ source: model, target: model })
    }
  }
}
</script>
