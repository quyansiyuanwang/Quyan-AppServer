<script setup lang="ts">
import { ref, useId } from 'vue'
import { ElPopover } from 'element-plus'
import type { RelayCatalogModelMappingDto } from '@/client/types.gen'
import { i18ns } from '@/locales'

const props = defineProps<{
  mappings: RelayCatalogModelMappingDto[]
  onCopy: (model: string) => void
  channelName?: string
  getHighlightParts?: (rawText?: string) => { text: string; matched: boolean }[]
}>()

const visible = ref(false)
const titleId = useId()
const t = i18ns.t
const isPattern = (source: string) => /[*?]/.test(source)
const highlightParts = (source: string) =>
  props.getHighlightParts?.(source) ?? [{ text: source, matched: false }]
</script>

<template>
  <ElPopover
    v-if="mappings.length"
    v-model:visible="visible"
    trigger="click"
    role="dialog"
    :aria-labelledby="titleId"
    placement="bottom-start"
    :width="440"
    :teleported="true"
    :persistent="false"
    :popper-style="{
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100dvh - 32px)',
      overflowY: 'auto',
    }"
  >
    <template #reference>
      <button type="button" class="model-mappings-marker" :aria-expanded="visible" @click.stop>
        {{ t('relay.catalogMappingMarker') }} ({{ mappings.length }})
      </button>
    </template>

    <section class="model-mappings-details" @click.stop>
      <h3 :id="titleId" class="model-mappings-title">
        {{ t('relay.catalogMappingTitle')
        }}<template v-if="channelName"> · {{ channelName }}</template>
      </h3>
      <p class="model-mappings-hint">{{ t('relay.catalogMappingBillingHint') }}</p>
      <p class="model-mappings-hint">{{ t('relay.catalogMappingTokenHint') }}</p>
      <ul class="model-mappings-list">
        <li v-for="(mapping, index) in mappings" :key="index" class="model-mapping">
          <div class="model-mapping-route">
            <div class="model-mapping-source">
              <span class="model-mapping-label">{{ t('relay.catalogMappingSource') }}</span>
              <code
                ><template
                  v-for="(part, partIndex) in highlightParts(mapping.requestModelPattern)"
                  :key="partIndex"
                  ><mark v-if="part.matched" class="highlight-match">{{ part.text }}</mark
                  ><template v-else>{{ part.text }}</template></template
                ></code
              >
              <span v-if="isPattern(mapping.requestModelPattern)" class="model-mappings-hint">
                {{ t('relay.catalogMappingPatternHint') }}
              </span>
              <button
                v-else
                type="button"
                class="model-mapping-copy"
                :aria-label="
                  t('relay.catalogMappingCopySource', { model: mapping.requestModelPattern })
                "
                @click.stop="onCopy(mapping.requestModelPattern)"
              >
                {{ t('copy') }}
              </button>
            </div>
            <span aria-hidden="true">→</span>
            <div class="model-mapping-target">
              <span class="model-mapping-label">{{ t('relay.catalogMappingBillingModel') }}</span>
              <span>{{ mapping.catalogModelName }}</span>
              <code>{{ mapping.billingModelId }}</code>
            </div>
          </div>
          <p class="model-mapping-formats">
            {{ t('relay.catalogMappingFormats') }}: {{ mapping.supportedRequestFormats.join(', ') }}
          </p>
          <p v-if="mapping.excludedRequestModelPatterns?.length" class="model-mapping-exclusions">
            {{ t('relay.catalogMappingExclusions') }}:
            <code>{{ mapping.excludedRequestModelPatterns.join(', ') }}</code>
          </p>
        </li>
      </ul>
    </section>
  </ElPopover>
</template>

<style scoped>
.model-mappings-marker,
.model-mapping-copy {
  color: var(--el-color-primary);
  font: inherit;
  cursor: pointer;
}

.model-mappings-marker {
  max-width: 100%;
  padding: 2px 6px;
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 4px;
  background: var(--el-color-primary-light-9);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  text-align: start;
}

.model-mappings-marker:focus-visible,
.model-mapping-copy:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.model-mappings-details {
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: 1.5;
}

.model-mappings-title {
  margin: 0 0 8px;
  color: var(--el-text-color-primary);
  font-size: 14px;
}

.model-mappings-hint {
  margin: 4px 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.model-mappings-list {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.model-mapping {
  padding: 10px 0;
  border-top: 1px solid var(--el-border-color-lighter);
}

.model-mapping-route {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: start;
  gap: 8px;
}

.model-mapping-source,
.model-mapping-target {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.model-mapping-label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.model-mapping-copy {
  padding: 2px 0;
  border: 0;
  background: transparent;
  font-size: 12px;
}

.model-mapping-formats,
.model-mapping-exclusions {
  margin: 8px 0 0;
  font-size: 12px;
}

.highlight-match {
  border-radius: 3px;
  background: var(--el-color-warning-light-7);
  color: inherit;
}
</style>
