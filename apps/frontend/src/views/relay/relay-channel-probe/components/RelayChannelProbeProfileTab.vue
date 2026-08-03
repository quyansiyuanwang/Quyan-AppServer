<template>
  <el-form label-position="top" class="profile-form" @submit.prevent="saveProfile">
    <div class="profile-editor-layout">
      <div class="profile-editor-main">
        <section class="profile-section">
          <header class="profile-section-header">
            <div>
              <strong>{{ i18ns.t('relay.channelProbeRequestSpec') }}</strong>
              <span>{{ i18ns.t('relay.channelProbeRequestSpecHelp') }}</span>
            </div>
            <el-switch
              v-model="form.enabled"
              :disabled="!canExecute"
              :active-text="i18ns.t('productConsole.enabled')"
            />
          </header>
          <div class="request-config-grid">
            <el-form-item :label="i18ns.t('relay.channelProbeFormat')"
              ><el-select v-model="form.probeFormat" :disabled="!canExecute"
                ><el-option
                  value="openai"
                  label="OpenAI"
                  :disabled="!isProbeFormatAvailable('openai')" /><el-option
                  value="anthropic"
                  label="Anthropic"
                  :disabled="!isProbeFormatAvailable('anthropic')" /><el-option
                  value="gemini"
                  label="Gemini"
                  :disabled="!isProbeFormatAvailable('gemini')" /></el-select
            ></el-form-item>
            <el-form-item class="request-model-field" :label="i18ns.t('relay.channelProbeModel')"
              ><el-select
                v-model="form.probeModel"
                filterable
                :allow-create="selectedProbeModels.length === 0"
                :disabled="!canExecute"
                :placeholder="i18ns.t('relay.channelProbeModelPlaceholder')"
                ><el-option
                  v-for="model in selectedProbeModels"
                  :key="model"
                  :value="model"
                  :label="model" /></el-select
            ></el-form-item>
            <el-form-item :label="i18ns.t('relay.channelProbeEndpoint')">
              <el-select v-model="form.probeEndpoint" :disabled="!canExecute">
                <el-option
                  v-for="endpoint in probeEndpointOptions"
                  :key="endpoint"
                  :value="endpoint"
                  :label="probeEndpointLabel(endpoint)"
                />
              </el-select>
              <span class="probe-form-help">{{ probeEndpointHelp }}</span>
            </el-form-item>
          </div>
          <div class="calibration-config-grid">
            <el-form-item :label="i18ns.t('relay.channelProbeSampleCount')">
              <el-input-number
                v-model="form.sampleCount"
                :min="1"
                :max="10"
                :step="1"
                :precision="0"
                :disabled="!canExecute"
              />
              <span class="probe-form-help">{{
                i18ns.t('relay.channelProbeSampleCountHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('relay.channelProbeStrictCalibrationValidation')">
              <el-switch v-model="form.strictCalibrationValidation" :disabled="!canExecute" />
              <span class="probe-form-help">{{
                i18ns.t('relay.channelProbeStrictCalibrationValidationHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('relay.channelProbeMeasurementInputTokens')">
              <el-input-number
                v-model="form.measurementInputTokens"
                :min="0"
                :max="32768"
                :step="128"
                :precision="0"
                :disabled="!canExecute"
              />
              <span class="probe-form-help">{{
                i18ns.t('relay.channelProbeMeasurementInputTokensHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('relay.channelProbeBalanceSettlementTolerance')">
              <el-input-number
                v-model="form.balanceSettlementTolerance"
                :min="0.000001"
                :max="1000000"
                :step="0.000001"
                :precision="6"
                :disabled="!canExecute"
              />
              <span class="probe-form-help">{{
                i18ns.t('relay.channelProbeBalanceSettlementToleranceHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('relay.channelProbeBalanceSettlementReads')">
              <el-input-number
                v-model="form.balanceSettlementReads"
                :min="2"
                :max="5"
                :step="1"
                :precision="0"
                :disabled="!canExecute"
              />
              <span class="probe-form-help">{{
                i18ns.t('relay.channelProbeBalanceSettlementReadsHelp')
              }}</span>
            </el-form-item>
          </div>
          <el-form-item class="cache-buster-switch" :label="i18ns.t('relay.channelProbeCacheMode')">
            <el-select v-model="form.cacheMode" :disabled="!canExecute">
              <el-option value="cache-bust" :label="i18ns.t('relay.channelProbeCacheModeBust')" />
              <el-option value="allow-cache" :label="i18ns.t('relay.channelProbeCacheModeAllow')" />
              <el-option
                value="warm-and-read"
                :label="i18ns.t('relay.channelProbeCacheModeWarm')"
              />
            </el-select>
            <span class="probe-form-help">{{ cacheModeHelp }}</span>
          </el-form-item>
          <div class="payload-preset-action">
            <el-button plain :disabled="!canExecute" @click="applyPayloadPreset">
              {{ i18ns.t('relay.channelProbeApplyPreset') }}
            </el-button>
          </div>
          <el-collapse class="advanced-payload">
            <el-collapse-item :title="i18ns.t('relay.channelProbePayloadAdvanced')" name="payload">
              <el-form-item :label="i18ns.t('relay.channelProbePayload')">
                <el-input
                  v-model="payloadText"
                  type="textarea"
                  :rows="7"
                  :disabled="!canExecute"
                  :placeholder="i18ns.t('relay.channelProbePayloadHelp')"
                />
              </el-form-item>
            </el-collapse-item>
          </el-collapse>
        </section>

        <section class="profile-section">
          <header class="profile-section-header">
            <div>
              <strong>{{ i18ns.t('relay.channelProbeCalibration') }}</strong>
              <span>{{ i18ns.t('relay.channelProbeCalibrationHelp') }}</span>
            </div>
          </header>
          <div class="calibration-config-grid">
            <el-form-item :label="i18ns.t('relay.channelProbeUpstreamCurrency')"
              ><el-input
                v-model.trim="form.upstreamCurrency"
                maxlength="12"
                :disabled="!canExecute"
            /></el-form-item>
            <el-form-item :label="i18ns.t('relay.channelProbeLocalCurrency')"
              ><el-input v-model.trim="form.localCurrency" maxlength="12" :disabled="!canExecute"
            /></el-form-item>
            <el-form-item :label="i18ns.t('relay.channelProbeBalanceDivisor')"
              ><el-input-number
                v-model="form.upstreamBalanceDivisor"
                :min="0.000001"
                :max="1000000000"
                :step="0.000001"
                :precision="6"
                :disabled="!canExecute"
            /></el-form-item>
            <el-form-item :label="i18ns.t('relay.channelProbeUpstreamRate')"
              ><el-input-number
                v-model="form.upstreamRateMultiplier"
                :min="0.000001"
                :max="1000"
                :step="0.000001"
                :precision="6"
                :disabled="!canExecute"
            /></el-form-item>
            <el-form-item :label="i18ns.t('relay.channelProbeDistribution')"
              ><el-input-number
                v-model="form.distributionMultiplier"
                :min="0.000001"
                :max="1000"
                :step="0.000001"
                :precision="6"
                :disabled="!canExecute"
            /></el-form-item>
            <el-form-item :label="i18ns.t('relay.channelProbeGroup')"
              ><el-input
                v-model.trim="form.probeGroup"
                clearable
                maxlength="80"
                :disabled="!canExecute"
                :placeholder="i18ns.t('relay.channelProbeGroupPlaceholder')"
            /></el-form-item>
          </div>
        </section>

        <div class="section-heading">
          <strong>{{ i18ns.t('relay.channelProbeWorkflow') }}</strong
          ><span>{{ i18ns.t('relay.channelProbeWorkflowHelp') }}</span
          ><el-button
            v-if="canExecute"
            link
            type="primary"
            :disabled="workflowSteps.length >= 3"
            @click="addWorkflowStep"
            >{{ i18ns.t('relay.channelProbeAddStep') }}</el-button
          >
        </div>
        <el-empty
          v-if="workflowSteps.length === 0"
          :description="i18ns.t('relay.channelProbeWorkflowEmpty')"
          :image-size="56"
        />
        <section v-for="(step, index) in workflowSteps" :key="step.id" class="workflow-step">
          <header class="workflow-step-header">
            <div class="workflow-step-title">
              <span class="workflow-step-number">{{ index + 1 }}</span>
              <strong>{{ i18ns.t('relay.channelProbeWorkflowStep', { index: index + 1 }) }}</strong>
              <el-tag effect="plain" size="small">{{ step.method }}</el-tag>
            </div>
            <el-button
              v-if="canExecute"
              link
              type="danger"
              :disabled="workflowSteps.length === 1"
              @click="removeWorkflowStep(index)"
              >{{ i18ns.t('delete') }}</el-button
            >
          </header>
          <div class="workflow-route-grid">
            <el-form-item :label="i18ns.t('relay.channelProbeStepName')"
              ><el-input v-model.trim="step.name" :disabled="!canExecute"
            /></el-form-item>
            <el-form-item :label="i18ns.t('relay.channelProbeMethod')"
              ><el-select v-model="step.method" :disabled="!canExecute"
                ><el-option value="GET" label="GET" /><el-option
                  value="POST"
                  label="POST" /></el-select
            ></el-form-item>
            <el-form-item class="workflow-url-field" :label="i18ns.t('relay.channelProbeUrl')"
              ><el-input
                v-model.trim="step.url"
                :disabled="!canExecute"
                placeholder="https://api.example.com/balance"
            /></el-form-item>
          </div>
          <div class="workflow-balance-row">
            <el-form-item :label="i18ns.t('relay.channelProbeBalancePath')"
              ><el-input
                v-model.trim="step.balancePath"
                :disabled="!canExecute"
                placeholder="data.balance"
            /></el-form-item>
            <p>{{ i18ns.t('relay.channelProbeBalancePathHint') }}</p>
          </div>
          <el-collapse v-model="step.openSections" class="workflow-collapse">
            <el-collapse-item name="request">
              <template #title>
                <div class="workflow-collapse-title">
                  <strong>{{ i18ns.t('relay.channelProbeRequestOptions') }}</strong>
                  <span>{{
                    i18ns.t('relay.channelProbeRequestOptionsSummary', {
                      headers: step.headers.length,
                      query: step.query.length,
                      body: step.body.length,
                    })
                  }}</span>
                </div>
              </template>
              <div class="workflow-request-grid">
                <el-form-item :label="i18ns.t('relay.channelProbeHeaders')"
                  ><ProbeKeyValueEditor
                    v-model="step.headers"
                    :disabled="!canExecute"
                    :empty-text="i18ns.t('relay.channelProbeNoFields')"
                    :key-placeholder="i18ns.t('relay.channelProbeFieldName')"
                    :value-placeholder="i18ns.t('relay.channelProbeHeaderValue')"
                /></el-form-item>
                <el-form-item :label="i18ns.t('relay.channelProbeQuery')"
                  ><ProbeKeyValueEditor
                    v-model="step.query"
                    :disabled="!canExecute"
                    :empty-text="i18ns.t('relay.channelProbeNoFields')"
                    :key-placeholder="i18ns.t('relay.channelProbeFieldName')"
                    :value-placeholder="i18ns.t('relay.channelProbeQueryValue')"
                /></el-form-item>
                <el-form-item
                  v-if="step.method === 'POST' || step.body.length"
                  :label="i18ns.t('relay.channelProbeBody')"
                  class="workflow-body-field"
                  ><ProbeKeyValueEditor
                    v-model="step.body"
                    :disabled="!canExecute"
                    value-mode="json"
                    :empty-text="i18ns.t('relay.channelProbeNoFields')"
                    :key-placeholder="i18ns.t('relay.channelProbeFieldName')"
                    :value-placeholder="i18ns.t('relay.channelProbeBodyValue')"
                /></el-form-item>
              </div>
            </el-collapse-item>
            <el-collapse-item name="response">
              <template #title>
                <div class="workflow-collapse-title">
                  <strong>{{ i18ns.t('relay.channelProbeResponseOptions') }}</strong>
                  <span>{{
                    i18ns.t('relay.channelProbeResponseOptionsSummary', {
                      extract: step.extract.length,
                    })
                  }}</span>
                </div>
              </template>
              <el-form-item :label="i18ns.t('relay.channelProbeExtract')"
                ><ProbeKeyValueEditor
                  v-model="step.extract"
                  :disabled="!canExecute"
                  :empty-text="i18ns.t('relay.channelProbeNoFields')"
                  :key-placeholder="i18ns.t('relay.channelProbeVariableName')"
                  :value-placeholder="i18ns.t('relay.channelProbeJsonPath')"
              /></el-form-item>
            </el-collapse-item>
          </el-collapse>
        </section>

        <div class="section-heading">
          <strong>{{ i18ns.t('relay.channelProbeCredentials') }}</strong
          ><span>{{ i18ns.t('relay.channelProbeCredentialsHelp') }}</span
          ><el-button v-if="canExecute" link type="primary" @click="addCredential()">{{
            i18ns.t('relay.channelProbeAddCredential')
          }}</el-button>
        </div>
        <el-alert
          v-if="credentialNames.length"
          type="info"
          :closable="false"
          class="mb-3"
          :title="
            i18ns.t('relay.channelProbeSavedCredentials', {
              names: credentialNames.join(', '),
            })
          "
        />
        <div v-for="(credential, index) in credentials" :key="credential.id" class="credential-row">
          <el-input
            v-model.trim="credential.name"
            :disabled="!canExecute"
            :placeholder="i18ns.t('relay.channelProbeCredentialName')"
          /><el-input
            v-model="credential.value"
            type="password"
            show-password
            :disabled="!canExecute"
            :placeholder="i18ns.t('relay.channelProbeCredentialValue')"
          /><el-button
            v-if="canExecute"
            :icon="Delete"
            circle
            plain
            type="danger"
            @click="credentials.splice(index, 1)"
          />
        </div>
        <div class="profile-actions">
          <el-button v-if="canExecute" native-type="submit" type="primary" :loading="saving">{{
            i18ns.t('save')
          }}</el-button>
          <el-button
            v-if="canExecute && selected?.profile"
            native-type="button"
            type="danger"
            plain
            :loading="clearingProfile"
            @click="confirmClearProfile"
            >{{ i18ns.t('relay.channelProbeClearProfile') }}</el-button
          >
        </div>
      </div>

      <aside class="probe-helper-panel">
        <section class="helper-section">
          <h3>{{ i18ns.t('relay.channelProbeGuide') }}</h3>
          <p>{{ i18ns.t('relay.channelProbeGuideDescription') }}</p>
          <el-button v-if="canExecute" type="primary" plain @click="applyPayloadPreset">
            {{ i18ns.t('relay.channelProbeApplyPreset') }}
          </el-button>
        </section>
        <section class="helper-section configuration-checklist">
          <h3>{{ i18ns.t('relay.channelProbeChecklist') }}</h3>
          <p>{{ i18ns.t('relay.channelProbeChecklistHelp') }}</p>
          <div class="checklist-item">
            <el-tag :type="form.probeModel.trim() ? 'success' : 'warning'" size="small">
              {{
                i18ns.t(
                  form.probeModel.trim()
                    ? 'relay.channelProbeCheckReady'
                    : 'relay.channelProbeCheckNeeded',
                )
              }}
            </el-tag>
            <span>{{ i18ns.t('relay.channelProbeModelCheck') }}</span>
          </div>
          <div class="checklist-item">
            <el-tag :type="balancePathCount === 1 ? 'success' : 'warning'" size="small">
              {{
                i18ns.t(
                  balancePathCount === 1
                    ? 'relay.channelProbeCheckReady'
                    : 'relay.channelProbeCheckNeeded',
                )
              }}
            </el-tag>
            <span>{{ i18ns.t('relay.channelProbeBalancePathCheck') }}</span>
          </div>
          <div class="checklist-item">
            <el-tag :type="currenciesMatch ? 'success' : 'info'" size="small">
              {{
                i18ns.t(
                  currenciesMatch
                    ? 'relay.channelProbeCheckReady'
                    : 'relay.channelProbeCurrencyManual',
                )
              }}
            </el-tag>
            <span>{{ i18ns.t('relay.channelProbeCurrencyCheck') }}</span>
          </div>
          <div class="checklist-item">
            <el-tag type="info" size="small">/</el-tag>
            <span>{{
              i18ns.t('relay.channelProbeDivisorCheck', {
                divisor: formatNumber(form.upstreamBalanceDivisor),
              })
            }}</span>
          </div>
          <div class="checklist-item">
            <el-tag type="info" size="small">×</el-tag>
            <span>{{
              i18ns.t('relay.channelProbeUpstreamRateCheck', {
                rate: formatNumber(form.upstreamRateMultiplier),
                distribution: formatNumber(form.distributionMultiplier),
              })
            }}</span>
          </div>
          <div class="checklist-item">
            <el-tag :type="form.probeGroup.trim() ? 'info' : 'success'" size="small">
              {{
                i18ns.t(
                  form.probeGroup.trim()
                    ? 'relay.channelProbeGrouped'
                    : 'relay.channelProbeUngrouped',
                )
              }}
            </el-tag>
            <span>{{ i18ns.t('relay.channelProbeGroupCheck') }}</span>
          </div>
        </section>
        <section class="helper-section credential-guide">
          <h3>{{ i18ns.t('relay.channelProbeCredentialChecklist') }}</h3>
          <p>{{ i18ns.t('relay.channelProbeCredentialChecklistHelp') }}</p>
          <el-empty
            v-if="requiredCredentialStates.length === 0"
            :description="i18ns.t('relay.channelProbeNoCredentialReferences')"
            :image-size="36"
          />
          <div v-else class="credential-requirement-list">
            <div
              v-for="credential in requiredCredentialStates"
              :key="credential.name"
              class="credential-requirement"
            >
              <code>{{ variableTemplate(credential.name) }}</code>
              <el-tag :type="credential.type" size="small">{{ credential.label }}</el-tag>
              <el-button
                v-if="credential.missing && canExecute"
                link
                type="primary"
                @click="addCredential(credential.name)"
                >{{ i18ns.t('relay.channelProbeAddCredential') }}</el-button
              >
            </div>
          </div>
        </section>
        <section class="helper-section">
          <h3>{{ i18ns.t('relay.channelProbeVariables') }}</h3>
          <p>{{ i18ns.t('relay.channelProbeVariablesHelp') }}</p>
          <div v-if="availableVariables.length" class="variable-tags">
            <el-tag
              v-for="name in availableVariables"
              :key="name"
              class="variable-tag"
              @click="copyVariable(name)"
              >{{ variableTemplate(name) }}</el-tag
            >
          </div>
          <el-empty
            v-else
            :description="i18ns.t('relay.channelProbeNoVariables')"
            :image-size="36"
          />
        </section>
        <section class="helper-section">
          <h3>{{ i18ns.t('relay.channelProbeReuse') }}</h3>
          <p>{{ i18ns.t('relay.channelProbeReuseHelp') }}</p>
          <div class="reuse-actions">
            <el-button :icon="Download" plain @click="downloadConfiguration">
              {{ i18ns.t('relay.channelProbeExport') }}
            </el-button>
            <el-button :icon="CopyDocument" plain @click="copyConfiguration">
              {{ i18ns.t('relay.channelProbeCopy') }}
            </el-button>
            <el-button :icon="Upload" plain @click="openImportDialog">
              {{ i18ns.t('relay.channelProbeImport') }}
            </el-button>
          </div>
        </section>
      </aside>
    </div>
  </el-form>
</template>

<script setup lang="ts">
import { CopyDocument, Delete, Download, Upload } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import ProbeKeyValueEditor from '../../components/ProbeKeyValueEditor.vue'
import { useRelayChannelProbeManagementContext } from '../context'

const {
  addCredential,
  addWorkflowStep,
  applyPayloadPreset,
  availableVariables,
  balancePathCount,
  cacheModeHelp,
  canExecute,
  clearingProfile,
  confirmClearProfile,
  copyConfiguration,
  copyVariable,
  credentialNames,
  credentials,
  currenciesMatch,
  downloadConfiguration,
  form,
  formatNumber,
  isProbeFormatAvailable,
  openImportDialog,
  payloadText,
  probeEndpointHelp,
  probeEndpointLabel,
  probeEndpointOptions,
  requiredCredentialStates,
  removeWorkflowStep,
  saving,
  saveProfile,
  selected,
  selectedProbeModels,
  variableTemplate,
  workflowSteps,
} = useRelayChannelProbeManagementContext()
</script>
