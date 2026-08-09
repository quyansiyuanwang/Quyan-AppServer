<template>
  <el-dialog
    v-model="showTemplateDialog"
    :title="templateDialogTitle"
    :width="isDesktop ? '720px' : '94%'"
  >
    <el-form label-width="130px">
      <el-form-item :label="i18ns.t('monthlyPass.templateName')" required>
        <el-input v-model="templateForm.name" maxlength="100" />
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.description')">
        <el-input v-model="templateForm.description" type="textarea" :rows="3" maxlength="1000" />
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.originalPrice')" required>
        <el-input-number
          v-model="templateForm.originalPrice"
          :min="0.0001"
          :max="MAX_AMOUNT_QUOTA"
          :precision="4"
          :step="0.0001"
          style="width: 240px"
        />
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.discountPercent')" required>
        <el-input-number
          v-model="templateForm.discountPercent"
          :min="0"
          :max="100"
          :precision="2"
          :step="0.01"
          style="width: 240px"
        />
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.pricingPreview')">
        <div class="template-pricing-preview">
          <div class="template-pricing-preview__card">
            <span class="template-pricing-preview__label">{{
              i18ns.t('monthlyPass.discountedPrice')
            }}</span>
            <strong class="template-pricing-preview__value">{{
              formatPriceValue(templatePricingPreview.discountedPrice)
            }}</strong>
          </div>
          <div class="template-pricing-preview__card">
            <span class="template-pricing-preview__label">{{
              i18ns.t('monthlyPass.derivedQuota')
            }}</span>
            <strong class="template-pricing-preview__value">{{
              formatQuotaValue(templatePricingPreview.derivedQuota, 'amount')
            }}</strong>
          </div>
          <div class="template-pricing-preview__card">
            <span class="template-pricing-preview__label">{{
              i18ns.t('monthlyPass.rechargeRatio')
            }}</span>
            <strong class="template-pricing-preview__value">{{
              formatRatioValue(templatePricingPreview.rechargeRatio)
            }}</strong>
          </div>
        </div>
        <div class="template-pricing-preview__hint">
          {{
            i18ns.t('monthlyPass.pricingDerivedHint', {
              ratio: formatRatioValue(templatePricingPreview.rechargeRatio),
            })
          }}
        </div>
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.allowBalanceRedemption')">
        <div class="template-toggle-field">
          <el-switch v-model="templateForm.allowBalanceRedemption" />
          <span class="template-toggle-field__hint">
            {{ i18ns.t('monthlyPass.allowBalanceRedemptionHint') }}
          </span>
        </div>
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.validityDays')" required>
        <div class="template-validity-field">
          <el-input-number
            v-model="templateForm.validityDays"
            :min="1"
            :max="3650"
            :step="1"
            :precision="0"
          />
          <span class="template-validity-field__unit">{{ i18ns.t('monthlyPass.daysUnit') }}</span>
        </div>
        <div class="quota-window-value">{{ i18ns.t('monthlyPass.validityDaysHint') }}</div>
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.purchaseLimit')">
        <div class="template-purchase-limit-field">
          <div class="template-purchase-limit-field__row">
            <el-input-number
              v-model="templateForm.purchaseLimitPerUser"
              :min="1"
              :max="9999"
              :precision="0"
              :step="1"
              style="width: 180px"
            />
            <span class="template-purchase-limit-field__separator">/</span>
            <el-input-number
              v-model="templateForm.purchaseLimitWindowDays"
              :min="1"
              :max="3650"
              :precision="0"
              :step="1"
              style="width: 180px"
            />
            <el-button link type="primary" @click="clearTemplatePurchaseLimit">
              {{ i18ns.t('monthlyPass.unlimited') }}
            </el-button>
          </div>
          <div class="template-purchase-limit-field__hint">
            {{ i18ns.t('monthlyPass.purchaseLimitHint') }}
          </div>
        </div>
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.dailyQuota')">
        <div class="quota-form-row">
          <el-input-number
            v-model="templateForm.dailyQuota"
            :min="0.0001"
            :max="MAX_AMOUNT_QUOTA"
            :precision="4"
            :step="0.0001"
            style="width: 240px"
          />
          <el-button link type="primary" @click="templateForm.dailyQuota = undefined">
            {{ i18ns.t('monthlyPass.unlimited') }}
          </el-button>
        </div>
        <div class="quota-window-value">{{ i18ns.t('monthlyPass.dailyQuotaHint') }}</div>
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.quotaWindows')">
        <div class="quota-window-editor">
          <div v-if="templateForm.quotaWindows.length" class="quota-window-editor__list">
            <div
              v-for="(quotaWindow, index) in templateForm.quotaWindows"
              :key="quotaWindow.id"
              class="quota-window-editor__item"
            >
              <div class="quota-window-editor__header">
                <span class="quota-window-editor__badge">#{{ index + 1 }}</span>
                <span class="quota-window-editor__title">{{
                  i18ns.t('monthlyPass.quotaWindows')
                }}</span>
              </div>
              <el-input-number
                v-model="quotaWindow.quotaLimit"
                :min="getQuotaMin(quotaWindow.quotaUnit)"
                :max="getQuotaMax(quotaWindow.quotaUnit)"
                :precision="getQuotaPrecision(quotaWindow.quotaUnit)"
                :step="getQuotaStep(quotaWindow.quotaUnit)"
                class="quota-window-editor__number"
              />
              <el-select v-model="quotaWindow.quotaUnit" class="quota-window-editor__select">
                <el-option :label="i18ns.t('monthlyPass.quotaUnitAmount')" value="amount" />
                <el-option :label="i18ns.t('monthlyPass.quotaUnitRequest')" value="request" />
                <el-option :label="i18ns.t('monthlyPass.quotaUnitToken')" value="token" />
              </el-select>
              <div class="quota-window-picker quota-window-editor__picker">
                <el-input-number
                  v-model="quotaWindow.days"
                  :min="0"
                  :max="30"
                  :step="1"
                  :precision="0"
                  class="quota-window-input"
                  @change="updateEditableQuotaWindowHours(quotaWindow)"
                />
                <span class="quota-window-unit">{{ i18ns.t('monthlyPass.daysUnit') }}</span>
                <el-input-number
                  v-model="quotaWindow.hours"
                  :min="0"
                  :max="23"
                  :step="1"
                  :precision="0"
                  class="quota-window-input"
                  @change="updateEditableQuotaWindowHours(quotaWindow)"
                />
                <span class="quota-window-unit">{{ i18ns.t('monthlyPass.hoursUnit') }}</span>
              </div>
              <div class="quota-window-editor__actions">
                <el-button link type="primary" @click="clearEditableQuotaWindow(quotaWindow)">
                  {{ i18ns.t('monthlyPass.clearWindow') }}
                </el-button>
                <el-button link type="danger" @click="removeTemplateQuotaWindow(index)">
                  {{ i18ns.t('delete') }}
                </el-button>
              </div>
            </div>
          </div>
          <div v-else class="quota-window-value">{{ i18ns.t('monthlyPass.noQuotaWindows') }}</div>
          <el-button type="primary" link @click="addTemplateQuotaWindow">
            {{ i18ns.t('monthlyPass.addQuotaWindow') }}
          </el-button>
        </div>
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.allowedModels')">
        <el-select
          v-model="templateForm.allowedModels"
          multiple
          filterable
          allow-create
          default-first-option
          collapse-tags
          collapse-tags-tooltip
          :placeholder="i18ns.t('monthlyPass.allModels')"
          style="width: 100%"
        >
          <el-option
            v-for="model in availableTemplateModelOptions"
            :key="model"
            :label="model"
            :value="model"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.allowedChannels')">
        <el-select
          v-model="templateForm.allowedChannels"
          multiple
          filterable
          allow-create
          default-first-option
          collapse-tags
          collapse-tags-tooltip
          :placeholder="i18ns.t('monthlyPass.allChannels')"
          style="width: 100%"
          @change="handleTemplateAllowedChannelsChange"
        >
          <el-option
            v-for="channel in channelOptions"
            :key="channel.value"
            :label="channel.label"
            :value="channel.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item v-if="editingTemplateId" :label="i18ns.t('monthlyPass.status')">
        <el-select v-model="templateForm.status" style="width: 200px">
          <el-option :label="i18ns.t('monthlyPass.enabled')" :value="MANAGED_STATUS.ENABLED" />
          <el-option :label="i18ns.t('monthlyPass.disabled')" :value="MANAGED_STATUS.DISABLED" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="showTemplateDialog = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button type="primary" :loading="savingTemplate" @click="submitTemplate">{{
        i18ns.t('confirm')
      }}</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="showAssignmentDialog"
    :title="
      editingAssignmentId
        ? i18ns.t('monthlyPass.editAssignment')
        : assignmentForm.batchMode
          ? i18ns.t('monthlyPass.createBatchAssignment')
          : i18ns.t('monthlyPass.createAssignment')
    "
    :width="isDesktop ? '720px' : '94%'"
  >
    <el-form label-width="130px">
      <el-form-item
        v-if="!editingAssignmentId"
        :label="i18ns.t('monthlyPass.assignmentTargetType')"
      >
        <el-switch
          v-model="assignmentForm.batchMode"
          :active-text="i18ns.t('monthlyPass.batchAssignmentMode')"
          :inactive-text="i18ns.t('monthlyPass.singleAssignmentMode')"
        />
      </el-form-item>
      <template v-if="!assignmentForm.batchMode || editingAssignmentId">
        <el-form-item :label="i18ns.t('monthlyPass.user')" required>
          <el-select
            v-model="assignmentForm.userId"
            filterable
            remote
            reserve-keyword
            :disabled="Boolean(editingAssignmentId)"
            :loading="userOptionsLoading"
            :remote-method="handleUserSearch"
            :placeholder="i18ns.t('monthlyPass.selectUser')"
            style="width: 100%"
          >
            <el-option
              v-for="user in userOptions"
              :key="user.id"
              :label="`${user.username} (${user.id})`"
              :value="user.id"
            />
          </el-select>
        </el-form-item>
      </template>
      <template v-else>
        <el-form-item :label="i18ns.t('monthlyPass.assignmentMode')">
          <el-radio-group v-model="assignmentForm.assignmentMode">
            <el-radio value="create_new">{{
              i18ns.t('monthlyPass.assignmentModeCreateNew')
            }}</el-radio>
            <el-radio value="extend_existing">{{
              i18ns.t('monthlyPass.assignmentModeExtendExisting')
            }}</el-radio>
          </el-radio-group>
          <div class="quota-window-value">{{ i18ns.t('monthlyPass.assignmentModeHint') }}</div>
        </el-form-item>
        <el-form-item :label="i18ns.t('monthlyPass.batchTargetFilter')">
          <div class="batch-target-panel">
            <div class="batch-target-panel__filters">
              <el-input
                v-model="assignmentForm.batchKeyword"
                :placeholder="i18ns.t('monthlyPass.batchKeywordPlaceholder')"
                clearable
              />
              <el-select
                v-model="assignmentForm.batchGroupId"
                clearable
                :placeholder="i18ns.t('monthlyPass.batchGroupPlaceholder')"
              >
                <el-option
                  v-for="group in groupOptions"
                  :key="group.id"
                  :label="`${group.name} (${group.username})`"
                  :value="group.id"
                />
              </el-select>
              <el-button :loading="batchUserOptionsLoading" @click="loadBatchUserOptions">
                {{ i18ns.t('search') }}
              </el-button>
            </div>
            <el-checkbox v-model="assignmentForm.includeAllVisible">
              {{ i18ns.t('monthlyPass.includeAllVisible') }}
            </el-checkbox>
            <div class="batch-target-panel__actions">
              <el-button link type="primary" @click="selectAllVisibleBatchUsers">
                {{ i18ns.t('monthlyPass.selectAllVisible') }}
              </el-button>
              <el-button link @click="clearBatchUserSelection">
                {{ i18ns.t('monthlyPass.clearSelection') }}
              </el-button>
              <span class="quota-window-value">{{ batchSelectionSummary }}</span>
            </div>
            <el-select
              v-model="assignmentForm.userIds"
              multiple
              filterable
              collapse-tags
              collapse-tags-tooltip
              :disabled="assignmentForm.includeAllVisible"
              :loading="batchUserOptionsLoading"
              :placeholder="i18ns.t('monthlyPass.batchSelectUsers')"
              style="width: 100%"
            >
              <el-option
                v-for="user in batchUserOptions"
                :key="user.id"
                :label="`${user.username} (${user.id})`"
                :value="user.id"
              />
            </el-select>
            <div
              v-if="selectedBatchUsers.length && !assignmentForm.includeAllVisible"
              class="batch-selected-users"
            >
              <el-tag
                v-for="user in selectedBatchUsers"
                :key="user.id"
                closable
                @close="
                  assignmentForm.userIds = assignmentForm.userIds.filter((id) => id !== user.id)
                "
              >
                {{ user.username }}
              </el-tag>
            </div>
          </div>
        </el-form-item>
      </template>
      <el-form-item :label="i18ns.t('monthlyPass.template')" required>
        <el-select
          v-model="assignmentForm.templateId"
          filterable
          :disabled="Boolean(editingAssignmentId)"
          :placeholder="i18ns.t('monthlyPass.selectTemplate')"
          style="width: 100%"
          @change="handleAssignmentTemplateChange"
        >
          <el-option
            v-for="template in assignableTemplateOptions"
            :key="template.id"
            :label="template.name"
            :value="template.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.startAt')" required>
        <el-date-picker
          v-model="assignmentForm.startAt"
          type="datetime"
          value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.endAt')" required>
        <el-date-picker
          v-model="assignmentForm.endAt"
          type="datetime"
          value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.quickTimeActions')">
        <div class="quick-time-panel">
          <div class="quick-time-row quick-time-custom-row">
            <span class="quick-time-label">{{ i18ns.t('monthlyPass.customDays') }}</span>
            <el-input-number
              v-model="quickDurationDays"
              :min="1"
              :step="1"
              :precision="0"
              class="quick-time-input"
            />
            <el-button size="small" @click="applyQuickDuration">
              {{ i18ns.t('monthlyPass.applyDuration') }}
            </el-button>
            <el-button size="small" @click="increaseAssignmentDuration">
              {{ i18ns.t('monthlyPass.increaseDuration') }}
            </el-button>
            <el-button size="small" @click="decreaseAssignmentDuration">
              {{ i18ns.t('monthlyPass.decreaseDuration') }}
            </el-button>
          </div>
          <div class="quick-time-row">
            <span class="quick-time-label">{{ i18ns.t('monthlyPass.setDuration') }}</span>
            <el-button size="small" @click="setAssignmentDurationDays(1)">{{
              i18ns.t('monthlyPass.duration1d')
            }}</el-button>
            <el-button size="small" @click="setAssignmentDurationDays(7)">{{
              i18ns.t('monthlyPass.duration7d')
            }}</el-button>
            <el-button size="small" @click="setAssignmentDurationDays(30)">{{
              i18ns.t('monthlyPass.duration30d')
            }}</el-button>
          </div>
          <div class="quick-time-row">
            <span class="quick-time-label">{{ i18ns.t('monthlyPass.shiftEnd') }}</span>
            <el-button size="small" @click="shiftAssignmentEndDays(1)">{{
              i18ns.t('monthlyPass.shiftPlus1d')
            }}</el-button>
            <el-button size="small" @click="shiftAssignmentEndDays(7)">{{
              i18ns.t('monthlyPass.shiftPlus7d')
            }}</el-button>
            <el-button size="small" @click="shiftAssignmentEndDays(30)">{{
              i18ns.t('monthlyPass.shiftPlus30d')
            }}</el-button>
            <el-button size="small" @click="shiftAssignmentEndDays(-1)">{{
              i18ns.t('monthlyPass.shiftMinus1d')
            }}</el-button>
            <el-button size="small" @click="shiftAssignmentEndDays(-7)">{{
              i18ns.t('monthlyPass.shiftMinus7d')
            }}</el-button>
            <el-button size="small" @click="shiftAssignmentEndDays(-30)">{{
              i18ns.t('monthlyPass.shiftMinus30d')
            }}</el-button>
          </div>
        </div>
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.totalQuota')">
        <el-input-number
          :key="`assignment-total-${assignmentForm.quotaUnit}`"
          v-model="assignmentForm.totalQuota"
          :min="getQuotaMin(assignmentForm.quotaUnit)"
          :max="getQuotaMax(assignmentForm.quotaUnit)"
          :precision="getQuotaPrecision(assignmentForm.quotaUnit)"
          :step="getQuotaStep(assignmentForm.quotaUnit)"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.dailyQuota')">
        <div class="quota-form-row">
          <el-input-number
            :key="`assignment-daily-${assignmentForm.quotaUnit}`"
            v-model="assignmentForm.dailyQuota"
            :min="getQuotaMin(assignmentForm.quotaUnit)"
            :max="getQuotaMax(assignmentForm.quotaUnit)"
            :precision="getQuotaPrecision(assignmentForm.quotaUnit)"
            :step="getQuotaStep(assignmentForm.quotaUnit)"
            style="width: 240px"
          />
          <el-button link type="primary" @click="assignmentForm.dailyQuota = undefined">
            {{ i18ns.t('monthlyPass.unlimited') }}
          </el-button>
        </div>
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.quotaUnit')">
        <el-select v-model="assignmentForm.quotaUnit" style="width: 240px">
          <el-option :label="i18ns.t('monthlyPass.quotaUnitAmount')" value="amount" />
          <el-option :label="i18ns.t('monthlyPass.quotaUnitRequest')" value="request" />
          <el-option :label="i18ns.t('monthlyPass.quotaUnitToken')" value="token" />
        </el-select>
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.quotaWindows')">
        <div class="quota-window-editor">
          <div v-if="assignmentForm.quotaWindows.length" class="quota-window-editor__list">
            <div
              v-for="(quotaWindow, index) in assignmentForm.quotaWindows"
              :key="quotaWindow.id"
              class="quota-window-editor__item"
            >
              <div class="quota-window-editor__header">
                <span class="quota-window-editor__badge">#{{ index + 1 }}</span>
                <span class="quota-window-editor__title">{{
                  i18ns.t('monthlyPass.quotaWindows')
                }}</span>
              </div>
              <el-input-number
                v-model="quotaWindow.quotaLimit"
                :min="getQuotaMin(quotaWindow.quotaUnit)"
                :max="getQuotaMax(quotaWindow.quotaUnit)"
                :precision="getQuotaPrecision(quotaWindow.quotaUnit)"
                :step="getQuotaStep(quotaWindow.quotaUnit)"
                class="quota-window-editor__number"
              />
              <el-select v-model="quotaWindow.quotaUnit" class="quota-window-editor__select">
                <el-option :label="i18ns.t('monthlyPass.quotaUnitAmount')" value="amount" />
                <el-option :label="i18ns.t('monthlyPass.quotaUnitRequest')" value="request" />
                <el-option :label="i18ns.t('monthlyPass.quotaUnitToken')" value="token" />
              </el-select>
              <div class="quota-window-picker quota-window-editor__picker">
                <el-input-number
                  v-model="quotaWindow.days"
                  :min="0"
                  :max="30"
                  :step="1"
                  :precision="0"
                  class="quota-window-input"
                  @change="updateEditableQuotaWindowHours(quotaWindow)"
                />
                <span class="quota-window-unit">{{ i18ns.t('monthlyPass.daysUnit') }}</span>
                <el-input-number
                  v-model="quotaWindow.hours"
                  :min="0"
                  :max="23"
                  :step="1"
                  :precision="0"
                  class="quota-window-input"
                  @change="updateEditableQuotaWindowHours(quotaWindow)"
                />
                <span class="quota-window-unit">{{ i18ns.t('monthlyPass.hoursUnit') }}</span>
              </div>
              <div class="quota-window-editor__actions">
                <el-button link type="primary" @click="clearEditableQuotaWindow(quotaWindow)">
                  {{ i18ns.t('monthlyPass.clearWindow') }}
                </el-button>
                <el-button link type="danger" @click="removeAssignmentQuotaWindow(index)">
                  {{ i18ns.t('delete') }}
                </el-button>
              </div>
            </div>
          </div>
          <div v-else class="quota-window-value">{{ i18ns.t('monthlyPass.noQuotaWindows') }}</div>
          <el-button type="primary" link @click="addAssignmentQuotaWindow">
            {{ i18ns.t('monthlyPass.addQuotaWindow') }}
          </el-button>
        </div>
      </el-form-item>
      <el-form-item :label="i18ns.t('monthlyPass.note')">
        <el-input v-model="assignmentForm.note" type="textarea" :rows="3" maxlength="1000" />
      </el-form-item>
      <el-form-item v-if="editingAssignmentId" :label="i18ns.t('monthlyPass.status')">
        <el-select v-model="assignmentForm.status" style="width: 200px">
          <el-option :label="i18ns.t('monthlyPass.enabled')" :value="MANAGED_STATUS.ENABLED" />
          <el-option :label="i18ns.t('monthlyPass.disabled')" :value="MANAGED_STATUS.DISABLED" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="showAssignmentDialog = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button type="primary" :loading="savingAssignment" @click="submitAssignment">{{
        i18ns.t('confirm')
      }}</el-button>
    </template>
  </el-dialog>
  <el-alert
    v-if="showAssignmentDialog && batchAssignmentResult"
    :title="i18ns.t('monthlyPass.batchResultTitle')"
    type="success"
    show-icon
    :closable="false"
    class="batch-result-alert"
  >
    <template #default>
      <div>
        {{
          i18ns.t('monthlyPass.batchResultSummary', {
            total: batchAssignmentResult.totalTargets,
            success: batchAssignmentResult.successCount,
            created: batchAssignmentResult.createdCount,
            extended: batchAssignmentResult.extendedCount,
            failed: batchAssignmentResult.failedCount,
          })
        }}
      </div>
    </template>
  </el-alert>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { MAX_AMOUNT_QUOTA } from '../useMonthlyPassManagement'
import { useMonthlyPassManagementContext } from '../context'

const state = useMonthlyPassManagementContext()

const {
  MANAGED_STATUS,
  isDesktop,
  channelOptions,
  groupOptions,
  userOptions,
  userOptionsLoading,
  batchUserOptions,
  batchUserOptionsLoading,
  batchAssignmentResult,
  showTemplateDialog,
  editingTemplateId,
  templateForm,
  savingTemplate,
  showAssignmentDialog,
  editingAssignmentId,
  savingAssignment,
  assignmentForm,
  quickDurationDays,
  templateDialogTitle,
  availableTemplateModelOptions,
  assignableTemplateOptions,
  selectedBatchUsers,
  batchSelectionSummary,
  templatePricingPreview,
  formatPriceValue,
  formatRatioValue,
  formatQuotaValue,
  getQuotaMax,
  getQuotaMin,
  getQuotaPrecision,
  getQuotaStep,
  updateEditableQuotaWindowHours,
  clearEditableQuotaWindow,
  addTemplateQuotaWindow,
  removeTemplateQuotaWindow,
  addAssignmentQuotaWindow,
  removeAssignmentQuotaWindow,
  handleTemplateAllowedChannelsChange,
  handleUserSearch,
  loadBatchUserOptions,
  selectAllVisibleBatchUsers,
  clearBatchUserSelection,
  submitTemplate,
  clearTemplatePurchaseLimit,
  handleAssignmentTemplateChange,
  submitAssignment,
  applyQuickDuration,
  increaseAssignmentDuration,
  decreaseAssignmentDuration,
  shiftAssignmentEndDays,
  setAssignmentDurationDays,
} = state
</script>
