<script setup lang="ts">
import { CopyDocument } from '@element-plus/icons-vue'
import { useApiDocumentationContext } from '../context'

const state = useApiDocumentationContext()
const displayAnthropicEndpoint = state.displayAnthropicEndpoint
const platformBalanceEndpoint = state.platformBalanceEndpoint
const relayUsageEndpoint = state.relayUsageEndpoint
const ccswitchBalanceSample = state.ccswitchBalanceSample
const copyText = state.copyText
</script>

<template>
  <el-steps direction="vertical" :active="5" finish-status="success">
    <el-step :title="$t('apiDoc.step1Title')">
      <template #description>
        <div class="step-content">
          <p>{{ $t('apiDoc.step1Desc') }}</p>
          <el-button type="primary" size="small" @click="state.goRelayTokenManagement">
            {{ $t('apiDoc.goToTokens') }}
          </el-button>
        </div>
      </template>
    </el-step>
    <el-step :title="$t('apiDoc.step2Title')">
      <template #description>
        <div class="step-content">
          <p>{{ $t('apiDoc.step2Desc') }}</p>
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
        </div>
      </template>
    </el-step>
    <el-step :title="$t('apiDoc.step3Title')">
      <template #description>
        <div class="step-content">
          <p>{{ $t('apiDoc.step3Desc') }}</p>
          <div class="code-example">
            <pre>Authorization: Bearer YOUR_TOKEN_HERE</pre>
          </div>
        </div>
      </template>
    </el-step>
    <el-step :title="$t('apiDoc.step4Title')">
      <template #description>
        <div class="step-content">
          {{ $t('apiDoc.step4Desc') }}
        </div>
      </template>
    </el-step>
    <el-step :title="$t('apiDoc.step5Title')">
      <template #description>
        <div class="step-content">
          <div class="step-content">
            <p>{{ $t('apiDoc.step5Desc1') }}</p>
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
          </div>
          <p>{{ $t('apiDoc.step5Desc2') }}</p>
          <p>{{ $t('apiDoc.step5Desc3') }}</p>
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
          <el-button type="primary" size="small" @click="state.goSettingsSecurity">
            {{ $t('apiDoc.goToAccessKeys') }}
          </el-button>
          <div style="margin-top: 16px; display: flex; align-items: center; gap: 8px">
            <p style="font-weight: 600; margin: 0">{{ $t('apiDoc.ccswitchTemplate') }}:</p>
            <el-button
              :icon="CopyDocument"
              size="small"
              @click="copyText(ccswitchBalanceSample)"
              type="primary"
              text
            >
              {{ $t('button.copy') }}
            </el-button>
          </div>
          <div class="code-example">
            <pre>{{ ccswitchBalanceSample }}</pre>
          </div>
        </div>
      </template>
    </el-step>
  </el-steps>
</template>
