<script setup lang="ts">
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import { useLoginOrRegisterContext } from '../context'

const state = useLoginOrRegisterContext()
const policyDialogVisible = state.policyDialogVisible
const policyDialogLoading = state.policyDialogLoading
const policyTabs = state.policyTabs
const policyActiveTab = state.policyActiveTab
const policyDialogRequireConfirmation = state.policyDialogRequireConfirmation
const policyConsentChecked = state.policyConsentChecked
const policyDialogSubmitting = state.policyDialogSubmitting
</script>

<template>
  <el-dialog
    v-model="policyDialogVisible"
    :title="$t('loginOrRegisterPage.legalPolicyDialogTitle')"
    width="min(960px, calc(100vw - 32px))"
    destroy-on-close
  >
    <el-skeleton :loading="policyDialogLoading" animated :rows="10">
      <template #default>
        <div v-if="policyTabs.some((item) => item.policy)" class="policy-dialog-content">
          <el-tabs v-model="policyActiveTab" stretch>
            <el-tab-pane
              v-for="item in policyTabs"
              :key="item.name"
              :name="item.name"
              :label="item.label"
            >
              <template v-if="item.policy">
                <div class="policy-meta">
                  <span>
                    {{
                      $t('loginOrRegisterPage.policyVersion', {
                        version: item.policy.version,
                      })
                    }}
                  </span>
                </div>
                <MarkdownRenderer :content="item.policy.content" />
              </template>
              <el-empty v-else :description="$t('loginOrRegisterPage.noPublishedPolicies')" />
            </el-tab-pane>
          </el-tabs>
        </div>
        <el-empty v-else :description="$t('loginOrRegisterPage.noPublishedPolicies')" />
      </template>
    </el-skeleton>

    <template #footer>
      <div class="policy-dialog-footer">
        <el-checkbox v-if="policyDialogRequireConfirmation" v-model="policyConsentChecked">
          {{ $t('loginOrRegisterPage.readAndAgree') }}
        </el-checkbox>
        <span v-else />
        <div class="policy-dialog-actions">
          <el-button @click="state.closePolicyDialog">{{ $t('close') }}</el-button>
          <el-button
            v-if="policyDialogRequireConfirmation"
            type="primary"
            :loading="policyDialogSubmitting"
            @click="state.confirmPolicyConsentAndContinue"
          >
            {{ $t('loginOrRegisterPage.consentConfirm') }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>
