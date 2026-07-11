<script setup lang="ts">
import { Connection, CopyDocument, Link } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { useApiDocumentationContext } from '../context'

const state = useApiDocumentationContext()
const aiBaseUrl = state.aiBaseUrl
const displayOpenaiEndpoint = state.displayOpenaiEndpoint
const displayAnthropicEndpoint = state.displayAnthropicEndpoint
const displayGeminiEndpoint = state.displayGeminiEndpoint
const relayUsageEndpoint = state.relayUsageEndpoint
const platformBalanceEndpoint = state.platformBalanceEndpoint
const balanceFields = state.balanceFields
const showFullEndpoint = state.showFullEndpoint
const copyText = state.copyText
const t = i18ns.t as (key: string, params?: Record<string, unknown>) => string
</script>

<template>
  <div
    style="
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      gap: 12px;
      flex-wrap: wrap;
    "
  >
    <el-alert type="info" :closable="false" style="flex: 1; min-width: 0">
      <template #title>
        <strong>{{ t('apiDoc.endpointNote') }}</strong>
      </template>
      {{ t('apiDoc.endpointDesc') }}
    </el-alert>
    <div style="display: flex; align-items: center; gap: 8px; white-space: nowrap">
      <span style="font-size: 14px; color: var(--el-text-color-regular)">
        {{ t('apiDoc.showFullEndpoint') }}
      </span>
      <el-switch v-model="showFullEndpoint" />
    </div>
  </div>

  <el-descriptions :column="1" border>
    <el-descriptions-item>
      <template #label>
        <div class="label-with-icon">
          <el-icon><Link /></el-icon>
          <span>{{ t('apiDoc.baseUrl') }}</span>
        </div>
      </template>
      <div class="endpoint-content">
        <el-text tag="code" class="endpoint-code">{{ aiBaseUrl }}</el-text>
        <el-button
          :icon="CopyDocument"
          size="small"
          @click="copyText(aiBaseUrl)"
          type="primary"
          text
        />
      </div>
    </el-descriptions-item>

    <el-descriptions-item>
      <template #label>
        <div class="label-with-icon">
          <el-icon><Connection /></el-icon>
          <span>{{ t('apiDoc.openaiEndpoint') }}</span>
        </div>
      </template>
      <div class="endpoint-content">
        <el-text tag="code" class="endpoint-code">{{ displayOpenaiEndpoint }}</el-text>
        <el-button
          :icon="CopyDocument"
          size="small"
          @click="copyText(displayOpenaiEndpoint)"
          type="primary"
          text
        />
      </div>
      <div class="endpoint-note">{{ t('apiDoc.openaiNote') }}</div>
    </el-descriptions-item>

    <el-descriptions-item>
      <template #label>
        <div class="label-with-icon">
          <el-icon><Connection /></el-icon>
          <span>{{ t('apiDoc.anthropicEndpoint') }}</span>
        </div>
      </template>
      <div class="endpoint-content">
        <el-text tag="code" class="endpoint-code">{{ displayAnthropicEndpoint }}</el-text>
        <el-button
          :icon="CopyDocument"
          size="small"
          @click="copyText(displayAnthropicEndpoint)"
          type="primary"
          text
        />
      </div>
      <div class="endpoint-note">{{ t('apiDoc.anthropicNote') }}</div>
    </el-descriptions-item>

    <el-descriptions-item>
      <template #label>
        <div class="label-with-icon">
          <el-icon><Connection /></el-icon>
          <span>{{ t('apiDoc.geminiEndpoint') }}</span>
        </div>
      </template>
      <div class="endpoint-content">
        <el-text tag="code" class="endpoint-code">{{ displayGeminiEndpoint }}</el-text>
        <el-button
          :icon="CopyDocument"
          size="small"
          @click="copyText(displayGeminiEndpoint)"
          type="primary"
          text
        />
      </div>
      <div class="endpoint-note">{{ t('apiDoc.geminiNote') }}</div>
    </el-descriptions-item>

    <el-descriptions-item>
      <template #label>
        <div class="label-with-icon">
          <el-icon><Connection /></el-icon>
          <span>{{ t('apiDoc.balanceEndpoint') }}</span>
        </div>
      </template>
      <div class="endpoint-content">
        <el-text tag="code" class="endpoint-code">{{ relayUsageEndpoint }}</el-text>
        <el-button
          :icon="CopyDocument"
          size="small"
          @click="copyText(relayUsageEndpoint)"
          type="primary"
          text
        />
      </div>
      <div class="endpoint-note">{{ t('apiDoc.balanceNote') }}</div>
      <div style="margin-top: 12px">
        <div style="font-weight: 600; margin-bottom: 8px; font-size: 14px">
          {{ t('apiDoc.platformBalanceEndpoint') }}
        </div>
        <div class="endpoint-content">
          <el-text tag="code" class="endpoint-code">{{ platformBalanceEndpoint }}</el-text>
          <el-button
            :icon="CopyDocument"
            size="small"
            @click="copyText(platformBalanceEndpoint)"
            type="primary"
            text
          />
        </div>
        <div class="endpoint-note">{{ t('apiDoc.platformBalanceNote') }}</div>
      </div>
      <div style="margin-top: 16px">
        <div style="font-weight: 600; margin-bottom: 8px; font-size: 14px">
          {{ t('apiDoc.balanceResponseFields') }}
        </div>
        <el-alert type="info" :closable="false" style="margin-bottom: 12px">
          {{ t('apiDoc.balanceFieldsNote') }}
        </el-alert>
        <el-table :data="balanceFields" size="small" border stripe>
          <el-table-column prop="field" :label="t('field')" width="150">
            <template #default="{ row }">
              <el-text tag="code" type="primary">{{ row.field }}</el-text>
            </template>
          </el-table-column>
          <el-table-column prop="description" :label="t('description')">
            <template #default="{ row }">
              {{ row.description }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-descriptions-item>
  </el-descriptions>
</template>
