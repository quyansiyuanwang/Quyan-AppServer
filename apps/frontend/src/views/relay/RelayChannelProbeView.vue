<template>
  <main class="channel-probe-page">
    <header class="page-header">
      <div>
        <h1>{{ i18ns.t('relay.channelProbeTitle') }}</h1>
        <p>{{ i18ns.t('relay.channelProbeDescription') }}</p>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="loadOverview">{{
        i18ns.t('refresh')
      }}</el-button>
    </header>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="mb-4"
      :title="i18ns.t('relay.channelProbeQueueNotice')"
    />
    <el-alert v-if="pageError" type="error" :closable="false" show-icon class="mb-4">
      <template #default
        ><span>{{ pageError }}</span
        ><el-button link type="primary" @click="loadOverview">{{
          i18ns.t('reload')
        }}</el-button></template
      >
    </el-alert>

    <section class="probe-filters">
      <el-input
        v-model.trim="keyword"
        clearable
        :placeholder="i18ns.t('relay.channelProbeSearchPlaceholder')"
      />
      <el-select v-model="profileFilter">
        <el-option value="all" :label="i18ns.t('relay.channelProbeFilterAllProfiles')" />
        <el-option value="configured" :label="i18ns.t('relay.channelProbeFilterConfigured')" />
        <el-option value="unconfigured" :label="i18ns.t('relay.channelProbeFilterUnconfigured')" />
      </el-select>
      <el-select v-model="enabledFilter">
        <el-option value="all" :label="i18ns.t('relay.channelProbeFilterAllStates')" />
        <el-option value="enabled" :label="i18ns.t('relay.enabled')" />
        <el-option value="disabled" :label="i18ns.t('relay.disabled')" />
      </el-select>
      <el-select v-model="runStatusFilter">
        <el-option value="all" :label="i18ns.t('relay.channelProbeFilterAllRuns')" />
        <el-option value="none" :label="i18ns.t('relay.channelProbeFilterNoRuns')" />
        <el-option
          v-for="status in runStatuses"
          :key="status"
          :value="status"
          :label="statusLabel(status)"
        />
      </el-select>
      <el-select v-model="suggestionFilter">
        <el-option value="all" :label="i18ns.t('relay.channelProbeFilterAllSuggestions')" />
        <el-option value="applicable" :label="i18ns.t('relay.channelProbeFilterApplicable')" />
        <el-option
          value="not_applicable"
          :label="i18ns.t('relay.channelProbeFilterNotApplicable')"
        />
      </el-select>
    </section>
    <section class="probe-toolbar">
      <span class="selection-summary">{{
        i18ns.t('relay.channelProbeSelected', { count: selectedRows.length })
      }}</span>
      <el-button
        v-if="canExecute"
        type="primary"
        plain
        :disabled="runnableChannelIds.length === 0"
        :loading="batchRunning"
        @click="confirmBatchRun"
        >{{ i18ns.t('relay.channelProbeBatchRun') }}</el-button
      >
      <el-button
        v-if="canAdjust"
        type="success"
        plain
        :disabled="selectedRuns.length === 0"
        :loading="applying"
        @click="confirmApply(selectedRuns)"
        >{{ i18ns.t('relay.channelProbeBatchApply') }}</el-button
      >
    </section>
    <el-table
      ref="tableRef"
      v-loading="loading"
      :data="filteredItems"
      row-key="channelId"
      class="w-full"
      @selection-change="onSelectionChange"
    >
      <el-table-column type="selection" width="46" :selectable="canSelectRow" />
      <el-table-column prop="channelName" :label="i18ns.t('relay.channelName')" min-width="180" />
      <el-table-column :label="i18ns.t('status')" width="108"
        ><template #default="{ row }"
          ><el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{
            row.enabled ? i18ns.t('relay.enabled') : i18ns.t('relay.disabled')
          }}</el-tag></template
        ></el-table-column
      >
      <el-table-column :label="i18ns.t('relay.channelMultiplier')" width="120" align="right"
        ><template #default="{ row }">{{ row.multiplier }}x</template></el-table-column
      >
      <el-table-column :label="i18ns.t('relay.channelProbeConfigured')" width="126"
        ><template #default="{ row }"
          ><el-tag size="small" :type="row.profile ? 'success' : 'info'">{{
            row.profile ? i18ns.t('yes') : i18ns.t('no')
          }}</el-tag></template
        ></el-table-column
      >
      <el-table-column :label="i18ns.t('relay.channelProbeLatest')" min-width="132"
        ><template #default="{ row }">{{
          row.latestRun ? statusLabel(row.latestRun.status) : '-'
        }}</template></el-table-column
      >
      <el-table-column :label="i18ns.t('relay.channelProbeSuggestion')" width="80" align="right"
        ><template #default="{ row }">{{
          row.latestRun?.suggestedMultiplier == null ? '-' : `${row.latestRun.suggestedMultiplier}x`
        }}</template></el-table-column
      >
      <el-table-column :label="i18ns.t('actions')" fixed="right" width="360"
        ><template #default="{ row }">
          <el-button link type="primary" @click="openDrawer(row)">{{
            i18ns.t('relay.channelProbeManage')
          }}</el-button>
          <el-button
            v-if="canExecute"
            link
            type="primary"
            :disabled="!row.profile || !row.enabled"
            :loading="runningId === row.channelId"
            @click="run(row)"
            >{{ i18ns.t('relay.channelProbeRun') }}</el-button
          >
          <el-button
            v-if="canExecute"
            link
            type="warning"
            :loading="resettingChannelId === row.channelId"
            @click="confirmResetRunState(row)"
            >{{ i18ns.t('relay.channelProbeResetState') }}</el-button
          >
          <el-button
            v-if="canAdjust"
            link
            type="success"
            :disabled="!isApplicable(row.latestRun)"
            @click="confirmApply([row.latestRun!.id])"
            >{{ i18ns.t('relay.channelProbeApply') }}</el-button
          >
        </template></el-table-column
      >
      <template #empty
        ><el-empty :description="i18ns.t('relay.channelProbeNoStandalone')" :image-size="88"
      /></template>
    </el-table>

    <el-drawer
      v-model="drawerOpen"
      :title="selected?.channelName"
      direction="rtl"
      size="min(66vw, 100vw)"
      append-to-body
      destroy-on-close
      @closed="resetDrawer"
    >
      <el-tabs v-model="tab">
        <el-tab-pane :label="i18ns.t('relay.channelProbeProfile')" name="profile">
          <el-form label-position="top" class="profile-form" @submit.prevent="saveProfile">
            <div class="profile-editor-layout">
              <div class="profile-editor-main">
                <div class="form-grid">
                  <el-form-item :label="i18ns.t('productConsole.enabled')"
                    ><el-switch v-model="form.enabled" :disabled="!canExecute"
                  /></el-form-item>
                  <el-form-item :label="i18ns.t('relay.channelProbeFormat')"
                    ><el-select v-model="form.probeFormat" :disabled="!canExecute"
                      ><el-option
                        value="openai"
                        label="OpenAI"
                        :disabled="!isProbeFormatAvailable('openai')"
                      /><el-option
                        value="anthropic"
                        label="Anthropic"
                        :disabled="!isProbeFormatAvailable('anthropic')"
                      /><el-option
                        value="gemini"
                        label="Gemini"
                        :disabled="!isProbeFormatAvailable('gemini')"
                      /></el-select
                  ></el-form-item>
                  <el-form-item :label="i18ns.t('relay.channelProbeModel')"
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
                        :label="model"
                    /></el-select
                  ></el-form-item>
                  <el-form-item :label="i18ns.t('relay.channelProbeDistribution')"
                    ><el-input-number
                      v-model="form.distributionMultiplier"
                      :min="0.000001"
                      :max="1000"
                      :step="0.000001"
                      :precision="6"
                      :disabled="!canExecute"
                  /></el-form-item>
                  <el-form-item :label="i18ns.t('relay.channelProbeUpstreamCurrency')"
                    ><el-input
                      v-model.trim="form.upstreamCurrency"
                      maxlength="12"
                      :disabled="!canExecute"
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
                  <el-form-item :label="i18ns.t('relay.channelProbeGroup')"
                    ><el-input
                      v-model.trim="form.probeGroup"
                      clearable
                      maxlength="80"
                      :disabled="!canExecute"
                      :placeholder="i18ns.t('relay.channelProbeGroupPlaceholder')"
                  /></el-form-item>
                  <el-form-item :label="i18ns.t('relay.channelProbeLocalCurrency')"
                    ><el-input
                      v-model.trim="form.localCurrency"
                      maxlength="12"
                      :disabled="!canExecute"
                  /></el-form-item>
                </div>
                <el-collapse class="advanced-payload">
                  <el-collapse-item
                    :title="i18ns.t('relay.channelProbePayloadAdvanced')"
                    name="payload"
                  >
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
                <section
                  v-for="(step, index) in workflowSteps"
                  :key="step.id"
                  class="workflow-step"
                >
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
                  ><el-button v-if="canExecute" link type="primary" @click="addCredential">{{
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
                <div
                  v-for="(credential, index) in credentials"
                  :key="credential.id"
                  class="credential-row"
                >
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
                  <el-button
                    v-if="canExecute"
                    native-type="submit"
                    type="primary"
                    :loading="saving"
                    >{{ i18ns.t('save') }}</el-button
                  >
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
                      >{{ i18ns.t('relay.channelProbeAddCredential') }}</el-button>
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
        </el-tab-pane>
        <el-tab-pane :label="i18ns.t('relay.channelProbeRuns')" name="runs">
          <div class="runs-toolbar">
            <el-button :loading="runsLoading" @click="loadRuns">{{ i18ns.t('refresh') }}</el-button
            ><el-button
              v-if="canExecute"
              type="primary"
              :disabled="!selected?.profile"
              :loading="runningId === selected?.channelId"
              @click="selected && run(selected)"
              >{{ i18ns.t('relay.channelProbeRun') }}</el-button
            >
            <el-button
              v-if="canExecute && selected"
              type="warning"
              plain
              :loading="resettingChannelId === selected?.channelId"
              @click="selected && confirmResetRunState(selected)"
              >{{ i18ns.t('relay.channelProbeResetState') }}</el-button
            >
          </div>
          <el-empty
            v-if="!runsLoading && runs.length === 0"
            :description="i18ns.t('relay.channelProbeNoRuns')"
            :image-size="64"
          />
          <section v-for="runItem in runs" :key="runItem.id" class="run-card">
            <div class="run-title">
              <el-tag :type="statusType(runItem.status)">{{ statusLabel(runItem.status) }}</el-tag
              ><span>{{ formatDate(runItem.createTime) }}</span
              ><el-button
                v-if="canAdjust && isApplicable(runItem)"
                link
                type="success"
                @click="confirmApply([runItem.id])"
                >{{ i18ns.t('relay.channelProbeApply') }}</el-button
              >
            </div>
            <el-descriptions :column="2" border size="small"
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeBalanceBefore')">{{
                formatNumber(runItem.upstreamBalanceBefore)
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeBalanceAfter')">{{
                formatNumber(runItem.upstreamBalanceAfter)
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeUpstreamDelta')">{{
                formatNumber(runItem.upstreamBalanceDelta)
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeBaseCost')">{{
                formatNumber(runItem.baseLocalCost)
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeTokens')">{{
                runItem.totalTokens ?? '-'
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeSuggestion')">{{
                runItem.suggestedMultiplier == null ? '-' : `${runItem.suggestedMultiplier}x`
              }}</el-descriptions-item></el-descriptions
            >
            <p v-if="runItem.suggestedMultiplier != null" class="formula">
              {{
                i18ns.t('relay.channelProbeFormula', {
                  delta: formatNumber(runItem.upstreamBalanceDelta),
                  distribution: runItem.distributionMultiplier,
                  base: formatNumber(runItem.baseLocalCost),
                  suggested: runItem.suggestedMultiplier,
                })
              }}
            </p>
            <el-alert
              v-if="runItem.errorMessage"
              type="error"
              :closable="false"
              :title="runItem.errorMessage"
              class="mt-2"
            />
          </section>
        </el-tab-pane>
      </el-tabs>
      <el-dialog
        v-model="importDialogOpen"
        :title="i18ns.t('relay.channelProbeImport')"
        width="min(640px, 92vw)"
        append-to-body
        :close-on-click-modal="false"
      >
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          :title="i18ns.t('relay.channelProbeImportCredentialNotice')"
          class="mb-3"
        />
        <el-input
          v-model="importText"
          type="textarea"
          :rows="14"
          :placeholder="i18ns.t('relay.channelProbeImportPlaceholder')"
        />
        <input
          ref="importFileInput"
          class="hidden-file-input"
          type="file"
          accept="application/json,.json"
          @change="readImportFile"
        />
        <template #footer>
          <el-button :icon="Upload" @click="triggerImportFile">{{
            i18ns.t('relay.channelProbeImportFile')
          }}</el-button>
          <el-button @click="importDialogOpen = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" @click="applyImportedConfiguration">{{
            i18ns.t('relay.channelProbeImportApply')
          }}</el-button>
        </template>
      </el-dialog>
    </el-drawer>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CopyDocument, Delete, Download, Refresh, Upload } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { Permission } from '@/constant/permission'
import { usePermissionStore } from '@/stores/permissionStore'
import { getErrorMessage } from '@/utils/error-utils'
import { relayChannelProbeService } from '@/service/relayChannelProbeService'
import ProbeKeyValueEditor, { type ProbeKeyValueEntry } from './components/ProbeKeyValueEditor.vue'
import type { TableInstance } from 'element-plus'
import type {
  RelayChannelProbeFormat,
  RelayChannelProbeOverviewItemDto,
  RelayChannelProbeRunDto,
  RelayChannelProbeRunStatus,
  RelayChannelProbeWorkflowStepDto,
} from '@/client/types.gen'

interface WorkflowFormStep {
  id: string
  name: string
  method: 'GET' | 'POST'
  openSections: string[]
  url: string
  headers: ProbeKeyValueEntry[]
  query: ProbeKeyValueEntry[]
  body: ProbeKeyValueEntry[]
  extract: ProbeKeyValueEntry[]
  balancePath: string
}
interface CredentialFormRow {
  id: string
  name: string
  value: string
}
interface ProbeForm {
  enabled: boolean
  probeFormat: RelayChannelProbeFormat
  probeModel: string
  distributionMultiplier: number
  upstreamCurrency: string
  localCurrency: string
  upstreamBalanceDivisor: number
  probeGroup: string
}
interface ProbeProfileExport {
  version: 1
  type: 'relay-channel-probe-profile'
  profile: ProbeForm & {
    probePayload: Record<string, unknown>
    workflow: RelayChannelProbeWorkflowStepDto[]
  }
}
type CredentialRequirement = {
  name: string
  missing: boolean
  label: string
  type: 'success' | 'info' | 'warning'
}
const permissionStore = usePermissionStore()
const canExecute = computed(() =>
  permissionStore.hasPermission(Permission.RELAY_CHANNEL_PROBE_EXECUTE),
)
const canAdjust = computed(() =>
  permissionStore.hasPermission(Permission.RELAY_CHANNEL_MULTIPLIER_ADJUST),
)
const loading = ref(false)
const saving = ref(false)
const clearingProfile = ref(false)
const applying = ref(false)
const batchRunning = ref(false)
const runsLoading = ref(false)
const runningId = ref('')
const resettingChannelId = ref('')
const pageError = ref('')
const items = ref<RelayChannelProbeOverviewItemDto[]>([])
const selected = ref<RelayChannelProbeOverviewItemDto | null>(null)
const drawerOpen = ref(false)
const tab = ref('profile')
const runs = ref<RelayChannelProbeRunDto[]>([])
const selectedRows = ref<RelayChannelProbeOverviewItemDto[]>([])
const tableRef = ref<TableInstance>()
const keyword = ref('')
const profileFilter = ref<'all' | 'configured' | 'unconfigured'>('all')
const enabledFilter = ref<'all' | 'enabled' | 'disabled'>('enabled')
const runStatusFilter = ref<'all' | 'none' | RelayChannelProbeRunStatus>('all')
const suggestionFilter = ref<'all' | 'applicable' | 'not_applicable'>('all')
const runStatuses: RelayChannelProbeRunStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
]
const filteredItems = computed(() =>
  items.value.filter((item) => {
    const matchKeyword =
      !keyword.value ||
      [item.channelName, item.channelId].some((value) =>
        value.toLowerCase().includes(keyword.value.toLowerCase()),
      )
    const matchProfile =
      profileFilter.value === 'all' ||
      (profileFilter.value === 'configured' ? Boolean(item.profile) : !item.profile)
    const matchEnabled =
      enabledFilter.value === 'all' ||
      (enabledFilter.value === 'enabled' ? item.enabled : !item.enabled)
    const matchRun =
      runStatusFilter.value === 'all' ||
      (runStatusFilter.value === 'none'
        ? !item.latestRun
        : item.latestRun?.status === runStatusFilter.value)
    const matchSuggestion =
      suggestionFilter.value === 'all' ||
      (suggestionFilter.value === 'applicable'
        ? isApplicable(item.latestRun)
        : !isApplicable(item.latestRun))
    return matchKeyword && matchProfile && matchEnabled && matchRun && matchSuggestion
  }),
)
const selectedRuns = computed(() =>
  selectedRows.value.flatMap((row) => (isApplicable(row.latestRun) ? [row.latestRun!.id] : [])),
)
const selectedProbeFormats = computed(() => selected.value?.allowedProbeFormats ?? [])
const selectedProbeModels = computed(() => selected.value?.allowedProbeModels ?? [])
const runnableChannelIds = computed(() =>
  selectedRows.value.flatMap((row) => (isRunnable(row) ? [row.channelId] : [])),
)
const form = ref<ProbeForm>(emptyForm())
const payloadText = ref('{}')
const workflowSteps = ref<WorkflowFormStep[]>([])
const credentials = ref<CredentialFormRow[]>([])
const credentialNames = ref<string[]>([])
const importDialogOpen = ref(false)
const importText = ref('')
const importFileInput = ref<HTMLInputElement>()
const balancePathCount = computed(
  () => workflowSteps.value.filter((step) => Boolean(step.balancePath.trim())).length,
)
const currenciesMatch = computed(
  () =>
    Boolean(
      form.value.upstreamCurrency.trim() &&
        form.value.localCurrency.trim() &&
        form.value.upstreamCurrency.trim().toUpperCase() === form.value.localCurrency.trim().toUpperCase(),
    ),
)
const extractedVariableNames = computed(
  () =>
    new Set(
      workflowSteps.value.flatMap((step) =>
        step.extract.map((entry) => entry.key.trim()).filter(Boolean),
      ),
    ),
)
const requiredCredentialStates = computed<CredentialRequirement[]>(() => {
  const referenced = new Set<string>()
  collectVariableReferences(payloadText.value, referenced)
  for (const step of workflowSteps.value) {
    collectVariableReferences(step.url, referenced)
    for (const field of [...step.headers, ...step.query, ...step.body])
      collectVariableReferences(field.value, referenced)
  }
  const saved = new Set(credentialNames.value)
  const draft = new Set(
    credentials.value.filter((credential) => Boolean(credential.value)).map((credential) => credential.name.trim()),
  )
  return Array.from(referenced)
    .filter((name) => !extractedVariableNames.value.has(name))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      if (saved.has(name))
        return {
          name,
          missing: false,
          label: i18ns.t('relay.channelProbeCredentialSavedStatus'),
          type: 'success' as const,
        }
      if (draft.has(name))
        return {
          name,
          missing: false,
          label: i18ns.t('relay.channelProbeCredentialDraftStatus'),
          type: 'info' as const,
        }
      return {
        name,
        missing: true,
        label: i18ns.t('relay.channelProbeCredentialMissingStatus'),
        type: 'warning' as const,
      }
    })
})
const availableVariables = computed(() =>
  Array.from(
    new Set([
      ...credentialNames.value,
      ...credentials.value.map((credential) => credential.name.trim()).filter(Boolean),
      ...workflowSteps.value.flatMap((step) =>
        step.extract.map((entry) => entry.key.trim()).filter(Boolean),
      ),
    ]),
  ),
)
let overviewRequest = 0
let runsRequest = 0
let pollTimer: ReturnType<typeof setInterval> | undefined

function emptyForm(): ProbeForm {
  return {
    enabled: true,
    probeFormat: 'openai',
    probeModel: '',
    distributionMultiplier: 1,
    upstreamCurrency: 'CNY',
    localCurrency: 'CNY',
    upstreamBalanceDivisor: 1,
    probeGroup: '',
  }
}
function isProbeFormatAvailable(format: RelayChannelProbeFormat) {
  return selectedProbeFormats.value.length === 0 || selectedProbeFormats.value.includes(format)
}
function makeStep(): WorkflowFormStep {
  return {
    id: crypto.randomUUID(),
    name: 'balance',
    method: 'GET',
    openSections: [],
    url: '',
    headers: [],
    query: [],
    body: [],
    extract: [],
    balancePath: 'balance',
  }
}
function addWorkflowStep() {
  if (workflowSteps.value.length < 3) workflowSteps.value.push(makeStep())
}
function removeWorkflowStep(index: number) {
  workflowSteps.value.splice(index, 1)
}
function addCredential(name = '') {
  const normalizedName = name.trim()
  if (normalizedName && credentials.value.some((credential) => credential.name.trim() === normalizedName)) return
  credentials.value.push({ id: crypto.randomUUID(), name: normalizedName, value: '' })
}
function variableTemplate(name: string) {
  return `{{${name}}}`
}
function collectVariableReferences(value: string, output: Set<string>) {
  const expression = /\{\{\s*([A-Za-z][A-Za-z0-9_]{0,49})\s*\}\}/g
  for (const match of value.matchAll(expression)) output.add(match[1]!)
}
async function copyVariable(name: string) {
  try {
    await navigator.clipboard.writeText(variableTemplate(name))
    ElMessage.success(i18ns.t('relay.channelProbeVariableCopied'))
  } catch {
    ElMessage.warning(i18ns.t('relay.channelProbeVariableCopyFailed'))
  }
}
function applyPayloadPreset() {
  const prompt = 'Reply with OK.'
  const preset =
    form.value.probeFormat === 'anthropic'
      ? { max_tokens: 1, messages: [{ role: 'user', content: prompt }] }
      : form.value.probeFormat === 'gemini'
        ? { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1 } }
        : { messages: [{ role: 'user', content: prompt }], max_tokens: 1 }
  payloadText.value = JSON.stringify(preset, null, 2)
  ElMessage.success(i18ns.t('relay.channelProbePresetApplied'))
}
function createProfileExport(): ProbeProfileExport {
  return {
    version: 1,
    type: 'relay-channel-probe-profile',
    profile: {
      ...form.value,
      probePayload: parseObject(payloadText.value, i18ns.t('relay.channelProbePayload')),
      workflow: formWorkflow(),
    },
  }
}
function serializeProfileExport(): string | undefined {
  try {
    return JSON.stringify(createProfileExport(), null, 2)
  } catch (error) {
    ElMessage.warning(getErrorMessage(error, i18ns.t('operationFailed')))
    return undefined
  }
}
function downloadConfiguration() {
  const content = serializeProfileExport()
  if (!content) return
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const channelName = (selected.value?.channelName || 'channel').replace(/[^A-Za-z0-9_-]+/g, '-')
  link.href = url
  link.download = `relay-probe-${channelName}.json`
  link.click()
  URL.revokeObjectURL(url)
  ElMessage.success(i18ns.t('relay.channelProbeExported'))
}
async function copyConfiguration() {
  const content = serializeProfileExport()
  if (!content) return
  try {
    await navigator.clipboard.writeText(content)
    ElMessage.success(i18ns.t('relay.channelProbeCopied'))
  } catch {
    ElMessage.warning(i18ns.t('relay.channelProbeCopyFailed'))
  }
}
function openImportDialog() {
  importText.value = ''
  importDialogOpen.value = true
}
function triggerImportFile() {
  importFileInput.value?.click()
}
async function readImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    importText.value = await file.text()
  } catch {
    ElMessage.error(i18ns.t('relay.channelProbeImportInvalid'))
  }
}
function parseImportedProfile(): ProbeProfileExport['profile'] {
  try {
    const parsed: unknown = JSON.parse(importText.value)
    if (!parsed || typeof parsed !== 'object') throw new Error()
    const source = ('profile' in parsed ? parsed.profile : parsed) as Partial<
      ProbeProfileExport['profile']
    >
    if (
      !source ||
      !['openai', 'anthropic', 'gemini'].includes(String(source.probeFormat)) ||
      typeof source.probeModel !== 'string' ||
      !source.probePayload ||
      typeof source.probePayload !== 'object' ||
      Array.isArray(source.probePayload) ||
      !Array.isArray(source.workflow)
    )
      throw new Error()
    return {
      enabled: source.enabled !== false,
      probeFormat: source.probeFormat as RelayChannelProbeFormat,
      probeModel: source.probeModel,
      distributionMultiplier: Number(source.distributionMultiplier) || 1,
      upstreamCurrency:
        typeof source.upstreamCurrency === 'string' ? source.upstreamCurrency : 'CNY',
      localCurrency: typeof source.localCurrency === 'string' ? source.localCurrency : 'CNY',
      upstreamBalanceDivisor: validBalanceDivisor(source.upstreamBalanceDivisor),
      probeGroup: typeof source.probeGroup === 'string' ? source.probeGroup.trim() : '',
      probePayload: source.probePayload as Record<string, unknown>,
      workflow: source.workflow as RelayChannelProbeWorkflowStepDto[],
    }
  } catch {
    throw new Error(i18ns.t('relay.channelProbeImportInvalid'))
  }
}
function validBalanceDivisor(value: unknown): number {
  if (value == null) return 1
  const divisor = Number(value)
  if (!Number.isFinite(divisor) || divisor < 0.000001 || divisor > 1_000_000_000)
    throw new Error(i18ns.t('relay.channelProbeInvalidBalanceDivisor'))
  return divisor
}
function applyImportedConfiguration() {
  try {
    const imported = parseImportedProfile()
    form.value = {
      enabled: imported.enabled,
      probeFormat: imported.probeFormat,
      probeModel: imported.probeModel,
      distributionMultiplier: imported.distributionMultiplier,
    upstreamCurrency: imported.upstreamCurrency,
    localCurrency: imported.localCurrency,
    upstreamBalanceDivisor: imported.upstreamBalanceDivisor,
    probeGroup: imported.probeGroup,
    }
    payloadText.value = JSON.stringify(imported.probePayload, null, 2)
    workflowSteps.value = imported.workflow.map(toWorkflowForm)
    importDialogOpen.value = false
    ElMessage.success(i18ns.t('relay.channelProbeImported'))
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('relay.channelProbeImportInvalid')))
  }
}
function statusLabel(status: string) {
  return (
    (
      {
        queued: i18ns.t('relay.channelProbeStatusQueued'),
        running: i18ns.t('relay.channelProbeStatusRunning'),
        succeeded: i18ns.t('relay.channelProbeStatusSucceeded'),
        failed: i18ns.t('relay.channelProbeStatusFailed'),
        timed_out: i18ns.t('relay.channelProbeStatusTimedOut'),
        cancelled: i18ns.t('relay.channelProbeStatusCancelled'),
      } as Record<string, string>
    )[status] || status
  )
}
function statusType(status: string): 'info' | 'warning' | 'success' | 'danger' {
  return status === 'succeeded'
    ? 'success'
    : status === 'failed' || status === 'timed_out'
      ? 'danger'
      : status === 'running'
        ? 'warning'
        : 'info'
}
function formatDate(value?: string | Date) {
  return value ? new Date(value).toLocaleString() : '-'
}
function formatNumber(value?: number) {
  return value == null
    ? '-'
    : Number(value)
        .toFixed(6)
        .replace(/\.?0+$/, '')
}
function isApplicable(run?: RelayChannelProbeRunDto) {
  return Boolean(
    run && run.status === 'succeeded' && run.suggestedMultiplier != null && !run.appliedAt,
  )
}
function isRunnable(row: RelayChannelProbeOverviewItemDto) {
  return Boolean(row.enabled && row.profile?.enabled)
}
function canSelectRow(row: RelayChannelProbeOverviewItemDto) {
  return Boolean(
    (canExecute.value && isRunnable(row)) || (canAdjust.value && isApplicable(row.latestRun)),
  )
}
function onSelectionChange(rows: RelayChannelProbeOverviewItemDto[]) {
  selectedRows.value = rows
}
function clearSelection() {
  selectedRows.value = []
  tableRef.value?.clearSelection()
}
function parseObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value || '{}')
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error()
    return parsed as Record<string, unknown>
  } catch {
    throw new Error(`${label}: ${i18ns.t('relay.channelProbeInvalidJson')}`)
  }
}
function makeKeyValueEntries(
  value: Record<string, unknown> | undefined,
  body = false,
): ProbeKeyValueEntry[] {
  return Object.entries(value ?? {}).map(([key, entryValue]) => {
    const valueType =
      body && typeof entryValue === 'number'
        ? 'number'
        : body && typeof entryValue === 'boolean'
          ? 'boolean'
          : body && entryValue !== null && typeof entryValue === 'object'
            ? 'json'
            : 'text'
    return {
      id: crypto.randomUUID(),
      key,
      value: valueType === 'json' ? JSON.stringify(entryValue) : String(entryValue ?? ''),
      valueType,
    }
  })
}
function ensureUniqueFieldKey(key: string, target: Record<string, unknown>, label: string) {
  if (!key.trim() || Object.prototype.hasOwnProperty.call(target, key.trim()))
    throw new Error(i18ns.t('relay.channelProbeInvalidField', { label }))
}
function textFields(entries: ProbeKeyValueEntry[], label: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const entry of entries) {
    if (!entry.key.trim() && !entry.value.trim()) continue
    ensureUniqueFieldKey(entry.key, result, label)
    result[entry.key.trim()] = entry.value
  }
  return result
}
function bodyFields(entries: ProbeKeyValueEntry[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const entry of entries) {
    if (!entry.key.trim() && !entry.value.trim()) continue
    ensureUniqueFieldKey(entry.key, result, i18ns.t('relay.channelProbeBody'))
    const value = entry.value.trim()
    if (entry.valueType === 'text') result[entry.key.trim()] = entry.value
    else if (entry.valueType === 'number') {
      const numeric = Number(value)
      if (!Number.isFinite(numeric))
        throw new Error(i18ns.t('relay.channelProbeInvalidField', { label: entry.key }))
      result[entry.key.trim()] = numeric
    } else if (entry.valueType === 'boolean') {
      if (value !== 'true' && value !== 'false')
        throw new Error(i18ns.t('relay.channelProbeInvalidField', { label: entry.key }))
      result[entry.key.trim()] = value === 'true'
    } else {
      try {
        result[entry.key.trim()] = JSON.parse(value)
      } catch {
        throw new Error(`${entry.key}: ${i18ns.t('relay.channelProbeInvalidJson')}`)
      }
    }
  }
  return result
}
function formWorkflow(): RelayChannelProbeWorkflowStepDto[] {
  const balanceCount = workflowSteps.value.filter((step) => step.balancePath.trim()).length
  if (workflowSteps.value.length < 1 || balanceCount !== 1)
    throw new Error(i18ns.t('relay.channelProbeBalancePathRequired'))
  return workflowSteps.value.map((step) => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(step.name) || !step.url.trim())
      throw new Error(i18ns.t('relay.channelProbeInvalidStep'))
    return {
      name: step.name,
      method: step.method,
      url: step.url,
      headers: textFields(step.headers, i18ns.t('relay.channelProbeHeaders')),
      query: textFields(step.query, i18ns.t('relay.channelProbeQuery')),
      body: bodyFields(step.body),
      extract: textFields(step.extract, i18ns.t('relay.channelProbeExtract')),
      ...(step.balancePath.trim() ? { balancePath: step.balancePath.trim() } : {}),
    }
  })
}
async function loadOverview() {
  const requestId = ++overviewRequest
  loading.value = true
  pageError.value = ''
  try {
    const result = await relayChannelProbeService.listOverview()
    if (requestId === overviewRequest) items.value = result
  } catch (error) {
    if (requestId === overviewRequest) {
      pageError.value = getErrorMessage(error, i18ns.t('operationFailed'))
      ElMessage.error(pageError.value)
    }
  } finally {
    if (requestId === overviewRequest) loading.value = false
  }
}
async function openDrawer(row: RelayChannelProbeOverviewItemDto) {
  // Complete the drawer render before starting any remote request. A slow or stalled
  // run-history request must never delay the management surface becoming usable.
  ++runsRequest
  runs.value = []
  selected.value = row
  drawerOpen.value = true
  tab.value = 'profile'
  const profile = row.profile
  form.value = profile
    ? {
        enabled: profile.enabled,
        probeFormat: profile.probeFormat,
        probeModel: profile.probeModel,
        distributionMultiplier: profile.distributionMultiplier,
        upstreamCurrency: profile.upstreamCurrency,
        localCurrency: profile.localCurrency,
        upstreamBalanceDivisor: profile.upstreamBalanceDivisor,
        probeGroup: profile.probeGroup ?? '',
      }
    : {
        ...emptyForm(),
        probeFormat: row.allowedProbeFormats[0] ?? 'openai',
      }
  payloadText.value = JSON.stringify(profile?.probePayload ?? {}, null, 2)
  workflowSteps.value = profile ? profile.workflow.map(toWorkflowForm) : [makeStep()]
  credentialNames.value = profile?.credentialNames ?? []
  credentials.value = []
  await nextTick()
  void loadRuns()
  startPolling()
}
function toWorkflowForm(step: RelayChannelProbeWorkflowStepDto): WorkflowFormStep {
  return {
    id: crypto.randomUUID(),
    name: step.name,
    method: step.method,
    openSections: [
      ...((Object.keys(step.headers || {}).length || Object.keys(step.query || {}).length || Object.keys(step.body || {}).length)
        ? ['request']
        : []),
      ...(Object.keys(step.extract || {}).length ? ['response'] : []),
    ],
    url: step.url,
    headers: makeKeyValueEntries(step.headers),
    query: makeKeyValueEntries(step.query),
    body: makeKeyValueEntries(step.body, true),
    extract: makeKeyValueEntries(step.extract),
    balancePath: step.balancePath ?? '',
  }
}
function resetDrawer() {
  ++runsRequest
  selected.value = null
  runs.value = []
  credentials.value = []
  runsLoading.value = false
  stopPolling()
}
async function loadRuns() {
  if (!selected.value) return
  const requestId = ++runsRequest
  runsLoading.value = true
  try {
    const result = await relayChannelProbeService.listRuns(selected.value.channelId)
    if (requestId === runsRequest) runs.value = result.items
  } catch (error) {
    if (requestId === runsRequest)
      ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
  } finally {
    if (requestId === runsRequest) runsLoading.value = false
  }
}
async function saveProfile() {
  if (!selected.value || saving.value) return
  if (!form.value.probeModel.trim())
    return ElMessage.warning(i18ns.t('relay.channelProbeModelRequired'))
  const credentialMap = credentials.value.reduce<Record<string, string>>((result, row) => {
    if (row.name.trim() && row.value) result[row.name.trim()] = row.value
    return result
  }, {})
  if (credentials.value.some((row) => Boolean(row.name.trim()) !== Boolean(row.value)))
    return ElMessage.warning(i18ns.t('relay.channelProbeCredentialIncomplete'))
  saving.value = true
  try {
    await relayChannelProbeService.saveProfile(selected.value.channelId, {
      ...form.value,
      upstreamCurrency: form.value.upstreamCurrency.toUpperCase(),
      localCurrency: form.value.localCurrency.toUpperCase(),
      probePayload: parseObject(payloadText.value, i18ns.t('relay.channelProbePayload')),
      workflow: formWorkflow(),
      ...(Object.keys(credentialMap).length ? { credentials: credentialMap } : {}),
    })
    ElMessage.success(i18ns.t('success'))
    await loadOverview()
    const updated = items.value.find((item) => item.channelId === selected.value?.channelId)
    if (updated) await openDrawer(updated)
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
  } finally {
    saving.value = false
  }
}
async function confirmClearProfile() {
  const channelId = selected.value?.channelId
  if (!channelId || !selected.value?.profile || clearingProfile.value) return
  try {
    await ElMessageBox.confirm(
      i18ns.t('relay.channelProbeClearProfileConfirm'),
      i18ns.t('warning'),
      {
        type: 'warning',
        confirmButtonText: i18ns.t('confirm'),
        cancelButtonText: i18ns.t('cancel'),
      },
    )
  } catch {
    return
  }
  clearingProfile.value = true
  try {
    await relayChannelProbeService.clearProfile(channelId)
    ElMessage.success(i18ns.t('relay.channelProbeProfileCleared'))
    await loadOverview()
    const updated = items.value.find((item) => item.channelId === channelId)
    if (updated) await openDrawer(updated)
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
  } finally {
    clearingProfile.value = false
  }
}
async function run(row: RelayChannelProbeOverviewItemDto) {
  if (runningId.value) return
  runningId.value = row.channelId
  try {
    await relayChannelProbeService.createRun(row.channelId)
    ElMessage.success(i18ns.t('relay.channelProbeQueued'))
    await Promise.all([
      loadOverview(),
      selected.value?.channelId === row.channelId ? loadRuns() : Promise.resolve(),
    ])
    startPolling()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
  } finally {
    runningId.value = ''
  }
}
async function confirmResetRunState(row: RelayChannelProbeOverviewItemDto) {
  if (resettingChannelId.value) return
  try {
    await ElMessageBox.confirm(
      i18ns.t('relay.channelProbeResetStateConfirm'),
      i18ns.t('warning'),
      {
        type: 'warning',
        confirmButtonText: i18ns.t('confirm'),
        cancelButtonText: i18ns.t('cancel'),
      },
    )
  } catch {
    return
  }
  resettingChannelId.value = row.channelId
  try {
    await relayChannelProbeService.resetRunState(row.channelId)
    ElMessage.success(i18ns.t('relay.channelProbeStateReset'))
    await loadOverview()
    const updated = items.value.find((item) => item.channelId === row.channelId)
    if (selected.value?.channelId === row.channelId && updated) selected.value = updated
    if (selected.value?.channelId === row.channelId) await loadRuns()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
  } finally {
    resettingChannelId.value = ''
  }
}
async function confirmBatchRun() {
  const channelIds = runnableChannelIds.value
  if (!channelIds.length || batchRunning.value) return
  try {
    await ElMessageBox.confirm(
      i18ns.t('relay.channelProbeBatchRunConfirm', { count: channelIds.length }),
      i18ns.t('warning'),
      {
        type: 'warning',
        confirmButtonText: i18ns.t('confirm'),
        cancelButtonText: i18ns.t('cancel'),
      },
    )
  } catch {
    return
  }
  batchRunning.value = true
  try {
    const result = await relayChannelProbeService.createRuns({ channelIds })
    if (result.queued.length)
      ElMessage.success(i18ns.t('relay.channelProbeBatchQueued', { count: result.queued.length }))
    if (result.rejected.length)
      ElMessage.warning(result.rejected.map((item: { reason: string }) => item.reason).join('；'))
    clearSelection()
    await Promise.all([loadOverview(), selected.value ? loadRuns() : Promise.resolve()])
    startPolling()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
  } finally {
    batchRunning.value = false
  }
}
async function confirmApply(runIds: string[]) {
  if (!runIds.length || applying.value) return
  try {
    await ElMessageBox.confirm(
      i18ns.t('relay.channelProbeApplyConfirm', { count: runIds.length }),
      i18ns.t('warning'),
      {
        type: 'warning',
        confirmButtonText: i18ns.t('confirm'),
        cancelButtonText: i18ns.t('cancel'),
      },
    )
  } catch {
    return
  }
  applying.value = true
  try {
    const result = await relayChannelProbeService.applyRuns({ runIds })
    if (result.applied)
      ElMessage.success(i18ns.t('relay.channelProbeApplied', { count: result.applied }))
    if (result.rejected.length)
      ElMessage.warning(result.rejected.map((item: { reason: string }) => item.reason).join('；'))
    clearSelection()
    await Promise.all([loadOverview(), loadRuns()])
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
  } finally {
    applying.value = false
  }
}
function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => {
    if (runs.value.some((run) => run.status === 'queued' || run.status === 'running')) {
      void loadRuns()
      void loadOverview()
    }
  }, 3000)
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = undefined
}
watch([keyword, profileFilter, enabledFilter, runStatusFilter, suggestionFilter], clearSelection)
onMounted(loadOverview)
onBeforeUnmount(stopPolling)
</script>

<style scoped>
.channel-probe-page {
  width: 100%;
  min-height: 100%;
  padding: 20px 24px;
  box-sizing: border-box;
}
.page-header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-start;
  margin-bottom: 18px;
}
.page-header h1 {
  margin: 0;
  font-size: 22px;
}
.page-header p {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
}
.probe-filters {
  display: grid;
  grid-template-columns: minmax(220px, 2fr) repeat(4, minmax(150px, 1fr));
  gap: 10px;
  margin: 0 0 12px;
}
.probe-toolbar {
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin: 0 0 12px;
}
.selection-summary {
  margin-right: auto;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.form-grid,
.workflow-route-grid,
.workflow-request-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
}
.profile-editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 24px;
  align-items: start;
}
.profile-editor-main {
  min-width: 0;
}
.advanced-payload {
  margin-bottom: 12px;
}
.probe-helper-panel {
  position: sticky;
  top: 0;
  display: grid;
  gap: 12px;
}
.helper-section {
  border: 1px solid var(--el-border-color-lighter);
  border-left: 3px solid var(--el-color-primary);
  padding: 14px;
  background: var(--el-fill-color-extra-light);
}
.helper-section h3 {
  margin: 0;
  font-size: 14px;
}
.helper-section p {
  margin: 8px 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.55;
}
.helper-section code {
  display: block;
  margin-top: 6px;
  padding: 6px 8px;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.configuration-checklist,
.credential-guide {
  background: var(--el-bg-color);
}
.checklist-item,
.credential-requirement {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  padding: 8px 0;
  border-top: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.5;
}
.checklist-item:first-of-type,
.credential-requirement:first-child {
  border-top: 0;
  padding-top: 0;
}
.credential-requirement-list {
  display: grid;
}
.credential-requirement {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}
.credential-requirement code {
  overflow: hidden;
  margin: 0;
  color: var(--el-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.credential-requirement .el-button {
  grid-column: 1 / -1;
  justify-self: start;
  height: auto;
  padding: 0;
}
.channel-capability-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.channel-capability-tags.models {
  margin-top: 8px;
}
.channel-capability-tags.models :deep(.el-tag) {
  max-width: 100%;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-overflow: ellipsis;
}
.variable-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.variable-tag {
  cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.section-heading {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
  margin: 22px 0 10px;
}
.section-heading span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.reuse-actions {
  display: grid;
  gap: 8px;
}
.hidden-file-input {
  display: none;
}
.workflow-step,
.run-card {
  border: 1px solid var(--el-border-color-lighter);
  padding: 14px;
  margin-bottom: 12px;
  border-radius: 4px;
}
.workflow-step {
  border-left: 3px solid var(--el-color-primary-light-5);
  background: var(--el-bg-color);
}
.workflow-step-header,
.run-title,
.runs-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.workflow-step-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
.workflow-step-number {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 50%;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 700;
}
.workflow-route-grid {
  grid-template-columns: minmax(120px, 0.8fr) 112px minmax(240px, 2fr);
}
.workflow-url-field {
  grid-column: auto;
}
.workflow-balance-row {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(180px, 0.65fr);
  gap: 14px;
  align-items: end;
  margin: 2px 0 8px;
}
.workflow-balance-row p {
  margin: 0 0 18px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.45;
}
.workflow-collapse {
  border-top: 1px solid var(--el-border-color-lighter);
}
.workflow-collapse :deep(.el-collapse-item__header) {
  height: 40px;
  border-bottom: 0;
}
.workflow-collapse :deep(.el-collapse-item__wrap) {
  border-bottom: 0;
}
.workflow-collapse :deep(.el-collapse-item__content) {
  padding: 0 0 8px;
}
.workflow-collapse-title {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.workflow-collapse-title span {
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workflow-request-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.workflow-body-field {
  grid-column: 1 / -1;
}
.workflow-step :deep(.el-form-item) {
  margin-bottom: 12px;
}
.run-title span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-right: auto;
}
.credential-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) auto;
  gap: 8px;
  margin-bottom: 8px;
}
.profile-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.formula {
  margin: 10px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  word-break: break-word;
}
@media (max-width: 1000px) {
  .probe-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .profile-editor-layout {
    grid-template-columns: 1fr;
  }
  .probe-helper-panel {
    position: static;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 768px) {
  .channel-probe-page {
    padding: 16px;
  }
  .page-header {
    flex-direction: column;
  }
  .probe-filters,
  .form-grid,
  .workflow-route-grid,
  .workflow-request-grid,
  .probe-helper-panel {
    grid-template-columns: 1fr;
  }
  .workflow-balance-row {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .workflow-balance-row p {
    margin: -4px 0 12px;
  }
  .probe-toolbar {
    flex-wrap: wrap;
  }
  .section-heading {
    grid-template-columns: 1fr;
  }
  .credential-row {
    grid-template-columns: 1fr auto;
  }
  .credential-row :deep(.el-input:nth-child(2)) {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
</style>
