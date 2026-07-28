<template>
  <main class="channel-probe-page">
    <header class="page-header">
      <div>
        <h1>{{ i18ns.t('relay.channelProbeTitle') }}</h1>
        <p>{{ i18ns.t('relay.channelProbeDescription') }}</p>
      </div>
      <div class="page-header-actions">
        <el-button plain @click="changeDialogOpen = true">{{
          i18ns.t('relay.channelProbeChangeAnalysis')
        }}</el-button>
        <el-button :icon="Refresh" :loading="loading" @click="loadOverview">{{
          i18ns.t('refresh')
        }}</el-button>
      </div>
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
        :disabled="!canBatchCopyProfile"
        @click="openBatchProfileDialog"
        >{{ i18ns.t('relay.channelProbeBatchConfigure') }}</el-button
      >
      <el-button
        v-if="canExecute"
        type="primary"
        plain
        :disabled="runnableChannelIds.length === 0"
        :loading="batchRunning"
        @click="confirmBatchRun"
        >{{ i18ns.t('relay.channelProbeBatchRun') }}</el-button
      >
      <el-checkbox v-if="canExecute" v-model="forceWithoutCacheBuster" :disabled="batchRunning">
        {{ i18ns.t('relay.channelProbeForceWithoutCacheBuster') }}
      </el-checkbox>
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
      <el-table-column :label="i18ns.t('relay.channelProbeLatest')" width="120"
        ><template #default="{ row }">{{
          row.latestRun ? statusLabel(row.latestRun.status) : '-'
        }}</template></el-table-column
      >
      <el-table-column :label="i18ns.t('relay.channelProbeSuggestion')" width="100" align="right"
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

    <el-dialog
      v-model="batchProfileDialogOpen"
      :title="i18ns.t('relay.channelProbeBatchConfigureTitle')"
      width="min(720px, 94vw)"
      append-to-body
      destroy-on-close
      @closed="resetBatchProfileDialog"
    >
      <el-alert
        type="info"
        :closable="false"
        show-icon
        :title="i18ns.t('relay.channelProbeBatchConfigureHelp')"
      />
      <el-form label-position="top" class="mt-4">
        <el-form-item :label="i18ns.t('relay.channelProbeBatchSource')">
          <el-select v-model="batchProfileSourceChannelId" class="w-full">
            <el-option
              v-for="item in batchProfileSources"
              :key="item.channelId"
              :label="item.channelName"
              :value="item.channelId"
            >
              <span>{{ item.channelName }}</span>
              <span class="ml-2 text-xs text-[#909399]">{{
                item.profile?.probeFormat + ' / ' + item.profile?.probeModel
              }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="batchProfileOverwriteExisting">{{
            i18ns.t('relay.channelProbeBatchOverwrite')
          }}</el-checkbox>
        </el-form-item>
      </el-form>
      <el-table :data="batchProfileTargets" max-height="320" class="w-full">
        <el-table-column prop="channelName" :label="i18ns.t('relay.channelName')" min-width="180" />
        <el-table-column :label="i18ns.t('relay.channelProbeConfigured')" width="128">
          <template #default="{ row }">
            <el-tag size="small" :type="row.profile ? 'warning' : 'success'">{{
              row.profile
                ? i18ns.t('relay.channelProbeBatchWillOverwrite')
                : i18ns.t('relay.channelProbeBatchWillCreate')
            }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="batchProfileDialogOpen = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button
          type="primary"
          :disabled="!batchProfileSourceChannelId || batchProfileTargets.length === 0"
          :loading="batchProfileSaving"
          @click="submitBatchProfileCopy"
          >{{ i18ns.t('confirm') }}</el-button
        >
      </template>
    </el-dialog>

    <el-drawer
      v-model="drawerOpen"
      :title="selected?.channelName"
      direction="rtl"
      size="min(66vw, 100vw)"
      append-to-body
      destroy-on-close
      @closed="resetDrawer"
    >
      <section v-if="selected" class="probe-drawer-summary">
        <div class="probe-summary-heading">
          <div>
            <span class="eyebrow">{{ i18ns.t('relay.channelProbeTitle') }}</span>
            <strong>{{ selected.channelName }}</strong>
          </div>
          <div class="summary-state-tags">
            <el-tag :type="selected.enabled ? 'success' : 'info'" effect="plain">{{
              selected.enabled ? i18ns.t('relay.enabled') : i18ns.t('relay.disabled')
            }}</el-tag>
            <el-tag :type="selected.profile ? 'success' : 'warning'" effect="plain">{{
              selected.profile ? i18ns.t('relay.channelProbeConfigured') : i18ns.t('no')
            }}</el-tag>
          </div>
        </div>
        <div class="probe-summary-grid">
          <div class="probe-summary-item">
            <span>{{ i18ns.t('relay.channelMultiplier') }}</span>
            <strong>{{ selected.multiplier }}x</strong>
          </div>
          <div class="probe-summary-item">
            <span>{{ i18ns.t('relay.channelProbeLatest') }}</span>
            <div v-if="selected.latestRun" class="summary-run-state">
              <el-tag size="small" :type="statusType(selected.latestRun.status)">{{
                statusLabel(selected.latestRun.status)
              }}</el-tag>
              <small>{{
                formatDate(selected.latestRun.finishedAt ?? selected.latestRun.createTime)
              }}</small>
            </div>
            <strong v-else>-</strong>
          </div>
          <div class="probe-summary-item">
            <span>{{ i18ns.t('relay.channelProbeFormat') }}</span>
            <strong>{{ selected.profile?.probeFormat ?? '-' }}</strong>
            <small>{{
              selected.profile?.probeModel ?? i18ns.t('relay.channelProbeNoProfile')
            }}</small>
          </div>
          <div class="probe-summary-item">
            <span>{{ i18ns.t('relay.channelProbeSuggestion') }}</span>
            <strong>{{
              selected.latestRun?.suggestedMultiplier == null
                ? '-'
                : selected.latestRun.suggestedMultiplier + 'x'
            }}</strong>
            <small v-if="selected.latestRun?.appliedAt">{{
              i18ns.t('relay.channelProbeSuggestionApplied')
            }}</small>
          </div>
          <div class="probe-summary-item probe-summary-wide">
            <span>{{ i18ns.t('relay.channelProbeBalanceDivisor') }}</span>
            <strong v-if="selected.profile">{{
              selected.profile.upstreamCurrency +
              ' / ' +
              formatNumber(selected.profile.upstreamBalanceDivisor) +
              ' × ' +
              formatNumber(selected.profile.upstreamRateMultiplier) +
              ' -> ' +
              selected.profile.localCurrency
            }}</strong>
            <strong v-else>-</strong>
            <small>{{
              selected.profile?.probeGroup
                ? i18ns.t('relay.channelProbeGroup') + ': ' + selected.profile.probeGroup
                : i18ns.t('relay.channelProbeUngrouped')
            }}</small>
          </div>
        </div>
      </section>
      <el-tabs v-model="tab">
        <el-tab-pane :label="i18ns.t('relay.channelProbeProfile')" name="profile">
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
                    <el-form-item
                      class="request-model-field"
                      :label="i18ns.t('relay.channelProbeModel')"
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
                  </div>
                  <el-form-item class="cache-buster-switch">
                    <el-switch
                      v-model="form.preventCache"
                      :disabled="!canExecute"
                      :active-text="i18ns.t('relay.channelProbePreventCache')"
                      :inactive-text="i18ns.t('relay.channelProbePreventCacheOff')"
                    />
                    <span>{{ i18ns.t('relay.channelProbePreventCacheHelp') }}</span>
                  </el-form-item>
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
                      ><el-input
                        v-model.trim="form.localCurrency"
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
                <section
                  v-for="(step, index) in workflowSteps"
                  :key="step.id"
                  class="workflow-step"
                >
                  <header class="workflow-step-header">
                    <div class="workflow-step-title">
                      <span class="workflow-step-number">{{ index + 1 }}</span>
                      <strong>{{
                        i18ns.t('relay.channelProbeWorkflowStep', { index: index + 1 })
                      }}</strong>
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
                    <el-form-item
                      class="workflow-url-field"
                      :label="i18ns.t('relay.channelProbeUrl')"
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
        </el-tab-pane>
        <el-tab-pane :label="i18ns.t('relay.channelProbeRuns')" name="runs">
          <div class="runs-toolbar">
            <el-button :loading="runsLoading" @click="loadRuns">{{ i18ns.t('refresh') }}</el-button>
            <el-button
              v-if="canExecute"
              type="primary"
              :disabled="!selected?.profile"
              :loading="runningId === selected?.channelId"
              @click="selected && run(selected)"
              >{{ i18ns.t('relay.channelProbeRun') }}</el-button
            >
            <el-checkbox
              v-if="canExecute"
              v-model="forceWithoutCacheBuster"
              :disabled="runningId !== ''"
            >
              {{ i18ns.t('relay.channelProbeForceWithoutCacheBuster') }}
            </el-checkbox>
            <el-button
              v-if="canExecute && selected"
              type="warning"
              plain
              :loading="resettingChannelId === selected?.channelId"
              @click="selected && confirmResetRunState(selected)"
              >{{ i18ns.t('relay.channelProbeResetState') }}</el-button
            >
            <el-button
              v-if="canExecute"
              type="danger"
              plain
              :disabled="runs.length === 0"
              :loading="clearingHistoryScope === 'failed'"
              @click="confirmClearRunHistory('failed')"
              >{{ i18ns.t('relay.channelProbeClearFailures') }}</el-button
            >
            <el-button
              v-if="canExecute"
              type="danger"
              :disabled="runs.length === 0"
              :loading="clearingHistoryScope === 'all'"
              @click="confirmClearRunHistory('all')"
              >{{ i18ns.t('relay.channelProbeClearHistory') }}</el-button
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
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeEstimatedCurrentCharge')">{{
                formatNumber(estimatedCurrentCharge(runItem))
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeUpstreamRate')">{{
                formatNumber(runItem.upstreamRateMultiplier)
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeTokens')">{{
                runItem.totalTokens ?? '-'
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeCacheCreationTokens')">{{
                runItem.cacheCreationTokens ?? '-'
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeCacheReadTokens')">{{
                runItem.cacheReadTokens ?? '-'
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeCacheBuster')">{{
                runItem.cacheBustingEnabled
                  ? (runItem.cacheBusterId ?? i18ns.t('relay.channelProbeCacheBusterUnavailable'))
                  : i18ns.t('relay.channelProbeCacheBusterDisabled')
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeSuggestion')">{{
                runItem.suggestedMultiplier == null ? '-' : `${runItem.suggestedMultiplier}x`
              }}</el-descriptions-item></el-descriptions
            >
            <p v-if="runItem.suggestedMultiplier != null" class="formula">
              {{
                i18ns.t('relay.channelProbeFormula', {
                  delta: formatNumber(runItem.upstreamBalanceDelta),
                  upstreamRate: formatNumber(runItem.upstreamRateMultiplier),
                  distribution: runItem.distributionMultiplier,
                  base: formatNumber(runItem.baseLocalCost),
                  suggested: runItem.suggestedMultiplier,
                })
              }}
            </p>
            <p v-if="estimatedCurrentCharge(runItem) != null" class="formula">
              {{
                i18ns.t('relay.channelProbeEstimatedCurrentChargeFormula', {
                  base: formatNumber(runItem.baseLocalCost),
                  multiplier: formatNumber(currentChannelMultiplier(runItem)),
                  estimated: formatNumber(estimatedCurrentCharge(runItem)),
                })
              }}
            </p>
            <p v-if="baseCostFormula(runItem)" class="formula formula-detail">
              {{ baseCostFormula(runItem) }}
            </p>
            <el-collapse v-if="runItem.upstreamUsage" class="usage-details">
              <el-collapse-item :title="i18ns.t('relay.channelProbeRawUsage')" name="usage">
                <pre>{{ formatUsage(runItem.upstreamUsage) }}</pre>
              </el-collapse-item>
            </el-collapse>
            <el-alert
              v-else-if="suggestionUnavailableReason(runItem)"
              type="warning"
              :closable="false"
              :title="suggestionUnavailableReason(runItem)"
              class="mt-2"
            />
            <el-alert
              v-if="runItem.errorMessage"
              type="error"
              :closable="false"
              :title="formatProbeError(runItem.errorMessage)"
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
    <el-dialog
      v-model="applyDialogOpen"
      :title="i18ns.t('relay.channelProbeApplyDialogTitle')"
      width="min(70vw, 94vw)"
      append-to-body
      :close-on-click-modal="false"
    >
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        :title="i18ns.t('relay.channelProbeApplyDialogNotice')"
        class="mb-3"
      />
      <div class="calibration-toolbar">
        <span>{{ i18ns.t('relay.channelProbeRoundingMode') }}</span>
        <el-select v-model="roundingMode" class="rounding-mode">
          <el-option value="ceil" :label="i18ns.t('relay.channelProbeRoundUp')" />
          <el-option value="nearest" :label="i18ns.t('relay.channelProbeRoundNearest')" />
        </el-select>
        <span>{{ i18ns.t('relay.channelProbeRoundDigits') }}</span>
        <el-input-number v-model="roundingDigits" :min="0" :max="6" :step="1" :precision="0" />
        <span class="calibration-toolbar-divider" />
        <span>{{ i18ns.t('relay.channelProbeSelectionTolerance') }}</span>
        <el-input-number
          v-model="selectionTolerancePercent"
          :min="0"
          :max="100"
          :step="0.1"
          :precision="2"
        />
        <span>%</span>
        <el-select v-model="selectionDirection" class="selection-direction">
          <el-option value="all" :label="i18ns.t('relay.channelProbeSelectionAll')" />
          <el-option value="increase" :label="i18ns.t('relay.channelProbeSelectionIncrease')" />
          <el-option value="decrease" :label="i18ns.t('relay.channelProbeSelectionDecrease')" />
        </el-select>
        <el-button type="primary" plain @click="selectEligibleDrafts">{{
          i18ns.t('relay.channelProbeSelectEligible')
        }}</el-button>
        <el-button link @click="clearDraftSelection">{{
          i18ns.t('relay.channelProbeClearSelection')
        }}</el-button>
        <el-checkbox v-model="rememberApplySettings">{{
          i18ns.t('relay.channelProbeRememberApplySettings')
        }}</el-checkbox>
        <span class="selected-draft-summary">{{
          i18ns.t('relay.channelProbeSelected', { count: selectedApplyRunIds.length })
        }}</span>
      </div>
      <el-table
        ref="applyTableRef"
        :data="applyDrafts"
        row-key="run.id"
        max-height="440"
        class="w-full"
        @selection-change="onApplySelectionChange"
      >
        <el-table-column type="selection" width="46" reserve-selection />
        <el-table-column prop="channelName" :label="i18ns.t('relay.channelName')" min-width="140" />
        <el-table-column
          :label="i18ns.t('relay.channelProbeCostFactors')"
          width="148"
          align="right"
        >
          <template #default="{ row }">{{
            formatNumber(row.run.upstreamRateMultiplier) +
            ' × ' +
            formatNumber(row.run.distributionMultiplier)
          }}</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.channelMultiplier')" width="126" align="right">
          <template #default="{ row }">{{ row.currentMultiplier }}x</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.channelProbeSuggestion')" width="132" align="right">
          <template #default="{ row }">{{ row.run.suggestedMultiplier }}x</template>
        </el-table-column>
        <el-table-column
          :label="i18ns.t('relay.channelProbeUpstreamDelta')"
          width="142"
          align="right"
        >
          <template #default="{ row }">{{ formatNumber(row.run.upstreamBalanceDelta) }}</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.channelProbeTargetCost')" width="142" align="right">
          <template #default="{ row }">{{ formatNumber(targetLocalCost(row.run)) }}</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.channelProbeBaseCost')" width="132" align="right">
          <template #default="{ row }">{{ formatNumber(row.run.baseLocalCost) }}</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.channelProbeTargetMultiplier')" min-width="180">
          <template #default="{ row }">
            <el-input-number
              v-model="row.targetMultiplier"
              :min="0.000001"
              :max="1000"
              :step="0.000001"
              :precision="6"
              controls-position="right"
              class="w-full"
            />
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.channelProbeMultiplierChange')" min-width="238">
          <template #default="{ row }">
            <div class="multiplier-change-cell">
              <span :class="multiplierChangeClass(row)">{{
                formatMultiplierChange(row) + ' · ' + formatMultiplierChangePercent(row)
              }}</span>
              <div
                class="multiplier-direction-bar"
                :aria-label="multiplierDirectionLabel(row.currentMultiplier, row.targetMultiplier)"
                role="img"
              >
                <span class="multiplier-direction-label multiplier-direction-label-left">{{
                  i18ns.t('relay.channelProbePriceDecrease')
                }}</span>
                <span class="multiplier-direction-label multiplier-direction-label-center">{{
                  i18ns.t('relay.channelProbeCurrentMultiplier')
                }}</span>
                <span class="multiplier-direction-label multiplier-direction-label-right">{{
                  i18ns.t('relay.channelProbePriceIncrease')
                }}</span>
                <span class="multiplier-direction-track" />
                <span class="multiplier-direction-zero" />
                <span
                  class="multiplier-direction-fill"
                  :class="multiplierDirectionClass(row.currentMultiplier, row.targetMultiplier)"
                  :style="
                    multiplierDirectionStyle(
                      row.currentMultiplier,
                      row.targetMultiplier,
                      applyDirectionMaximumPercent,
                    )
                  "
                />
              </div>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="applyDialogOpen = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button
          type="primary"
          :disabled="selectedApplyRunIds.length === 0"
          :loading="applying"
          @click="submitApplyMultipliers"
          >{{
            i18ns.t('relay.channelProbeApplySelected', { count: selectedApplyRunIds.length })
          }}</el-button
        >
      </template>
    </el-dialog>
    <el-dialog
      v-model="changeDialogOpen"
      :title="i18ns.t('relay.channelProbeChangeAnalysis')"
      width="min(1420px, 96vw)"
      append-to-body
    >
      <div class="change-analysis-toolbar">
        <el-select v-model="changeSort">
          <el-option value="largest" :label="i18ns.t('relay.channelProbeChangeLargest')" />
          <el-option value="smallest" :label="i18ns.t('relay.channelProbeChangeSmallest')" />
          <el-option value="recent" :label="i18ns.t('relay.channelProbeChangeRecent')" />
        </el-select>
        <el-select v-model="changeDirection">
          <el-option value="all" :label="i18ns.t('relay.channelProbeSelectionAll')" />
          <el-option value="increase" :label="i18ns.t('relay.channelProbeSelectionIncrease')" />
          <el-option value="decrease" :label="i18ns.t('relay.channelProbeSelectionDecrease')" />
        </el-select>
        <el-select v-model="changeTypeFilter">
          <el-option value="all" :label="i18ns.t('relay.channelProbeChangeTypeAll')" />
          <el-option value="suggested" :label="i18ns.t('relay.channelProbeChangeTypeSuggested')" />
          <el-option value="applied" :label="i18ns.t('relay.channelProbeChangeTypeApplied')" />
        </el-select>
        <span>{{ i18ns.t('relay.channelProbeSelectionTolerance') }}</span>
        <el-input-number
          v-model="changeMinimumPercent"
          :min="0"
          :max="100000"
          :step="0.1"
          :precision="2"
        />
        <span>%</span>
        <span>{{ i18ns.t('relay.channelProbeNoticeRoundingMode') }}</span>
        <el-select v-model="changeDisplayRoundingMode" class="rounding-mode">
          <el-option value="nearest" :label="i18ns.t('relay.channelProbeRoundNearest')" />
          <el-option value="ceil" :label="i18ns.t('relay.channelProbeRoundUp')" />
        </el-select>
        <span>{{ i18ns.t('relay.channelProbeNoticeDecimals') }}</span>
        <el-input-number v-model="changeDisplayDigits" :min="0" :max="6" :step="1" :precision="0" />
        <span class="selected-draft-summary">{{
          i18ns.t('relay.channelProbeChangeCount', { count: multiplierChangeRows.length })
        }}</span>
        <span class="selected-draft-summary">{{
          i18ns.t('relay.channelProbeCustomerNoticeCount', {
            count: publicMultiplierChangeRows.length,
          })
        }}</span>
        <el-tooltip :disabled="publicMultiplierChangeRows.length > 0" placement="top">
          <template #content>{{ i18ns.t('relay.channelProbeExportChangeChartNoPublic') }}</template>
          <span>
            <el-button
              :icon="Download"
              plain
              :disabled="publicMultiplierChangeRows.length === 0"
              @click="exportMultiplierChangeChart"
              >{{ i18ns.t('relay.channelProbeExportChangeChart') }}</el-button
            >
          </span>
        </el-tooltip>
      </div>
      <el-table :data="pagedCustomerFacingMultiplierChangeRows" max-height="60vh" class="w-full">
        <el-table-column prop="channelName" :label="i18ns.t('relay.channelName')" min-width="150" />
        <el-table-column :label="i18ns.t('relay.channelProbeChangeType')" width="108">
          <template #default="{ row }">
            <el-tag size="small" :type="row.applied ? 'success' : 'warning'">{{
              row.applied
                ? i18ns.t('relay.channelProbeSuggestionApplied')
                : i18ns.t('relay.channelProbeSuggestion')
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column
          :label="i18ns.t('relay.channelProbeChangeBefore')"
          width="118"
          align="right"
        >
          <template #default="{ row }">{{ row.sourceMultiplier }}x</template>
        </el-table-column>
        <el-table-column
          :label="i18ns.t('relay.channelProbeChangeAfter')"
          width="118"
          align="right"
        >
          <template #default="{ row }">{{ row.targetMultiplier }}x</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.channelProbeMultiplierChange')" min-width="286">
          <template #default="{ row }">
            <div class="multiplier-change-cell">
              <span
                :class="
                  row.change > 0
                    ? 'multiplier-change-up'
                    : row.change < 0
                      ? 'multiplier-change-down'
                      : ''
                "
                >{{
                  formatChangeValue(row.change) + ' · ' + row.changePercent.toFixed(2) + '%'
                }}</span
              >
              <div
                class="multiplier-direction-bar"
                :aria-label="multiplierDirectionLabel(row.sourceMultiplier, row.targetMultiplier)"
                role="img"
              >
                <span class="multiplier-direction-label multiplier-direction-label-left">{{
                  i18ns.t('relay.channelProbePriceDecrease')
                }}</span>
                <span class="multiplier-direction-label multiplier-direction-label-center">{{
                  i18ns.t('relay.channelProbeCurrentMultiplier')
                }}</span>
                <span class="multiplier-direction-label multiplier-direction-label-right">{{
                  i18ns.t('relay.channelProbePriceIncrease')
                }}</span>
                <span class="multiplier-direction-track" />
                <span class="multiplier-direction-zero" />
                <span
                  class="multiplier-direction-fill"
                  :class="multiplierDirectionClass(row.sourceMultiplier, row.targetMultiplier)"
                  :style="
                    multiplierDirectionStyle(
                      row.sourceMultiplier,
                      row.targetMultiplier,
                      customerFacingDirectionMaximumPercent,
                    )
                  "
                />
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column
          :label="i18ns.t('relay.channelProbeCostFactors')"
          width="148"
          align="right"
        >
          <template #default="{ row }">{{ row.costFactors }}</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.channelProbeTargetCost')" width="138" align="right">
          <template #default="{ row }">{{ formatNumber(row.targetCost) }}</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.channelProbeChangeTime')" width="168">
          <template #default="{ row }">{{ formatDate(row.time) }}</template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="changePage"
        v-model:page-size="changePageSize"
        class="mt-4 justify-end"
        layout="total, sizes, prev, pager, next"
        :page-sizes="[20, 50, 100]"
        :total="publicMultiplierChangeRows.length"
      />
    </el-dialog>
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
import StorageKey from '@/constant/storagekey'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { relayChannelProbeService } from '@/service/relayChannelProbeService'
import { relayChannelService } from '@/service/relayChannelService'
import ProbeKeyValueEditor, { type ProbeKeyValueEntry } from './components/ProbeKeyValueEditor.vue'
import type { TableInstance } from 'element-plus'
import type {
  RelayChannelProbeFormat,
  RelayChannelProbeCustomerFacingTargetDto,
  RelayChannelProbeOverviewItemDto,
  RelayChannelProbeRunDto,
  RelayChannelProbeRunStatus,
  RelayChannelProbeWorkflowStepDto,
  RelayChannelDto,
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
  preventCache: boolean
  probeFormat: RelayChannelProbeFormat
  probeModel: string
  distributionMultiplier: number
  upstreamCurrency: string
  localCurrency: string
  upstreamBalanceDivisor: number
  upstreamRateMultiplier: number
  probeGroup: string
}
interface ApplyMultiplierDraft {
  run: RelayChannelProbeRunDto
  channelName: string
  currentMultiplier: number
  suggestedMultiplier: number
  targetMultiplier: number
}
interface MultiplierChangeRow {
  channelId: string
  channelName: string
  customerFacingTargets: RelayChannelProbeCustomerFacingTargetDto[]
  sourceMultiplier: number
  targetMultiplier: number
  change: number
  changePercent: number
  applied: boolean
  costFactors: string
  targetCost?: number
  time: string | Date
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
const applyDialogOpen = ref(false)
const roundingDigits = ref(4)
const roundingMode = ref<'ceil' | 'nearest'>('ceil')
const applyDrafts = ref<ApplyMultiplierDraft[]>([])
const applyTableRef = ref<TableInstance>()
const selectedApplyRunIds = ref<string[]>([])
const selectionTolerancePercent = ref(1)
const selectionDirection = ref<'all' | 'increase' | 'decrease'>('all')
const rememberApplySettings = ref(false)
const APPLY_SETTINGS_STORAGE_KEY = StorageKey.Relay.CHANNEL_PROBE_APPLY_SETTINGS
type RememberedApplySettings = {
  roundingDigits: number
  roundingMode: 'ceil' | 'nearest'
  selectionTolerancePercent: number
  selectionDirection: 'all' | 'increase' | 'decrease'
}
const changeDialogOpen = ref(false)
const changeSort = ref<'largest' | 'smallest' | 'recent'>('largest')
const changeDirection = ref<'all' | 'increase' | 'decrease'>('all')
const changeTypeFilter = ref<'all' | 'suggested' | 'applied'>('all')
const changeMinimumPercent = ref(0)
const changeDisplayDigits = ref(4)
const changeDisplayRoundingMode = ref<'ceil' | 'nearest'>('nearest')
const changePage = ref(1)
const changePageSize = ref(50)
const batchRunning = ref(false)
const batchProfileDialogOpen = ref(false)
const batchProfileSaving = ref(false)
const batchProfileSourceChannelId = ref('')
const batchProfileOverwriteExisting = ref(false)
const runsLoading = ref(false)
const runningId = ref('')
const resettingChannelId = ref('')
const clearingHistoryScope = ref<'' | 'all' | 'failed'>('')
const forceWithoutCacheBuster = ref(false)
const pageError = ref('')
const items = ref<RelayChannelProbeOverviewItemDto[]>([])
const legacyChannelTopology = ref<RelayChannelDto[] | null>(null)
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
const multiplierChangeRows = computed<MultiplierChangeRow[]>(() => {
  const rows = items.value.flatMap((item) => {
    const run = item.latestRun
    const sourceMultiplier = Number(run?.sourceChannelMultiplier)
    const targetMultiplier = Number(run?.appliedMultiplier ?? run?.suggestedMultiplier)
    if (!run || !Number.isFinite(sourceMultiplier) || !Number.isFinite(targetMultiplier)) return []
    const change = targetMultiplier - sourceMultiplier
    const changePercent = sourceMultiplier
      ? (Math.abs(change) / Math.abs(sourceMultiplier)) * 100
      : change === 0
        ? 0
        : Number.POSITIVE_INFINITY
    const matchesDirection =
      changeDirection.value === 'all' ||
      (changeDirection.value === 'increase' && change > 0) ||
      (changeDirection.value === 'decrease' && change < 0)
    const applied = Boolean(run.appliedAt)
    const matchesType =
      changeTypeFilter.value === 'all' ||
      (changeTypeFilter.value === 'applied' && applied) ||
      (changeTypeFilter.value === 'suggested' && !applied)
    if (!matchesDirection || !matchesType || changePercent <= changeMinimumPercent.value) return []
    return [
      {
        channelId: item.channelId,
        channelName: item.channelName,
        customerFacingTargets: item.customerFacingTargets,
        sourceMultiplier,
        targetMultiplier,
        change,
        changePercent,
        applied,
        costFactors:
          formatNumber(run.upstreamRateMultiplier) +
          ' × ' +
          formatNumber(run.distributionMultiplier),
        targetCost: targetLocalCost(run),
        time: run.appliedAt ?? run.finishedAt ?? run.createTime,
      },
    ]
  })
  return rows.sort((left, right) => {
    if (changeSort.value === 'largest') return right.changePercent - left.changePercent
    if (changeSort.value === 'smallest') return left.changePercent - right.changePercent
    return new Date(right.time).getTime() - new Date(left.time).getTime()
  })
})
const publicMultiplierChangeRows = computed<MultiplierChangeRow[]>(() => {
  const rowsByCustomerEntry = new Map<string, MultiplierChangeRow>()
  for (const row of multiplierChangeRows.value) {
    for (const target of Array.isArray(row.customerFacingTargets)
      ? row.customerFacingTargets
      : []) {
      const sourceMultiplier = roundMultiplierForPrecision(
        row.sourceMultiplier,
        changeDisplayDigits.value,
        changeDisplayRoundingMode.value,
      )
      const targetMultiplier = roundMultiplierForPrecision(
        row.targetMultiplier,
        changeDisplayDigits.value,
        changeDisplayRoundingMode.value,
      )
      const key = [target.channelId, sourceMultiplier, targetMultiplier].join(':')
      if (rowsByCustomerEntry.has(key)) continue
      rowsByCustomerEntry.set(key, {
        ...row,
        channelId: target.channelId,
        channelName: target.channelName,
        customerFacingTargets: [target],
        sourceMultiplier,
        targetMultiplier,
        change: targetMultiplier - sourceMultiplier,
        changePercent: multiplierRelativeChangePercent(sourceMultiplier, targetMultiplier),
      })
    }
  }
  return [...rowsByCustomerEntry.values()]
})
const applyDirectionMaximumPercent = computed(() =>
  maximumMultiplierRelativeChange(
    applyDrafts.value.map((draft) => [draft.currentMultiplier, draft.targetMultiplier] as const),
  ),
)
const customerFacingDirectionMaximumPercent = computed(() =>
  maximumMultiplierRelativeChange(
    publicMultiplierChangeRows.value.map(
      (row) => [row.sourceMultiplier, row.targetMultiplier] as const,
    ),
  ),
)
const pagedCustomerFacingMultiplierChangeRows = computed(() => {
  const start = (changePage.value - 1) * changePageSize.value
  return publicMultiplierChangeRows.value.slice(start, start + changePageSize.value)
})
const selectedRuns = computed(() =>
  selectedRows.value.flatMap((row) => (isApplicable(row.latestRun) ? [row.latestRun!.id] : [])),
)
const selectedProbeFormats = computed(() => selected.value?.allowedProbeFormats ?? [])
const selectedProbeModels = computed(() => selected.value?.allowedProbeModels ?? [])
const runnableChannelIds = computed(() =>
  selectedRows.value.flatMap((row) => (isRunnable(row) ? [row.channelId] : [])),
)
const batchProfileSources = computed(() => selectedRows.value.filter((row) => Boolean(row.profile)))
const batchProfileTargets = computed(() =>
  selectedRows.value.filter((row) => row.channelId !== batchProfileSourceChannelId.value),
)
const canBatchCopyProfile = computed(
  () => selectedRows.value.length >= 2 && batchProfileSources.value.length > 0,
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
const currenciesMatch = computed(() =>
  Boolean(
    form.value.upstreamCurrency.trim() &&
      form.value.localCurrency.trim() &&
      form.value.upstreamCurrency.trim().toUpperCase() ===
        form.value.localCurrency.trim().toUpperCase(),
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
    credentials.value
      .filter((credential) => Boolean(credential.value))
      .map((credential) => credential.name.trim()),
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
    preventCache: true,
    probeFormat: 'openai',
    probeModel: '',
    distributionMultiplier: 1,
    upstreamCurrency: 'CNY',
    localCurrency: 'CNY',
    upstreamBalanceDivisor: 1,
    upstreamRateMultiplier: 1,
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
  if (
    normalizedName &&
    credentials.value.some((credential) => credential.name.trim() === normalizedName)
  )
    return
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
      preventCache: source.preventCache !== false,
      probeFormat: source.probeFormat as RelayChannelProbeFormat,
      probeModel: source.probeModel,
      distributionMultiplier: Number(source.distributionMultiplier) || 1,
      upstreamCurrency:
        typeof source.upstreamCurrency === 'string' ? source.upstreamCurrency : 'CNY',
      localCurrency: typeof source.localCurrency === 'string' ? source.localCurrency : 'CNY',
      upstreamBalanceDivisor: validBalanceDivisor(source.upstreamBalanceDivisor),
      upstreamRateMultiplier: validUpstreamRateMultiplier(source.upstreamRateMultiplier),
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
function validUpstreamRateMultiplier(value: unknown): number {
  if (value == null) return 1
  const multiplier = Number(value)
  if (!Number.isFinite(multiplier) || multiplier < 0.000001 || multiplier > 1000)
    throw new Error(i18ns.t('relay.channelProbeInvalidUpstreamRate'))
  return multiplier
}
function applyImportedConfiguration() {
  try {
    const imported = parseImportedProfile()
    form.value = {
      enabled: imported.enabled,
      preventCache: imported.preventCache,
      probeFormat: imported.probeFormat,
      probeModel: imported.probeModel,
      distributionMultiplier: imported.distributionMultiplier,
      upstreamCurrency: imported.upstreamCurrency,
      localCurrency: imported.localCurrency,
      upstreamBalanceDivisor: imported.upstreamBalanceDivisor,
      upstreamRateMultiplier: imported.upstreamRateMultiplier,
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
function formatProbeError(message: string) {
  const phases = [
    ['读取请求前余额失败：', 'relay.channelProbePhaseBeforeBalanceFailed'],
    ['最小模型请求失败：', 'relay.channelProbePhaseModelRequestFailed'],
    ['读取请求后余额失败：', 'relay.channelProbePhaseAfterBalanceFailed'],
  ] as const
  const phase = phases.find(([prefix]) => message.startsWith(prefix))
  const phaseReason = phase ? message.slice(phase[0].length).trimStart() : message
  const missingVariable = phaseReason.match(/PROBE_VARIABLE_MISSING:([A-Za-z][A-Za-z0-9_.]*)/)
  const reason = missingVariable
    ? i18ns.t('relay.channelProbeErrorVariableMissing', { variable: missingVariable[1] })
    : phaseReason.includes('PROBE_NETWORK_CONFIGURATION_INVALID') ||
        /invalid ip address:\s*undefined/i.test(phaseReason)
      ? i18ns.t('relay.channelProbeErrorNetworkConfiguration')
      : phaseReason
  if (phase) return i18ns.t(phase[1], { reason })
  return reason
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
function suggestionUnavailableReason(run: RelayChannelProbeRunDto) {
  if (run.suggestedMultiplier != null) return ''
  const profile = selected.value?.profile
  if (profile && profile.upstreamCurrency !== profile.localCurrency)
    return i18ns.t('relay.channelProbeSuggestionCurrencyMismatch', {
      upstream: profile.upstreamCurrency,
      local: profile.localCurrency,
    })
  if (!run.totalTokens) return i18ns.t('relay.channelProbeSuggestionMissingUsage')
  if (run.upstreamBalanceDelta == null || run.upstreamBalanceDelta === 0)
    return i18ns.t('relay.channelProbeSuggestionNoDelta')
  if (run.upstreamBalanceDelta < 0) return i18ns.t('relay.channelProbeSuggestionBalanceIncreased')
  if (!run.baseLocalCost || run.baseLocalCost <= 0)
    return i18ns.t('relay.channelProbeSuggestionNoBaseCost')
  return i18ns.t('relay.channelProbeSuggestionUnavailable')
}
function isRunnable(row: RelayChannelProbeOverviewItemDto) {
  return Boolean(row.enabled && row.profile?.enabled)
}
function canSelectRow(row: RelayChannelProbeOverviewItemDto) {
  return Boolean(
    (canExecute.value && row.enabled) || (canAdjust.value && isApplicable(row.latestRun)),
  )
}
function onSelectionChange(rows: RelayChannelProbeOverviewItemDto[]) {
  selectedRows.value = rows
}
function clearSelection() {
  selectedRows.value = []
  tableRef.value?.clearSelection()
}
function getApplicableRuns(runIds: string[]) {
  const channelById = new Map(items.value.map((item) => [item.channelId, item]))
  const runsById = new Map(
    [...items.value.map((item) => item.latestRun), ...runs.value]
      .filter((run): run is RelayChannelProbeRunDto => Boolean(run?.suggestedMultiplier != null))
      .map((run) => [run.id, run]),
  )
  return runIds.flatMap((runId) => {
    const run = runsById.get(runId)
    const channel = run ? channelById.get(run.relayChannelId) : undefined
    return run && channel && run.suggestedMultiplier != null
      ? [
          {
            run,
            channelName: channel.channelName,
            currentMultiplier: channel.multiplier,
            suggestedMultiplier: run.suggestedMultiplier,
            targetMultiplier: run.suggestedMultiplier,
          },
        ]
      : []
  })
}
function roundDraftMultipliers() {
  for (const draft of applyDrafts.value)
    draft.targetMultiplier = Math.max(
      0.000001,
      roundMultiplierForPrecision(
        draft.suggestedMultiplier,
        roundingDigits.value,
        roundingMode.value,
      ),
    )
}
watch([roundingDigits, roundingMode], () => {
  if (applyDialogOpen.value && applyDrafts.value.length > 0 && !applying.value)
    roundDraftMultipliers()
})
watch(
  [
    rememberApplySettings,
    roundingDigits,
    roundingMode,
    selectionTolerancePercent,
    selectionDirection,
  ],
  () => {
    if (!rememberApplySettings.value) {
      TypedLocalStorage.removeItem(APPLY_SETTINGS_STORAGE_KEY)
      return
    }
    const settings: RememberedApplySettings = {
      roundingDigits: roundingDigits.value,
      roundingMode: roundingMode.value,
      selectionTolerancePercent: selectionTolerancePercent.value,
      selectionDirection: selectionDirection.value,
    }
    TypedLocalStorage.set(APPLY_SETTINGS_STORAGE_KEY, settings)
  },
)
function roundMultiplierForPrecision(value: number, digits: number, mode: 'ceil' | 'nearest') {
  const factor = 10 ** digits
  return (
    (mode === 'ceil'
      ? Math.ceil((value - Number.EPSILON) * factor)
      : Math.round((value + Number.EPSILON) * factor)) / factor
  )
}
function targetLocalCost(run: RelayChannelProbeRunDto) {
  const delta = Number(run.upstreamBalanceDelta ?? 0)
  const upstreamRate = Number(run.upstreamRateMultiplier ?? 1)
  const distribution = Number(run.distributionMultiplier ?? 1)
  const result = delta * upstreamRate * distribution
  return Number.isFinite(result) ? result : undefined
}
function currentChannelMultiplier(run: RelayChannelProbeRunDto) {
  const current = Number(selected.value?.multiplier)
  if (Number.isFinite(current) && current >= 0) return current
  const recorded = Number(run.sourceChannelMultiplier)
  return Number.isFinite(recorded) && recorded >= 0 ? recorded : undefined
}
function estimatedCurrentCharge(run: RelayChannelProbeRunDto) {
  const base = Number(run.baseLocalCost)
  const multiplier = currentChannelMultiplier(run)
  if (!Number.isFinite(base) || base < 0 || multiplier == null) return undefined
  const result = base * multiplier
  return Number.isFinite(result) ? result : undefined
}
function baseCostFormula(run: RelayChannelProbeRunDto) {
  const breakdown = run.costBreakdown
  if (!breakdown) return ''
  if (breakdown.pricingType === 'per-request')
    return i18ns.t('relay.channelProbePerRequestCostFormula', {
      fixed: formatNumber(breakdown.fixedPrice),
      global: formatNumber(breakdown.globalMultiplier),
      time: formatNumber(breakdown.timeMultiplier),
      raw: formatNumber(breakdown.rawCost),
      base: formatNumber(run.baseLocalCost),
    })
  return i18ns.t('relay.channelProbeTokenCostFormula', {
    input: formatNumber(breakdown.billableInputTokens),
    inputRate: formatNumber(breakdown.inputRate),
    cacheCreation: formatNumber(run.cacheCreationTokens),
    cacheCreationMultiplier: formatNumber(breakdown.cacheCreationMultiplier),
    cacheRead: formatNumber(run.cacheReadTokens),
    cacheReadMultiplier: formatNumber(breakdown.cacheReadMultiplier),
    output: formatNumber(run.responseTokens),
    outputRate: formatNumber(breakdown.outputRate),
    global: formatNumber(breakdown.globalMultiplier),
    time: formatNumber(breakdown.timeMultiplier),
    raw: formatNumber(breakdown.rawCost),
    base: formatNumber(run.baseLocalCost),
  })
}
function formatUsage(usage: Record<string, unknown>) {
  return JSON.stringify(usage, null, 2)
}
function multiplierChange(draft: ApplyMultiplierDraft) {
  return draft.targetMultiplier - draft.currentMultiplier
}
function multiplierChangePercent(draft: ApplyMultiplierDraft) {
  return multiplierRelativeChangePercent(draft.currentMultiplier, draft.targetMultiplier)
}
function formatMultiplierChange(draft: ApplyMultiplierDraft) {
  const value = multiplierChange(draft)
  return (value > 0 ? '+' : '') + formatNumber(value) + 'x'
}
function formatMultiplierChangePercent(draft: ApplyMultiplierDraft) {
  const value = multiplierChangePercent(draft)
  return Number.isFinite(value) ? value.toFixed(2) + '%' : '∞'
}
function multiplierChangeClass(draft: ApplyMultiplierDraft) {
  const value = multiplierChange(draft)
  return value > 0 ? 'multiplier-change-up' : value < 0 ? 'multiplier-change-down' : ''
}
function multiplierDirectionClass(currentMultiplier: number, targetMultiplier: number) {
  if (targetMultiplier > currentMultiplier) return 'multiplier-direction-fill-increase'
  if (targetMultiplier < currentMultiplier) return 'multiplier-direction-fill-decrease'
  return 'multiplier-direction-fill-neutral'
}
function multiplierRelativeChangePercent(currentMultiplier: number, targetMultiplier: number) {
  if (!currentMultiplier)
    return targetMultiplier === currentMultiplier ? 0 : Number.POSITIVE_INFINITY
  return (Math.abs(targetMultiplier - currentMultiplier) / Math.abs(currentMultiplier)) * 100
}
function maximumMultiplierRelativeChange(values: ReadonlyArray<readonly [number, number]>) {
  return values.reduce((maximum, [currentMultiplier, targetMultiplier]) => {
    const relativeChange = multiplierRelativeChangePercent(currentMultiplier, targetMultiplier)
    return Number.isFinite(relativeChange) ? Math.max(maximum, relativeChange) : maximum
  }, 0)
}
function multiplierDirectionStyle(
  currentMultiplier: number,
  targetMultiplier: number,
  maximumRelativeChange: number,
) {
  const delta = targetMultiplier - currentMultiplier
  const relativeChange = multiplierRelativeChangePercent(currentMultiplier, targetMultiplier)
  const halfWidth = !Number.isFinite(relativeChange)
    ? 50
    : maximumRelativeChange > 0
      ? Math.min(relativeChange / maximumRelativeChange, 1) * 50
      : 0
  return {
    width: String(halfWidth) + '%',
    left: String(delta < 0 ? 50 - halfWidth : 50) + '%',
  }
}
function multiplierDirectionLabel(currentMultiplier: number, targetMultiplier: number) {
  const direction =
    targetMultiplier > currentMultiplier
      ? i18ns.t('relay.channelProbePriceIncrease')
      : targetMultiplier < currentMultiplier
        ? i18ns.t('relay.channelProbePriceDecrease')
        : i18ns.t('relay.channelProbeCurrentMultiplier')
  return [
    direction,
    formatNumber(currentMultiplier) + 'x',
    '->',
    formatNumber(targetMultiplier) + 'x',
  ].join(' ')
}
function exportMultiplierChangeChart() {
  const rows = publicMultiplierChangeRows.value.slice(0, 20)
  if (!rows.length) {
    ElMessage.warning(i18ns.t('relay.channelProbeExportChangeChartNoPublic'))
    return
  }

  const canvas = document.createElement('canvas')
  const chartWidth = 1600
  const rowHeight = 66
  const chartHeight = 180 + rows.length * rowHeight
  canvas.width = chartWidth
  canvas.height = chartHeight
  const context = canvas.getContext('2d')
  if (!context) {
    ElMessage.error(i18ns.t('operationFailed'))
    return
  }

  const rootStyle = getComputedStyle(document.documentElement)
  const color = (name: string, fallback: string) =>
    rootStyle.getPropertyValue(name).trim() || fallback
  const textPrimary = color('--el-text-color-primary', '#1f2937')
  const textSecondary = color('--el-text-color-secondary', '#667085')
  const line = color('--el-border-color-lighter', '#e4e7ed')
  const decrease = color('--el-color-success', '#16a34a')
  const decreaseMuted = color('--el-color-success-light-8', '#dcfce7')
  const increase = color('--el-color-danger', '#dc2626')
  const increaseMuted = color('--el-color-danger-light-8', '#fee2e2')
  const neutral = color('--el-fill-color-light', '#f3f4f6')
  const maximum = maximumMultiplierRelativeChange(
    rows.map((row) => [row.sourceMultiplier, row.targetMultiplier] as const),
  )
  const axisStart = 610
  const axisWidth = 720
  const axisCenter = axisStart + axisWidth / 2

  context.fillStyle = color('--el-bg-color', '#ffffff')
  context.fillRect(0, 0, chartWidth, chartHeight)
  context.fillStyle = textPrimary
  context.font = '700 34px Microsoft YaHei, sans-serif'
  context.fillText(i18ns.t('relay.channelProbeExportChangeChartTitle'), 72, 68)
  context.fillStyle = textSecondary
  context.font = '20px Microsoft YaHei, sans-serif'
  context.fillText(i18ns.t('relay.channelProbeExportChangeChartSubtitle'), 72, 106)
  context.fillText(new Date().toLocaleString(), chartWidth - 300, 106)

  context.font = '600 18px Microsoft YaHei, sans-serif'
  context.fillStyle = decrease
  context.fillText(i18ns.t('relay.channelProbePriceDecrease'), axisStart, 146)
  context.fillStyle = textSecondary
  context.textAlign = 'center'
  context.fillText(i18ns.t('relay.channelProbeCurrentMultiplier'), axisCenter, 146)
  context.fillStyle = increase
  context.textAlign = 'right'
  context.fillText(i18ns.t('relay.channelProbePriceIncrease'), axisStart + axisWidth, 146)
  context.textAlign = 'left'

  rows.forEach((row, index) => {
    const top = 180 + index * rowHeight
    const changePercent = multiplierRelativeChangePercent(
      row.sourceMultiplier,
      row.targetMultiplier,
    )
    const isDecrease = row.targetMultiplier < row.sourceMultiplier
    const isIncrease = row.targetMultiplier > row.sourceMultiplier
    const relativeWidth = !Number.isFinite(changePercent)
      ? axisWidth / 2
      : maximum > 0
        ? Math.min(changePercent / maximum, 1) * (axisWidth / 2)
        : 0
    const fillStart = isDecrease ? axisCenter - relativeWidth : axisCenter
    const label = isDecrease
      ? i18ns.t('relay.channelProbePriceDecrease')
      : isIncrease
        ? i18ns.t('relay.channelProbePriceIncrease')
        : i18ns.t('relay.channelProbeCurrentMultiplier')

    context.strokeStyle = line
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(72, top + rowHeight - 8)
    context.lineTo(chartWidth - 72, top + rowHeight - 8)
    context.stroke()
    context.fillStyle = textPrimary
    context.font = '600 21px Microsoft YaHei, sans-serif'
    context.fillText(row.channelName.slice(0, 32), 72, top + 24)
    context.fillStyle = textSecondary
    context.font = '18px Microsoft YaHei, sans-serif'
    context.fillText(
      formatNumber(row.sourceMultiplier) + 'x  ->  ' + formatNumber(row.targetMultiplier) + 'x',
      72,
      top + 50,
    )

    context.fillStyle = decreaseMuted
    context.fillRect(axisStart, top + 25, axisWidth / 2, 12)
    context.fillStyle = neutral
    context.fillRect(axisCenter - 2, top + 25, 4, 12)
    context.fillStyle = increaseMuted
    context.fillRect(axisCenter, top + 25, axisWidth / 2, 12)
    context.fillStyle = isDecrease ? decrease : isIncrease ? increase : textSecondary
    context.fillRect(fillStart, top + 25, relativeWidth, 12)
    context.fillStyle = textPrimary
    context.fillRect(axisCenter - 2, top + 21, 4, 20)

    context.fillStyle = isDecrease ? decrease : isIncrease ? increase : textSecondary
    context.font = '600 19px Microsoft YaHei, sans-serif'
    context.textAlign = 'right'
    context.fillText(
      label + ' ' + (Number.isFinite(changePercent) ? changePercent.toFixed(2) + '%' : '∞'),
      chartWidth - 72,
      top + 38,
    )
    context.textAlign = 'left'
  })

  canvas.toBlob((blob) => {
    if (!blob) {
      ElMessage.error(i18ns.t('operationFailed'))
      return
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'service-price-adjustments-' + new Date().toISOString().slice(0, 10) + '.png'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    ElMessage.success(i18ns.t('relay.channelProbeExportChangeCharted'))
  }, 'image/png')
}
function formatChangeValue(value: number) {
  return (value > 0 ? '+' : '') + formatNumber(value) + 'x'
}
function onApplySelectionChange(rows: ApplyMultiplierDraft[]) {
  selectedApplyRunIds.value = rows.map((row) => row.run.id)
}
function clearDraftSelection() {
  applyTableRef.value?.clearSelection()
  selectedApplyRunIds.value = []
}
function isEligibleDraft(draft: ApplyMultiplierDraft) {
  const change = multiplierChange(draft)
  const directionMatches =
    selectionDirection.value === 'all' ||
    (selectionDirection.value === 'increase' && change > 0) ||
    (selectionDirection.value === 'decrease' && change < 0)
  return directionMatches && multiplierChangePercent(draft) > selectionTolerancePercent.value
}
async function selectEligibleDrafts() {
  clearDraftSelection()
  await nextTick()
  for (const draft of applyDrafts.value)
    if (isEligibleDraft(draft)) applyTableRef.value?.toggleRowSelection(draft, true)
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
function resolveCustomerFacingTargets(
  channels: RelayChannelDto[],
  standaloneChannelId: string,
): RelayChannelProbeCustomerFacingTargetDto[] {
  const channelById = new Map(channels.map((channel) => [channel.id, channel]))
  const targetById = new Map<string, RelayChannelProbeCustomerFacingTargetDto>()
  const collectStandaloneMembers = (channelId: string, path = new Set<string>()): string[] => {
    if (path.has(channelId)) return []
    const channel = channelById.get(channelId)
    if (!channel?.enabled) return []
    if (channel.channelType === 'standalone') return [channel.id]
    const nextPath = new Set(path).add(channelId)
    return (channel.poolMembers ?? []).flatMap((member) => {
      if (member.enabled === false || member.memberChannelEnabled === false) return []
      return collectStandaloneMembers(member.memberChannelId, nextPath)
    })
  }
  for (const channel of channels) {
    if (!channel.enabled || channel.channelType !== 'pooled') continue
    if (collectStandaloneMembers(channel.id).includes(standaloneChannelId)) {
      targetById.set(channel.id, { channelId: channel.id, channelName: channel.name })
    }
  }
  if (!targetById.size) {
    const standalone = channelById.get(standaloneChannelId)
    if (standalone?.enabled)
      targetById.set(standalone.id, { channelId: standalone.id, channelName: standalone.name })
  }
  return [...targetById.values()]
}
async function loadOverview() {
  const requestId = ++overviewRequest
  loading.value = true
  pageError.value = ''
  try {
    const result = await relayChannelProbeService.listOverview()
    let overviewItems = result.items
    if (!result.hasCustomerFacingTargets) {
      const channels =
        legacyChannelTopology.value ??
        (await relayChannelService.listChannels({ includeDisabled: true }))
      legacyChannelTopology.value = channels
      overviewItems = overviewItems.map((item) => ({
        ...item,
        customerFacingTargets: resolveCustomerFacingTargets(channels, item.channelId),
      }))
    }
    if (requestId === overviewRequest) items.value = overviewItems
  } catch (error) {
    if (requestId === overviewRequest) {
      pageError.value = getErrorMessage(error, i18ns.t('operationFailed'))
      ElMessage.error(pageError.value)
    }
  } finally {
    if (requestId === overviewRequest) loading.value = false
  }
}
function updateChannelItem(
  channelId: string,
  update: (item: RelayChannelProbeOverviewItemDto) => RelayChannelProbeOverviewItemDto,
) {
  const index = items.value.findIndex((item) => item.channelId === channelId)
  if (index < 0) return
  const next = update(items.value[index]!)
  items.value.splice(index, 1, next)
  if (selected.value?.channelId === channelId) selected.value = next
}
function syncSelectedLatestRun() {
  const channelId = selected.value?.channelId
  if (!channelId) return
  updateChannelItem(channelId, (item) => ({ ...item, latestRun: runs.value[0] }))
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
        preventCache: profile.preventCache,
        probeFormat: profile.probeFormat,
        probeModel: profile.probeModel,
        distributionMultiplier: profile.distributionMultiplier,
        upstreamCurrency: profile.upstreamCurrency,
        localCurrency: profile.localCurrency,
        upstreamBalanceDivisor: profile.upstreamBalanceDivisor,
        upstreamRateMultiplier: profile.upstreamRateMultiplier,
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
      ...(Object.keys(step.headers || {}).length ||
      Object.keys(step.query || {}).length ||
      Object.keys(step.body || {}).length
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
    if (requestId === runsRequest) {
      runs.value = result.items
      syncSelectedLatestRun()
    }
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
    const profile = await relayChannelProbeService.saveProfile(selected.value.channelId, {
      ...form.value,
      upstreamCurrency: form.value.upstreamCurrency.toUpperCase(),
      localCurrency: form.value.localCurrency.toUpperCase(),
      probePayload: parseObject(payloadText.value, i18ns.t('relay.channelProbePayload')),
      workflow: formWorkflow(),
      ...(Object.keys(credentialMap).length ? { credentials: credentialMap } : {}),
    })
    ElMessage.success(i18ns.t('success'))
    updateChannelItem(selected.value.channelId, (item) => ({ ...item, profile }))
    credentialNames.value = profile.credentialNames
    credentials.value = []
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
    updateChannelItem(channelId, (item) => ({ ...item, profile: undefined }))
    credentialNames.value = []
    credentials.value = []
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
    const queued = await relayChannelProbeService.createRun(row.channelId, {
      forceWithoutCacheBuster: forceWithoutCacheBuster.value,
    })
    ElMessage.success(i18ns.t('relay.channelProbeQueued'))
    updateChannelItem(row.channelId, (item) => ({ ...item, latestRun: queued }))
    if (selected.value?.channelId === row.channelId) await loadRuns()
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
    await ElMessageBox.confirm(i18ns.t('relay.channelProbeResetStateConfirm'), i18ns.t('warning'), {
      type: 'warning',
      confirmButtonText: i18ns.t('confirm'),
      cancelButtonText: i18ns.t('cancel'),
    })
  } catch {
    return
  }
  resettingChannelId.value = row.channelId
  try {
    await relayChannelProbeService.resetRunState(row.channelId)
    ElMessage.success(i18ns.t('relay.channelProbeStateReset'))
    if (selected.value?.channelId === row.channelId) await loadRuns()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
  } finally {
    resettingChannelId.value = ''
  }
}
async function confirmClearRunHistory(scope: 'all' | 'failed') {
  const channelId = selected.value?.channelId
  if (!channelId || clearingHistoryScope.value) return
  try {
    await ElMessageBox.confirm(
      i18ns.t(
        scope === 'all'
          ? 'relay.channelProbeClearHistoryConfirm'
          : 'relay.channelProbeClearFailuresConfirm',
      ),
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
  clearingHistoryScope.value = scope
  try {
    const result = await relayChannelProbeService.clearRunHistory(channelId, scope)
    ElMessage.success(i18ns.t('relay.channelProbeHistoryCleared', { count: result.deleted }))
    await loadRuns()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
  } finally {
    clearingHistoryScope.value = ''
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
    const result = await relayChannelProbeService.createRuns({
      channelIds,
      forceWithoutCacheBuster: forceWithoutCacheBuster.value,
    })
    if (result.queued.length)
      ElMessage.success(i18ns.t('relay.channelProbeBatchQueued', { count: result.queued.length }))
    if (result.rejected.length)
      ElMessage.warning(result.rejected.map((item: { reason: string }) => item.reason).join('；'))
    clearSelection()
    for (const run of result.queued)
      updateChannelItem(run.relayChannelId, (item) => ({ ...item, latestRun: run }))
    if (
      selected.value &&
      result.queued.some(
        (run: { relayChannelId: string }) => run.relayChannelId === selected.value?.channelId,
      )
    )
      await loadRuns()
    startPolling()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
  } finally {
    batchRunning.value = false
  }
}
function openBatchProfileDialog() {
  batchProfileSourceChannelId.value = batchProfileSources.value[0]?.channelId ?? ''
  batchProfileOverwriteExisting.value = false
  batchProfileDialogOpen.value = true
}
function resetBatchProfileDialog() {
  batchProfileSourceChannelId.value = ''
  batchProfileOverwriteExisting.value = false
  batchProfileSaving.value = false
}
async function submitBatchProfileCopy() {
  const sourceChannelId = batchProfileSourceChannelId.value
  const targetChannelIds = batchProfileTargets.value.map((row) => row.channelId)
  if (!sourceChannelId || !targetChannelIds.length || batchProfileSaving.value) return
  batchProfileSaving.value = true
  try {
    const result = await relayChannelProbeService.copyProfile({
      sourceChannelId,
      targetChannelIds,
      overwriteExisting: batchProfileOverwriteExisting.value,
    })
    for (const profile of result.copied)
      updateChannelItem(profile.relayChannelId, (item) => ({ ...item, profile }))
    if (result.copied.length)
      ElMessage.success(
        i18ns.t('relay.channelProbeBatchConfigured', { count: result.copied.length }),
      )
    if (result.rejected.length)
      ElMessage.warning(result.rejected.map((item: { reason: string }) => item.reason).join('；'))
    if (!result.rejected.length) batchProfileDialogOpen.value = false
  } catch (error) {
    ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
  } finally {
    batchProfileSaving.value = false
  }
}
async function confirmApply(runIds: string[]) {
  if (!runIds.length || applying.value) return
  const drafts = getApplicableRuns(runIds)
  if (!drafts.length) return ElMessage.warning(i18ns.t('relay.channelProbeApplyUnavailable'))
  applyDrafts.value = drafts
  roundDraftMultipliers()
  applyDialogOpen.value = true
  await nextTick()
  await selectEligibleDrafts()
}
async function submitApplyMultipliers() {
  const selectedDrafts = applyDrafts.value.filter((draft) =>
    selectedApplyRunIds.value.includes(draft.run.id),
  )
  if (!selectedDrafts.length || applying.value)
    return ElMessage.warning(i18ns.t('relay.channelProbeSelectionRequired'))
  if (
    selectedDrafts.some(
      (draft) =>
        !Number.isFinite(draft.targetMultiplier) ||
        draft.targetMultiplier < 0.000001 ||
        draft.targetMultiplier > 1000,
    )
  )
    return ElMessage.warning(i18ns.t('relay.channelProbeTargetMultiplierInvalid'))
  const runIds = selectedDrafts.map((draft) => draft.run.id)
  const targetMultiplierByRunId = new Map(
    selectedDrafts.map((draft) => [draft.run.id, draft.targetMultiplier]),
  )
  applying.value = true
  try {
    const result = await relayChannelProbeService.applyRuns({
      runIds,
      overrides: selectedDrafts.map((draft) => ({
        runId: draft.run.id,
        multiplier: draft.targetMultiplier,
      })),
    })
    if (result.applied)
      ElMessage.success(i18ns.t('relay.channelProbeApplied', { count: result.applied }))
    if (result.rejected.length)
      ElMessage.warning(result.rejected.map((item: { reason: string }) => item.reason).join('；'))
    const rejectedRunIds = new Set(result.rejected.map((item: { runId: string }) => item.runId))
    const appliedRunIds = runIds.filter((runId) => !rejectedRunIds.has(runId))
    for (const runId of appliedRunIds) {
      const draft = applyDrafts.value.find((item) => item.run.id === runId)
      const targetMultiplier = targetMultiplierByRunId.get(runId)
      if (!draft || targetMultiplier == null) continue
      updateChannelItem(draft.run.relayChannelId, (item) => ({
        ...item,
        multiplier: targetMultiplier,
        latestRun:
          item.latestRun?.id === runId
            ? {
                ...item.latestRun,
                appliedMultiplier: targetMultiplier,
                appliedAt: new Date().toISOString(),
              }
            : item.latestRun,
      }))
    }
    if (selected.value && appliedRunIds.some((runId) => runs.value.some((run) => run.id === runId)))
      await loadRuns()
    const remainingDrafts = applyDrafts.value.filter(
      (draft) => !appliedRunIds.includes(draft.run.id),
    )
    if (remainingDrafts.length) {
      applyDrafts.value = remainingDrafts
      selectedApplyRunIds.value = remainingDrafts
        .filter((draft) => rejectedRunIds.has(draft.run.id))
        .map((draft) => draft.run.id)
    } else {
      applyDialogOpen.value = false
      applyDrafts.value = []
      selectedApplyRunIds.value = []
      clearSelection()
    }
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
    }
  }, 3000)
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = undefined
}
watch([keyword, profileFilter, enabledFilter, runStatusFilter, suggestionFilter], clearSelection)
watch(
  [
    changeSort,
    changeDirection,
    changeTypeFilter,
    changeMinimumPercent,
    changeDisplayDigits,
    changeDisplayRoundingMode,
    changePageSize,
  ],
  () => {
    changePage.value = 1
  },
)
onMounted(() => {
  try {
    const saved = TypedLocalStorage.getItem(APPLY_SETTINGS_STORAGE_KEY)
    if (saved) {
      const settings = JSON.parse(saved) as Partial<RememberedApplySettings>
      if (settings.roundingMode === 'ceil' || settings.roundingMode === 'nearest')
        roundingMode.value = settings.roundingMode
      if (
        Number.isInteger(settings.roundingDigits) &&
        settings.roundingDigits! >= 0 &&
        settings.roundingDigits! <= 6
      )
        roundingDigits.value = settings.roundingDigits!
      if (
        Number.isFinite(settings.selectionTolerancePercent) &&
        settings.selectionTolerancePercent! >= 0 &&
        settings.selectionTolerancePercent! <= 100
      )
        selectionTolerancePercent.value = settings.selectionTolerancePercent!
      if (
        settings.selectionDirection === 'all' ||
        settings.selectionDirection === 'increase' ||
        settings.selectionDirection === 'decrease'
      )
        selectionDirection.value = settings.selectionDirection
      rememberApplySettings.value = true
    }
  } catch {
    TypedLocalStorage.removeItem(APPLY_SETTINGS_STORAGE_KEY)
  }
  void loadOverview()
})
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
.page-header-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
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
.probe-drawer-summary {
  margin: 0 0 18px;
  border: 1px solid var(--el-border-color-lighter);
  border-top: 3px solid var(--el-color-primary);
  background: var(--el-fill-color-extra-light);
}
.probe-summary-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.probe-summary-heading > div:first-child {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.probe-summary-heading strong {
  overflow: hidden;
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eyebrow {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.summary-state-tags {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}
.probe-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.probe-summary-item {
  display: grid;
  min-width: 0;
  gap: 5px;
  padding: 12px 16px;
  border-right: 1px solid var(--el-border-color-lighter);
}
.probe-summary-item:last-child {
  border-right: 0;
}
.probe-summary-item > span,
.probe-summary-item small {
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.probe-summary-item > strong {
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.probe-summary-wide {
  grid-column: span 2;
}
.summary-run-state {
  display: grid;
  min-width: 0;
  gap: 5px;
}
.selection-summary {
  margin-right: auto;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.request-config-grid,
.calibration-config-grid,
.workflow-route-grid,
.workflow-request-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
}
.request-config-grid {
  grid-template-columns: minmax(180px, 0.7fr) minmax(260px, 1.3fr);
}
.request-model-field {
  min-width: 0;
}
.calibration-config-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.profile-section {
  margin: 0 0 18px;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}
.profile-section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin: 0 0 14px;
}
.profile-section-header > div {
  display: grid;
  gap: 4px;
}
.profile-section-header strong {
  font-size: 15px;
}
.profile-section-header span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
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
.run-title {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.runs-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: flex-start;
  margin-bottom: 12px;
}
.cache-buster-switch {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 0 0;
}
.cache-buster-switch > span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.usage-details {
  margin-top: 10px;
}
.usage-details pre {
  max-height: 240px;
  margin: 0;
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-regular);
  font:
    12px/1.5 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
.calibration-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.calibration-toolbar .el-input-number {
  width: 112px;
}
.selection-direction {
  width: 128px;
}
.rounding-mode {
  width: 118px;
}
.calibration-toolbar-divider {
  width: 1px;
  height: 20px;
  margin: 0 2px;
  background: var(--el-border-color);
}
.selected-draft-summary {
  margin-left: auto;
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 600;
}
.change-analysis-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 0 14px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.change-analysis-toolbar .el-select {
  width: 132px;
}
.change-analysis-toolbar .el-input-number {
  width: 112px;
}
.change-analysis-toolbar .el-button {
  margin-left: auto;
}
.multiplier-change-cell {
  display: grid;
  min-width: 244px;
  gap: 6px;
}
.multiplier-direction-bar {
  position: relative;
  display: grid;
  min-width: 244px;
  height: 26px;
  grid-template-columns: 1fr auto 1fr;
  align-items: start;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  line-height: 1;
}
.multiplier-direction-label {
  z-index: 2;
}
.multiplier-direction-label-left {
  text-align: left;
}
.multiplier-direction-label-center {
  padding: 0 6px;
  color: var(--el-text-color-regular);
  font-weight: 600;
}
.multiplier-direction-label-right {
  text-align: right;
}
.multiplier-direction-track,
.multiplier-direction-fill,
.multiplier-direction-zero {
  position: absolute;
  top: 17px;
  height: 6px;
}
.multiplier-direction-track {
  right: 0;
  left: 0;
  overflow: hidden;
  border-radius: 1px;
  background: var(--el-fill-color-light);
}
.multiplier-direction-track::before,
.multiplier-direction-track::after {
  position: absolute;
  top: 0;
  width: 50%;
  height: 100%;
  content: '';
}
.multiplier-direction-track::before {
  left: 0;
  background: var(--el-color-success-light-8);
}
.multiplier-direction-track::after {
  right: 0;
  background: var(--el-color-danger-light-8);
}
.multiplier-direction-zero {
  z-index: 2;
  left: calc(50% - 1px);
  width: 2px;
  background: var(--el-text-color-primary);
}
.multiplier-direction-fill {
  z-index: 1;
  border-radius: 1px;
}
.multiplier-direction-fill-decrease {
  background: var(--el-color-success);
}
.multiplier-direction-fill-increase {
  background: var(--el-color-danger);
}
.multiplier-direction-fill-neutral {
  background: var(--el-color-info);
}
.multiplier-change-up {
  color: var(--el-color-success);
}
.multiplier-change-down {
  color: var(--el-color-danger);
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
  .probe-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .probe-summary-item:nth-child(2) {
    border-right: 0;
  }
  .probe-summary-item:nth-child(n + 3) {
    border-top: 1px solid var(--el-border-color-lighter);
  }
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
  .probe-summary-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .summary-state-tags {
    justify-content: flex-start;
  }
  .probe-summary-grid {
    grid-template-columns: 1fr;
  }
  .probe-summary-item,
  .probe-summary-item:nth-child(2) {
    border-right: 0;
  }
  .probe-summary-item:not(:first-child) {
    border-top: 1px solid var(--el-border-color-lighter);
  }
  .probe-summary-wide {
    grid-column: auto;
  }
  .channel-probe-page {
    padding: 16px;
  }
  .page-header {
    flex-direction: column;
  }
  .page-header-actions {
    width: 100%;
  }
  .probe-filters,
  .request-config-grid,
  .calibration-config-grid,
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
  .calibration-toolbar {
    justify-content: flex-start;
  }
  .selected-draft-summary {
    width: 100%;
    margin-left: 0;
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
