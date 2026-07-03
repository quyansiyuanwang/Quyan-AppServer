<template>
  <div class="page-wrap">
    <el-card class="page-card management-card">
      <template #header>
        <div class="header-row">
          <div>
            <div class="title">{{ i18ns.t('remoteTerminalProduct.managementTitle') }}</div>
            <div class="subtitle">{{ i18ns.t('remoteTerminalProduct.managementDescription') }}</div>
          </div>
          <el-button :loading="loading" @click="refreshAll">{{ i18ns.t('refresh') }}</el-button>
        </div>
      </template>

      <div v-if="!canView" class="permission-empty">
        <el-empty :description="i18ns.t('remoteTerminalProduct.noPermission')" />
      </div>

      <template v-else>
        <el-tabs v-model="activeTab">
          <el-tab-pane
            v-if="canReadTemplate"
            :label="i18ns.t('remoteTerminalProduct.templatesTab')"
            name="templates"
          >
            <div class="toolbar-row">
              <el-input
                v-model="templateKeyword"
                class="toolbar-input"
                :placeholder="i18ns.t('remoteTerminalProduct.keywordPlaceholder')"
                clearable
              />
              <el-select v-model="templateStatus" clearable class="toolbar-select">
                <el-option
                  :label="i18ns.t('remoteTerminalProduct.allStatuses')"
                  :value="undefined"
                />
                <el-option
                  v-for="item in filterOptions.templateStatusOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
              <el-button v-if="canWriteTemplate" type="primary" @click="openCreateTemplateDialog">
                {{ i18ns.t('remoteTerminalProduct.createTemplate') }}
              </el-button>
            </div>

            <el-table :data="templates" v-loading="loading" stripe>
              <el-table-column
                prop="name"
                :label="i18ns.t('remoteTerminalProduct.planName')"
                min-width="180"
              />
              <el-table-column :label="i18ns.t('description')" min-width="240">
                <template #default="{ row }">{{ row.description || '-' }}</template>
              </el-table-column>
              <el-table-column
                :label="i18ns.t('remoteTerminalProduct.supportedUnits')"
                min-width="180"
              >
                <template #default="{ row }">
                  <div class="tag-stack">
                    <el-tag v-if="supportsDevice(row)" type="warning" size="small">
                      {{ i18ns.t('remoteTerminalProduct.deviceUnit') }}
                    </el-tag>
                    <el-tag v-if="supportsTerminal(row)" type="primary" size="small">
                      {{ i18ns.t('remoteTerminalProduct.terminalUnit') }}
                    </el-tag>
                  </div>
                </template>
              </el-table-column>
              <el-table-column
                :label="i18ns.t('remoteTerminalProduct.deviceUnitPrice')"
                width="160"
              >
                <template #default="{ row }">{{
                  formatUnitPrice(row.devicePrice, row.currency, row.billingUnit)
                }}</template>
              </el-table-column>
              <el-table-column
                :label="i18ns.t('remoteTerminalProduct.terminalUnitPrice')"
                width="160"
              >
                <template #default="{ row }">{{
                  formatUnitPrice(row.terminalPrice, row.currency, row.billingUnit)
                }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('remoteTerminalProduct.billingUnit')" width="120">
                <template #default="{ row }">{{
                  formatBillingUnitLabel(row.billingUnit)
                }}</template>
              </el-table-column>
              <el-table-column
                :label="i18ns.t('remoteTerminalProduct.minimumPurchaseUnits')"
                width="140"
              >
                <template #default="{ row }">{{ row.minimumPurchaseUnits }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('remoteTerminalProduct.currency')" width="120">
                <template #default="{ row }">{{ row.currency }}</template>
              </el-table-column>
              <el-table-column
                :label="i18ns.t('remoteTerminalProduct.purchaseLimit')"
                min-width="180"
              >
                <template #default="{ row }">
                  {{ formatTemplatePurchaseLimit(row) }}
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('remoteTerminalProduct.publishStatus')" width="120">
                <template #default="{ row }">
                  <el-tag
                    :type="row.publishStatus === 'published' ? 'success' : 'info'"
                    size="small"
                  >
                    {{
                      row.publishStatus === 'published'
                        ? i18ns.t('remoteTerminalProduct.published')
                        : i18ns.t('remoteTerminalProduct.draft')
                    }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('actions')" width="240" fixed="right">
                <template #default="{ row }">
                  <el-button
                    v-if="canWriteTemplate"
                    link
                    type="primary"
                    @click="openEditTemplateDialog(row)"
                  >
                    {{ i18ns.t('edit') }}
                  </el-button>
                  <el-button
                    v-if="canWriteTemplate && row.publishStatus !== 'published'"
                    link
                    type="success"
                    @click="handlePublish(row.id)"
                  >
                    {{ i18ns.t('remoteTerminalProduct.publish') }}
                  </el-button>
                  <el-button
                    v-if="canWriteTemplate && row.publishStatus === 'published'"
                    link
                    type="warning"
                    @click="handleUnpublish(row.id)"
                  >
                    {{ i18ns.t('remoteTerminalProduct.unpublish') }}
                  </el-button>
                  <el-button
                    v-if="canWriteTemplate"
                    link
                    type="danger"
                    @click="handleDeleteTemplate(row.id)"
                  >
                    {{ i18ns.t('delete') }}
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane
            v-if="canReadAssignment"
            :label="i18ns.t('remoteTerminalProduct.entitlementsTab')"
            name="entitlements"
          >
            <div class="toolbar-row">
              <el-select
                v-model="entitlementFilter.userId"
                filterable
                remote
                clearable
                reserve-keyword
                class="toolbar-select toolbar-user-select"
                :placeholder="i18ns.t('remoteTerminalProduct.userPlaceholder')"
                :remote-method="handleUserSearch"
                :loading="userOptionsLoading"
              >
                <el-option
                  v-for="user in userOptions"
                  :key="user.id"
                  :label="user.username"
                  :value="user.id"
                />
              </el-select>
              <el-select v-model="entitlementFilter.templateId" clearable class="toolbar-select">
                <el-option
                  :label="i18ns.t('remoteTerminalProduct.allTemplates')"
                  :value="undefined"
                />
                <el-option
                  v-for="item in filterOptions.templates"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id"
                />
              </el-select>
              <el-select v-model="entitlementFilter.status" clearable class="toolbar-select">
                <el-option
                  :label="i18ns.t('remoteTerminalProduct.allStatuses')"
                  :value="undefined"
                />
                <el-option
                  v-for="item in filterOptions.assignmentStatusOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
              <el-button
                v-if="canWriteAssignment"
                type="primary"
                @click="openAssignEntitlementDialog"
              >
                {{ i18ns.t('remoteTerminalProduct.assignEntitlement') }}
              </el-button>
            </div>

            <el-table :data="entitlements" v-loading="loading" stripe>
              <el-table-column
                prop="username"
                :label="i18ns.t('remoteTerminalProduct.user')"
                min-width="140"
              />
              <el-table-column
                prop="name"
                :label="i18ns.t('remoteTerminalProduct.planName')"
                min-width="180"
              />
              <el-table-column
                prop="templateName"
                :label="i18ns.t('remoteTerminalProduct.templatesTab')"
                min-width="160"
              />
              <el-table-column
                :label="i18ns.t('remoteTerminalProduct.validPeriod')"
                min-width="220"
              >
                <template #default="{ row }">
                  <div>{{ formatDateTime(row.startAt) }}</div>
                  <div class="secondary-text">{{ formatDateTime(row.endAt) }}</div>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('remoteTerminalProduct.durationDays')" width="120">
                <template #default="{ row }">{{ row.durationDays }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('remoteTerminalProduct.purchaseUnits')" width="130">
                <template #default="{ row }">{{ row.purchaseUnits }}</template>
              </el-table-column>
              <el-table-column
                :label="i18ns.t('remoteTerminalProduct.supportedUnits')"
                min-width="180"
              >
                <template #default="{ row }">
                  <div class="entitlement-mix">
                    <span
                      >{{ i18ns.t('remoteTerminalProduct.purchasedDeviceCount') }}:
                      {{ row.purchasedDeviceCount }}</span
                    >
                    <span
                      >{{ i18ns.t('remoteTerminalProduct.purchasedTerminalCount') }}:
                      {{ row.purchasedTerminalCount }}</span
                    >
                  </div>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('remoteTerminalProduct.purchaseAmount')" width="150">
                <template #default="{ row }">{{
                  formatPrice(row.purchaseAmount, row.currency)
                }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('remoteTerminalProduct.deviceLimit')" width="120">
                <template #default="{ row }"
                  >{{ row.registeredDeviceCount }} / {{ row.deviceLimit }}</template
                >
              </el-table-column>
              <el-table-column
                prop="terminalLimit"
                :label="i18ns.t('remoteTerminalProduct.terminalLimit')"
                width="120"
              />
              <el-table-column
                :label="i18ns.t('remoteTerminalProduct.registrationToken')"
                min-width="240"
              >
                <template #default="{ row }">
                  <div class="token-stack">
                    <span>{{
                      row.registrationToken?.maskedToken || i18ns.t('remoteTerminalProduct.noToken')
                    }}</span>
                    <span v-if="!hasDeviceQuota(row.deviceLimit)" class="secondary-text">
                      {{ i18ns.t('remoteTerminalProduct.tokenUnavailableForTerminalOnly') }}
                    </span>
                    <div class="token-actions">
                      <el-button
                        v-if="canWriteToken && hasDeviceQuota(row.deviceLimit)"
                        link
                        type="primary"
                        @click="openRotateTokenDialog(row)"
                      >
                        {{ i18ns.t('remoteTerminalProduct.rotateToken') }}
                      </el-button>
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('actions')" width="300" fixed="right">
                <template #default="{ row }">
                  <el-button
                    v-if="canWriteAssignment"
                    link
                    type="primary"
                    @click="openEditEntitlementDialog(row)"
                  >
                    {{ i18ns.t('edit') }}
                  </el-button>
                  <el-button
                    v-if="canWriteAssignment"
                    link
                    type="warning"
                    @click="openLimitAdjustDialog(row)"
                  >
                    {{ i18ns.t('remoteTerminalProduct.adjustLimits') }}
                  </el-button>
                  <el-button
                    v-if="canWriteAssignment"
                    link
                    type="danger"
                    @click="handleDeleteEntitlement(row.id)"
                  >
                    {{ i18ns.t('delete') }}
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane
            v-if="canReadDevice"
            :label="i18ns.t('remoteTerminalProduct.devicesTab')"
            name="devices"
          >
            <div class="toolbar-row">
              <el-select
                v-model="deviceFilter.userId"
                filterable
                remote
                clearable
                reserve-keyword
                class="toolbar-select toolbar-user-select"
                :placeholder="i18ns.t('remoteTerminalProduct.userPlaceholder')"
                :remote-method="handleUserSearch"
                :loading="userOptionsLoading"
              >
                <el-option
                  v-for="user in userOptions"
                  :key="user.id"
                  :label="user.username"
                  :value="user.id"
                />
              </el-select>
              <el-select v-model="deviceFilter.entitlementId" clearable class="toolbar-select">
                <el-option
                  :label="i18ns.t('remoteTerminalProduct.allTemplates')"
                  :value="undefined"
                />
                <el-option
                  v-for="item in entitlements"
                  :key="item.id"
                  :label="`${item.username || '-'} / ${item.name}`"
                  :value="item.id"
                />
              </el-select>
              <el-select v-model="deviceFilter.status" clearable class="toolbar-select">
                <el-option
                  :label="i18ns.t('remoteTerminalProduct.allStatuses')"
                  :value="undefined"
                />
                <el-option
                  v-for="item in filterOptions.deviceStatusOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </div>

            <el-table :data="devices" v-loading="loading" stripe>
              <el-table-column
                prop="username"
                :label="i18ns.t('remoteTerminalProduct.user')"
                min-width="140"
              />
              <el-table-column
                prop="hostname"
                :label="i18ns.t('remoteTerminalProduct.hostname')"
                min-width="160"
              />
              <el-table-column
                prop="deviceId"
                :label="i18ns.t('remoteTerminal.deviceId')"
                min-width="180"
              />
              <el-table-column
                prop="entitlementName"
                :label="i18ns.t('remoteTerminalProduct.entitlementsTab')"
                min-width="160"
              />
              <el-table-column
                prop="platform"
                :label="i18ns.t('remoteTerminalProduct.platform')"
                width="120"
              />
              <el-table-column :label="i18ns.t('remoteTerminalProduct.lastSeenAt')" min-width="160">
                <template #default="{ row }">{{ formatDateTime(row.lastSeenAt) }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('actions')" width="120" fixed="right">
                <template #default="{ row }">
                  <el-button
                    v-if="canWriteDevice"
                    link
                    type="danger"
                    @click="handleRevokeDevice(row.id)"
                  >
                    {{ i18ns.t('remoteTerminalProduct.revokeDevice') }}
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-card>

    <el-dialog v-model="templateDialogVisible" :title="templateDialogTitle" width="620px">
      <el-form
        ref="templateFormRef"
        :model="templateForm"
        :rules="templateFormRules"
        label-width="150px"
      >
        <el-form-item :label="i18ns.t('remoteTerminalProduct.planName')" prop="name">
          <el-input
            v-model="templateForm.name"
            :placeholder="i18ns.t('remoteTerminalProduct.namePlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('description')" prop="description">
          <el-input
            v-model="templateForm.description"
            type="textarea"
            :placeholder="i18ns.t('remoteTerminalProduct.descriptionPlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.currency')" prop="currency">
          <el-input v-model="templateForm.currency" />
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.billingUnit')" prop="billingUnit">
          <el-select v-model="templateForm.billingUnit" class="full-width">
            <el-option :label="i18ns.t('remoteTerminalProduct.billingUnitDay')" value="day" />
            <el-option :label="i18ns.t('remoteTerminalProduct.billingUnitWeek')" value="week" />
            <el-option :label="i18ns.t('remoteTerminalProduct.billingUnitMonth')" value="month" />
          </el-select>
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.deviceUnitPrice')" prop="devicePrice">
          <el-input-number
            v-model="templateForm.devicePrice"
            :min="0"
            :step="0.0001"
            :precision="4"
            class="full-width"
          />
        </el-form-item>
        <el-form-item
          :label="i18ns.t('remoteTerminalProduct.terminalUnitPrice')"
          prop="terminalPrice"
        >
          <el-input-number
            v-model="templateForm.terminalPrice"
            :min="0"
            :step="0.0001"
            :precision="4"
            class="full-width"
          />
        </el-form-item>
        <el-form-item
          :label="i18ns.t('remoteTerminalProduct.minimumPurchaseUnits')"
          prop="minimumPurchaseUnits"
        >
          <div class="template-range-row">
            <el-input-number
              v-model="templateForm.minimumPurchaseUnits"
              :min="1"
              :step="1"
              class="full-width"
            />
            <span class="template-range-separator">~</span>
            <el-input-number
              v-model="templateForm.maximumPurchaseUnits"
              :min="1"
              :step="1"
              class="full-width"
            />
          </div>
        </el-form-item>
        <el-form-item
          :label="i18ns.t('remoteTerminalProduct.purchaseLimitCount')"
          prop="purchaseLimitPerUser"
        >
          <el-input-number
            v-model="templateForm.purchaseLimitPerUser"
            :min="1"
            :step="1"
            class="full-width"
          />
        </el-form-item>
        <el-form-item
          :label="i18ns.t('remoteTerminalProduct.purchaseLimitWindowDays')"
          prop="purchaseLimitWindowDays"
        >
          <el-input-number
            v-model="templateForm.purchaseLimitWindowDays"
            :min="1"
            :step="1"
            class="full-width"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.devicePurchaseRange')">
          <div class="template-range-row">
            <el-input-number
              v-model="templateForm.minimumDeviceCount"
              :min="1"
              :step="1"
              class="full-width"
            />
            <span class="template-range-separator">~</span>
            <el-input-number
              v-model="templateForm.maxDeviceCount"
              :min="1"
              :step="1"
              class="full-width"
            />
          </div>
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.terminalPurchaseRange')">
          <div class="template-range-row">
            <el-input-number
              v-model="templateForm.minimumTerminalCount"
              :min="1"
              :step="1"
              class="full-width"
            />
            <span class="template-range-separator">~</span>
            <el-input-number
              v-model="templateForm.maxTerminalCount"
              :min="1"
              :step="1"
              class="full-width"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="templateDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="dialogSubmitting" @click="submitTemplateDialog">{{
          i18ns.t('save')
        }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="entitlementDialogVisible" :title="entitlementDialogTitle" width="620px">
      <el-form
        ref="entitlementFormRef"
        :model="entitlementForm"
        :rules="entitlementFormRules"
        label-width="120px"
      >
        <el-form-item :label="i18ns.t('remoteTerminalProduct.user')" prop="userId">
          <el-select
            v-model="entitlementForm.userId"
            filterable
            remote
            reserve-keyword
            class="full-width"
            :placeholder="i18ns.t('remoteTerminalProduct.userPlaceholder')"
            :remote-method="handleUserSearch"
            :loading="userOptionsLoading"
          >
            <el-option
              v-for="user in userOptions"
              :key="user.id"
              :label="user.username"
              :value="user.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.templatesTab')" prop="templateId">
          <el-select v-model="entitlementForm.templateId" clearable class="full-width">
            <el-option
              v-for="item in filterOptions.templates"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.planName')" prop="name">
          <el-input
            v-model="entitlementForm.name"
            :placeholder="i18ns.t('remoteTerminalProduct.namePlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('description')" prop="description">
          <el-input
            v-model="entitlementForm.description"
            type="textarea"
            :placeholder="i18ns.t('remoteTerminalProduct.descriptionPlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.startAt')" prop="startAt">
          <el-date-picker
            v-model="entitlementForm.startAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"
            class="full-width"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.endAt')" prop="endAt">
          <el-date-picker
            v-model="entitlementForm.endAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"
            class="full-width"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.deviceLimit')" prop="deviceLimit">
          <el-input-number v-model="entitlementForm.deviceLimit" :min="0" class="full-width" />
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.terminalLimit')" prop="terminalLimit">
          <el-input-number v-model="entitlementForm.terminalLimit" :min="0" class="full-width" />
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.maxDeviceCount')">
          <el-input-number
            v-model="entitlementForm.maxDeviceCount"
            :min="1"
            :step="1"
            class="full-width"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.maxTerminalCount')">
          <el-input-number
            v-model="entitlementForm.maxTerminalCount"
            :min="1"
            :step="1"
            class="full-width"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.note')" prop="note">
          <el-input
            v-model="entitlementForm.note"
            type="textarea"
            :placeholder="i18ns.t('remoteTerminalProduct.notePlaceholder')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="entitlementDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="dialogSubmitting" @click="submitEntitlementDialog">{{
          i18ns.t('save')
        }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="tokenDialogVisible"
      :title="i18ns.t('remoteTerminalProduct.rotateTokenTitle')"
      width="520px"
    >
      <el-form label-width="120px">
        <el-form-item :label="i18ns.t('remoteTerminalProduct.tokenLabel')">
          <el-input v-model="tokenForm.label" />
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.tokenExpiresAt')">
          <el-date-picker
            v-model="tokenForm.expiresAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"
            class="full-width"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="tokenDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="dialogSubmitting" @click="submitRotateToken">{{
          i18ns.t('save')
        }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="limitAdjustDialogVisible"
      :title="i18ns.t('remoteTerminalProduct.adjustLimits')"
      width="520px"
    >
      <el-form ref="limitAdjustFormRef" :model="limitAdjustForm" label-width="140px">
        <el-form-item :label="i18ns.t('remoteTerminalProduct.user')">
          <span>{{ limitAdjustTarget?.username || '-' }}</span>
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.planName')">
          <span>{{ limitAdjustTarget?.name || '-' }}</span>
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.deviceLimit')" prop="deviceLimit">
          <div class="limit-adjust-row">
            <el-input-number
              v-model="limitAdjustForm.deviceLimit"
              :min="0"
              :max="999999"
              class="full-width"
            />
            <span class="limit-adjust-hint">
              {{ i18ns.t('remoteTerminalProduct.registeredDevices') }}:
              {{ limitAdjustTarget?.registeredDeviceCount ?? 0 }}
            </span>
          </div>
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.terminalLimit')" prop="terminalLimit">
          <el-input-number
            v-model="limitAdjustForm.terminalLimit"
            :min="0"
            :max="999999"
            class="full-width"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.maxDeviceCount')">
          <el-input-number
            v-model="limitAdjustForm.maxDeviceCount"
            :min="0"
            :max="999999"
            :placeholder="i18ns.t('remoteTerminalProduct.noExtraLimit')"
            class="full-width"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('remoteTerminalProduct.maxTerminalCount')">
          <el-input-number
            v-model="limitAdjustForm.maxTerminalCount"
            :min="0"
            :max="999999"
            :placeholder="i18ns.t('remoteTerminalProduct.noExtraLimit')"
            class="full-width"
          />
        </el-form-item>
      </el-form>
      <el-divider />
      <div class="reset-unbind-section">
        <div class="reset-unbind-info">
          <span class="reset-unbind-label">{{
            i18ns.t('remoteTerminalProduct.resetUnbindCount')
          }}</span>
          <span class="reset-unbind-desc">{{
            i18ns.t('remoteTerminalProduct.resetUnbindCountDesc')
          }}</span>
        </div>
        <el-button type="danger" :loading="resettingUnbind" @click="handleResetUnbindCount">
          {{ i18ns.t('remoteTerminalProduct.resetUnbindCountAction') }}
        </el-button>
      </div>
      <template #footer>
        <el-button @click="limitAdjustDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="dialogSubmitting" @click="submitLimitAdjustDialog">{{
          i18ns.t('save')
        }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { i18ns } from '@/locales'
import { Permission } from '@/constant/permission'
import { remoteTerminalProductService } from '@/service/remoteTerminalProductService'
import { permissionService } from '@/service/permissionService'
import { userService } from '@/service/userService'
import { usePermissionStore } from '@/stores/permissionStore'
import type {
  RemoteTerminalBillingUnit,
  RemoteTerminalBoundDeviceDto,
  RemoteTerminalFilterOptionsDto,
  RemoteTerminalProductTemplateDto,
  RemoteTerminalUserEntitlementDto,
} from '@/client/types.gen'

interface UserOption {
  id: string
  username: string
}

const USER_OPTIONS_PAGE_SIZE = 20

const permissionStore = usePermissionStore()

const loading = ref(false)
const dialogSubmitting = ref(false)
const resettingUnbind = ref(false)
const activeTab = ref<'templates' | 'entitlements' | 'devices'>('templates')

const templates = ref<RemoteTerminalProductTemplateDto[]>([])
const entitlements = ref<RemoteTerminalUserEntitlementDto[]>([])
const devices = ref<RemoteTerminalBoundDeviceDto[]>([])
const filterOptions = reactive<RemoteTerminalFilterOptionsDto>({
  templateStatusOptions: [],
  assignmentStatusOptions: [],
  deviceStatusOptions: [],
  publishStatusOptions: [],
  templates: [],
})

const templateKeyword = ref('')
const templateStatus = ref<number | undefined>()
const entitlementFilter = reactive<{ userId?: string; templateId?: string; status?: number }>({})
const deviceFilter = reactive<{ userId?: string; entitlementId?: string; status?: number }>({})

const userOptions = ref<UserOption[]>([])
const userOptionsLoading = ref(false)

const templateDialogVisible = ref(false)
const entitlementDialogVisible = ref(false)
const tokenDialogVisible = ref(false)
const limitAdjustDialogVisible = ref(false)
const templateFormRef = ref<FormInstance>()
const entitlementFormRef = ref<FormInstance>()
const limitAdjustFormRef = ref<FormInstance>()

const editingTemplateId = ref<string>()
const editingEntitlementId = ref<string>()
const tokenEntitlementId = ref<string>()
const limitAdjustTarget = ref<RemoteTerminalUserEntitlementDto>()

const templateForm = reactive({
  name: '',
  description: '',
  billingUnit: 'day' as RemoteTerminalBillingUnit,
  minimumPurchaseUnits: 1,
  maximumPurchaseUnits: undefined as number | undefined,
  devicePrice: undefined as number | undefined,
  terminalPrice: undefined as number | undefined,
  currency: '曲',
  purchaseLimitPerUser: undefined as number | undefined,
  purchaseLimitWindowDays: undefined as number | undefined,
  minimumDeviceCount: undefined as number | undefined,
  minimumTerminalCount: undefined as number | undefined,
  maxDeviceCount: undefined as number | undefined,
  maxTerminalCount: undefined as number | undefined,
})

const entitlementForm = reactive({
  userId: '',
  templateId: '',
  name: '',
  description: '',
  startAt: '',
  endAt: '',
  deviceLimit: 1,
  terminalLimit: 1,
  maxDeviceCount: undefined as number | undefined,
  maxTerminalCount: undefined as number | undefined,
  note: '',
})

const tokenForm = reactive({
  label: '',
  expiresAt: '',
})

const limitAdjustForm = reactive({
  deviceLimit: 0,
  terminalLimit: 0,
  maxDeviceCount: undefined as number | undefined,
  maxTerminalCount: undefined as number | undefined,
})

const supportsDevice = (row: { devicePrice?: number }) => row.devicePrice != null
const supportsTerminal = (row: { terminalPrice?: number }) => row.terminalPrice != null

const formatBillingUnitLabel = (billingUnit?: RemoteTerminalBillingUnit) => {
  if (billingUnit === 'week') return i18ns.t('remoteTerminalProduct.billingUnitWeek')
  if (billingUnit === 'month') return i18ns.t('remoteTerminalProduct.billingUnitMonth')
  return i18ns.t('remoteTerminalProduct.billingUnitDay')
}

const formatUnitPrice = (
  price?: number,
  currency?: string,
  billingUnit?: RemoteTerminalBillingUnit,
) => {
  if (price == null) return '-'
  return `${formatPrice(price, currency)} / ${formatBillingUnitLabel(billingUnit)}`
}

const validateOfferedUnits = (
  _rule: unknown,
  _value: unknown,
  callback: (error?: Error) => void,
) => {
  if (!supportsDevice(templateForm) && !supportsTerminal(templateForm)) {
    callback(new Error(i18ns.t('remoteTerminalProduct.offeredUnitsRequired')))
    return
  }
  callback()
}

const validateEntitlementQuota = (
  _rule: unknown,
  _value: unknown,
  callback: (error?: Error) => void,
) => {
  if (
    Number(entitlementForm.deviceLimit || 0) <= 0 &&
    Number(entitlementForm.terminalLimit || 0) <= 0
  ) {
    callback(new Error(i18ns.t('remoteTerminalProduct.quotaRequired')))
    return
  }
  callback()
}

const validatePurchaseLimitPair = (
  _rule: unknown,
  _value: unknown,
  callback: (error?: Error) => void,
) => {
  const hasLimit =
    templateForm.purchaseLimitPerUser !== undefined && templateForm.purchaseLimitPerUser !== null
  const hasWindow =
    templateForm.purchaseLimitWindowDays !== undefined &&
    templateForm.purchaseLimitWindowDays !== null
  if (hasLimit !== hasWindow) {
    callback(new Error(i18ns.t('remoteTerminalProduct.purchaseLimitPairRequired')))
    return
  }
  callback()
}

const validateEntitlementDateRange = (
  _rule: unknown,
  _value: unknown,
  callback: (error?: Error) => void,
) => {
  if (!entitlementForm.startAt || !entitlementForm.endAt) {
    callback()
    return
  }
  const startAt = new Date(entitlementForm.startAt).getTime()
  const endAt = new Date(entitlementForm.endAt).getTime()
  if (Number.isNaN(startAt) || Number.isNaN(endAt)) {
    callback(new Error(i18ns.t('remoteTerminalProduct.invalidDateTime')))
    return
  }
  if (endAt <= startAt) {
    callback(new Error(i18ns.t('remoteTerminalProduct.endAfterStartRequired')))
    return
  }
  callback()
}

const validateStartAt = (_rule: unknown, _value: unknown, callback: (error?: Error) => void) => {
  if (!editingEntitlementId.value && !entitlementForm.startAt.trim()) {
    callback(new Error(i18ns.t('remoteTerminalProduct.startAtRequired')))
    return
  }
  validateEntitlementDateRange(_rule, _value, callback)
}

const validateEndAt = (_rule: unknown, _value: unknown, callback: (error?: Error) => void) => {
  if (!editingEntitlementId.value && !entitlementForm.endAt.trim()) {
    callback(new Error(i18ns.t('remoteTerminalProduct.endAtRequired')))
    return
  }
  validateEntitlementDateRange(_rule, _value, callback)
}

const templateFormRules: FormRules = {
  name: [
    { required: true, message: i18ns.t('remoteTerminalProduct.nameRequired'), trigger: 'blur' },
  ],
  currency: [
    { required: true, message: i18ns.t('remoteTerminalProduct.currencyRequired'), trigger: 'blur' },
  ],
  devicePrice: [{ validator: validateOfferedUnits, trigger: 'change' }],
  terminalPrice: [{ validator: validateOfferedUnits, trigger: 'change' }],
  purchaseLimitPerUser: [{ validator: validatePurchaseLimitPair, trigger: 'change' }],
  purchaseLimitWindowDays: [{ validator: validatePurchaseLimitPair, trigger: 'change' }],
  maximumPurchaseUnits: [
    {
      validator: (_rule: unknown, _value: unknown, callback: (error?: Error) => void) => {
        if (
          templateForm.maximumPurchaseUnits != null &&
          Number(templateForm.minimumPurchaseUnits || 1) > Number(templateForm.maximumPurchaseUnits)
        ) {
          callback(new Error(i18ns.t('remoteTerminalProduct.maximumPurchaseUnitsInvalid')))
          return
        }
        callback()
      },
      trigger: 'change',
    },
  ],
}

const entitlementFormRules: FormRules = {
  userId: [
    { required: true, message: i18ns.t('remoteTerminalProduct.userRequired'), trigger: 'change' },
  ],
  startAt: [{ validator: validateStartAt, trigger: 'change' }],
  endAt: [{ validator: validateEndAt, trigger: 'change' }],
  deviceLimit: [{ validator: validateEntitlementQuota, trigger: 'change' }],
  terminalLimit: [{ validator: validateEntitlementQuota, trigger: 'change' }],
}

const toErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

const canReadTemplate = computed(() =>
  permissionStore.hasPermission(Permission.REMOTE_TERMINAL_PRODUCT_READ),
)
const canReadAssignment = computed(() =>
  permissionStore.hasPermission(Permission.REMOTE_TERMINAL_ASSIGNMENT_READ),
)
const canReadDevice = computed(() =>
  permissionStore.hasPermission(Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ),
)
const canView = computed(
  () => canReadTemplate.value || canReadAssignment.value || canReadDevice.value,
)

const visibleTabs = computed<Array<'templates' | 'entitlements' | 'devices'>>(() => {
  const tabs: Array<'templates' | 'entitlements' | 'devices'> = []
  if (canReadTemplate.value) tabs.push('templates')
  if (canReadAssignment.value) tabs.push('entitlements')
  if (canReadDevice.value) tabs.push('devices')
  return tabs
})

const canWriteTemplate = computed(() =>
  permissionStore.hasPermission(Permission.REMOTE_TERMINAL_PRODUCT_WRITE),
)
const canWriteAssignment = computed(() =>
  permissionStore.hasPermission(Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE),
)
const canWriteToken = computed(() =>
  permissionStore.hasPermission(Permission.REMOTE_TERMINAL_REGISTRATION_TOKEN_WRITE),
)
const canWriteDevice = computed(() =>
  permissionStore.hasPermission(Permission.REMOTE_TERMINAL_DEVICE_WRITE),
)

const templateDialogTitle = computed(() =>
  editingTemplateId.value
    ? i18ns.t('remoteTerminalProduct.editTemplate')
    : i18ns.t('remoteTerminalProduct.createTemplate'),
)

const entitlementDialogTitle = computed(() =>
  editingEntitlementId.value
    ? i18ns.t('remoteTerminalProduct.editEntitlement')
    : i18ns.t('remoteTerminalProduct.assignEntitlement'),
)

const formatDateTime = (value?: string) => {
  if (!value) return '-'
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return value
  return time.toLocaleString()
}

const formatPrice = (price?: number, currency?: string) => {
  if (price == null) return '-'
  return `${Number(price)
    .toFixed(4)
    .replace(/\.?0+$/, '')} ${currency || '曲'}`
}

const formatTemplatePurchaseLimit = (row: RemoteTerminalProductTemplateDto) => {
  if (!row.purchaseLimitPerUser || !row.purchaseLimitWindowDays) {
    return i18ns.t('remoteTerminalProduct.unlimitedPurchase')
  }

  return i18ns.t('remoteTerminalProduct.purchaseLimitValue', {
    count: row.purchaseLimitPerUser,
    days: row.purchaseLimitWindowDays,
  })
}

const hasDeviceQuota = (deviceLimit?: number) => Number(deviceLimit || 0) > 0

const resetTemplateForm = () => {
  editingTemplateId.value = undefined
  templateForm.name = ''
  templateForm.description = ''
  templateForm.billingUnit = 'day'
  templateForm.minimumPurchaseUnits = 1
  templateForm.maximumPurchaseUnits = undefined
  templateForm.devicePrice = undefined
  templateForm.terminalPrice = undefined
  templateForm.currency = '曲'
  templateForm.purchaseLimitPerUser = undefined
  templateForm.purchaseLimitWindowDays = undefined
  templateForm.minimumDeviceCount = undefined
  templateForm.minimumTerminalCount = undefined
  templateForm.maxDeviceCount = undefined
  templateForm.maxTerminalCount = undefined
  templateFormRef.value?.clearValidate()
}

const resetEntitlementForm = () => {
  editingEntitlementId.value = undefined
  entitlementForm.userId = ''
  entitlementForm.templateId = ''
  entitlementForm.name = ''
  entitlementForm.description = ''
  entitlementForm.startAt = ''
  entitlementForm.endAt = ''
  entitlementForm.deviceLimit = 1
  entitlementForm.terminalLimit = 1
  entitlementForm.maxDeviceCount = undefined
  entitlementForm.maxTerminalCount = undefined
  entitlementForm.note = ''
  entitlementFormRef.value?.clearValidate()
}

const loadUserOptions = async (keyword?: string) => {
  userOptionsLoading.value = true
  try {
    const result = await userService.getAllUsers({
      page: 1,
      pageSize: USER_OPTIONS_PAGE_SIZE,
      keyword: keyword?.trim() || undefined,
    })
    const users = Array.isArray(result?.users) ? result.users : []
    userOptions.value = users
      .map((item: { id: string; username?: string }) => ({
        id: item.id,
        username: item.username || item.id,
      }))
      .sort((a, b) => a.username.localeCompare(b.username))
  } catch {
    userOptions.value = []
  } finally {
    userOptionsLoading.value = false
  }
}

const ensureUserOption = (userId?: string, username?: string | null) => {
  if (!userId) return
  if (userOptions.value.some((item) => item.id === userId)) return
  userOptions.value = [{ id: userId, username: username || userId }, ...userOptions.value]
}

const handleUserSearch = (query: string) => {
  void loadUserOptions(query)
}

const loadFilterOptions = async () => {
  if (!canView.value) {
    filterOptions.templateStatusOptions = []
    filterOptions.assignmentStatusOptions = []
    filterOptions.deviceStatusOptions = []
    filterOptions.publishStatusOptions = []
    filterOptions.templates = []
    return
  }

  const result = await remoteTerminalProductService.getFilterOptions()
  filterOptions.templateStatusOptions = result.templateStatusOptions || []
  filterOptions.assignmentStatusOptions = result.assignmentStatusOptions || []
  filterOptions.deviceStatusOptions = result.deviceStatusOptions || []
  filterOptions.publishStatusOptions = result.publishStatusOptions || []
  filterOptions.templates = result.templates || []
}

const loadTemplates = async () => {
  if (!canReadTemplate.value) {
    templates.value = []
    return
  }

  const result = await remoteTerminalProductService.listTemplates({
    page: 1,
    pageSize: 100,
    keyword: templateKeyword.value.trim() || undefined,
    status: templateStatus.value,
  })
  templates.value = result.records || []
}

const loadEntitlements = async () => {
  if (!canReadAssignment.value) {
    entitlements.value = []
    return
  }

  const result = await remoteTerminalProductService.listEntitlements({
    page: 1,
    pageSize: 100,
    userId: entitlementFilter.userId,
    templateId: entitlementFilter.templateId,
    status: entitlementFilter.status,
  })
  entitlements.value = result.records || []
  entitlements.value.forEach((item) => ensureUserOption(item.userId, item.username))
}

const loadDevices = async () => {
  if (!canReadDevice.value) {
    devices.value = []
    return
  }

  const result = await remoteTerminalProductService.listDevices({
    page: 1,
    pageSize: 100,
    userId: deviceFilter.userId,
    entitlementId: deviceFilter.entitlementId,
    status: deviceFilter.status,
  })
  devices.value = result.records || []
  devices.value.forEach((item) => ensureUserOption(item.userId, item.username))
}

const refreshAll = async () => {
  if (!canView.value) return
  loading.value = true
  try {
    await Promise.all([
      loadFilterOptions(),
      canReadAssignment.value || canReadDevice.value ? loadUserOptions() : Promise.resolve(),
    ])
    await Promise.all([
      canReadTemplate.value ? loadTemplates() : Promise.resolve(),
      canReadAssignment.value ? loadEntitlements() : Promise.resolve(),
      canReadDevice.value ? loadDevices() : Promise.resolve(),
    ])
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.refreshFailed')))
  } finally {
    loading.value = false
  }
}

const openCreateTemplateDialog = () => {
  resetTemplateForm()
  templateDialogVisible.value = true
}

const openEditTemplateDialog = (row: RemoteTerminalProductTemplateDto) => {
  editingTemplateId.value = row.id
  templateForm.name = row.name
  templateForm.description = row.description || ''
  templateForm.billingUnit = row.billingUnit
  templateForm.minimumPurchaseUnits = row.minimumPurchaseUnits
  templateForm.maximumPurchaseUnits = row.maximumPurchaseUnits ?? undefined
  templateForm.devicePrice = row.devicePrice ?? undefined
  templateForm.terminalPrice = row.terminalPrice ?? undefined
  templateForm.currency = row.currency || '曲'
  templateForm.purchaseLimitPerUser = row.purchaseLimitPerUser ?? undefined
  templateForm.purchaseLimitWindowDays = row.purchaseLimitWindowDays ?? undefined
  templateForm.minimumDeviceCount = row.minimumDeviceCount ?? undefined
  templateForm.minimumTerminalCount = row.minimumTerminalCount ?? undefined
  templateForm.maxDeviceCount = row.maxDeviceCount ?? undefined
  templateForm.maxTerminalCount = row.maxTerminalCount ?? undefined
  templateDialogVisible.value = true
}

const submitTemplateDialog = async () => {
  if (!templateFormRef.value) return
  dialogSubmitting.value = true
  try {
    await templateFormRef.value.validate()

    const payload = {
      name: templateForm.name.trim(),
      description: templateForm.description.trim() || undefined,
      billingUnit: templateForm.billingUnit,
      minimumPurchaseUnits: Number(templateForm.minimumPurchaseUnits || 1),
      maximumPurchaseUnits: templateForm.maximumPurchaseUnits ?? null,
      devicePrice: templateForm.devicePrice ?? null,
      terminalPrice: templateForm.terminalPrice ?? null,
      currency: templateForm.currency.trim() || '曲',
      purchaseLimitPerUser: templateForm.purchaseLimitPerUser ?? null,
      purchaseLimitWindowDays: templateForm.purchaseLimitWindowDays ?? null,
      minimumDeviceCount: templateForm.minimumDeviceCount ?? null,
      minimumTerminalCount: templateForm.minimumTerminalCount ?? null,
      maxDeviceCount: templateForm.maxDeviceCount ?? null,
      maxTerminalCount: templateForm.maxTerminalCount ?? null,
    }

    if (editingTemplateId.value) {
      await remoteTerminalProductService.updateTemplate(editingTemplateId.value, payload)
    } else {
      await remoteTerminalProductService.createTemplate(payload)
    }

    ElMessage.success(editingTemplateId.value ? i18ns.t('updateSuccess') : i18ns.t('createSuccess'))
    templateDialogVisible.value = false
    await refreshAll()
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.saveFailed')))
  } finally {
    dialogSubmitting.value = false
  }
}

const handlePublish = async (id: string) => {
  try {
    await remoteTerminalProductService.publishTemplate(id)
    ElMessage.success(i18ns.t('updateSuccess'))
    await refreshAll()
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.publishFailed')))
  }
}

const handleUnpublish = async (id: string) => {
  try {
    await remoteTerminalProductService.unpublishTemplate(id)
    ElMessage.success(i18ns.t('updateSuccess'))
    await refreshAll()
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.unpublishFailed')))
  }
}

const handleDeleteTemplate = async (id: string) => {
  try {
    await ElMessageBox.confirm(i18ns.t('confirmDelete'), i18ns.t('warning'), { type: 'warning' })
    await remoteTerminalProductService.deleteTemplate(id)
    ElMessage.success(i18ns.t('deleteSuccess'))
    await refreshAll()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.deleteFailed')))
  }
}

const openAssignEntitlementDialog = () => {
  resetEntitlementForm()
  entitlementDialogVisible.value = true
}

const openEditEntitlementDialog = (row: RemoteTerminalUserEntitlementDto) => {
  editingEntitlementId.value = row.id
  entitlementForm.userId = row.userId
  entitlementForm.templateId = row.templateId || ''
  entitlementForm.name = row.name
  entitlementForm.description = row.description || ''
  entitlementForm.startAt = row.startAt
  entitlementForm.endAt = row.endAt
  entitlementForm.deviceLimit = row.deviceLimit
  entitlementForm.terminalLimit = row.terminalLimit
  entitlementForm.maxDeviceCount = row.maxDeviceCount ?? undefined
  entitlementForm.maxTerminalCount = row.maxTerminalCount ?? undefined
  entitlementForm.note = row.note || ''
  ensureUserOption(row.userId, row.username)
  entitlementDialogVisible.value = true
}

const submitEntitlementDialog = async () => {
  if (!entitlementFormRef.value) return
  dialogSubmitting.value = true
  try {
    await entitlementFormRef.value.validate()

    const normalizedStartAt = entitlementForm.startAt.trim()
    const normalizedEndAt = entitlementForm.endAt.trim()

    if (editingEntitlementId.value) {
      await remoteTerminalProductService.updateEntitlement(editingEntitlementId.value, {
        name: entitlementForm.name.trim() || undefined,
        description: entitlementForm.description.trim() || undefined,
        ...(normalizedStartAt ? { startAt: normalizedStartAt } : {}),
        ...(normalizedEndAt ? { endAt: normalizedEndAt } : {}),
        deviceLimit: Number(entitlementForm.deviceLimit),
        terminalLimit: Number(entitlementForm.terminalLimit),
        maxDeviceCount: entitlementForm.maxDeviceCount ?? null,
        maxTerminalCount: entitlementForm.maxTerminalCount ?? null,
        note: entitlementForm.note.trim() || undefined,
      })
    } else {
      await remoteTerminalProductService.assignEntitlement({
        userId: entitlementForm.userId,
        templateId: entitlementForm.templateId || undefined,
        name: entitlementForm.name.trim() || undefined,
        description: entitlementForm.description.trim() || undefined,
        startAt: normalizedStartAt,
        endAt: normalizedEndAt,
        deviceLimit: Number(entitlementForm.deviceLimit),
        terminalLimit: Number(entitlementForm.terminalLimit),
        note: entitlementForm.note.trim() || undefined,
      })
    }

    ElMessage.success(
      editingEntitlementId.value ? i18ns.t('updateSuccess') : i18ns.t('createSuccess'),
    )
    entitlementDialogVisible.value = false
    await refreshAll()
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.saveFailed')))
  } finally {
    dialogSubmitting.value = false
  }
}

const handleDeleteEntitlement = async (id: string) => {
  try {
    await ElMessageBox.confirm(i18ns.t('confirmDelete'), i18ns.t('warning'), { type: 'warning' })
    await remoteTerminalProductService.deleteEntitlement(id)
    ElMessage.success(i18ns.t('deleteSuccess'))
    await refreshAll()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.deleteFailed')))
  }
}

const openRotateTokenDialog = (row: RemoteTerminalUserEntitlementDto) => {
  if (!hasDeviceQuota(row.deviceLimit)) return
  tokenEntitlementId.value = row.id
  tokenForm.label = row.registrationToken?.label || ''
  tokenForm.expiresAt = row.registrationToken?.expiresAt || ''
  tokenDialogVisible.value = true
}

const submitRotateToken = async () => {
  if (!tokenEntitlementId.value) return
  dialogSubmitting.value = true
  try {
    await remoteTerminalProductService.rotateRegistrationToken(tokenEntitlementId.value, {
      label: tokenForm.label.trim() || null,
      expiresAt: tokenForm.expiresAt || null,
    })
    ElMessage.success(i18ns.t('updateSuccess'))
    tokenDialogVisible.value = false
    await refreshAll()
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.tokenRotateFailed')))
  } finally {
    dialogSubmitting.value = false
  }
}

const openLimitAdjustDialog = (row: RemoteTerminalUserEntitlementDto) => {
  limitAdjustTarget.value = row
  limitAdjustForm.deviceLimit = row.deviceLimit
  limitAdjustForm.terminalLimit = row.terminalLimit
  limitAdjustForm.maxDeviceCount = row.maxDeviceCount ?? undefined
  limitAdjustForm.maxTerminalCount = row.maxTerminalCount ?? undefined
  limitAdjustDialogVisible.value = true
}

const submitLimitAdjustDialog = async () => {
  if (!limitAdjustTarget.value) return
  dialogSubmitting.value = true
  try {
    await remoteTerminalProductService.updateEntitlement(limitAdjustTarget.value.id, {
      deviceLimit: Number(limitAdjustForm.deviceLimit),
      terminalLimit: Number(limitAdjustForm.terminalLimit),
      maxDeviceCount: limitAdjustForm.maxDeviceCount ?? null,
      maxTerminalCount: limitAdjustForm.maxTerminalCount ?? null,
    })
    ElMessage.success(i18ns.t('updateSuccess'))
    limitAdjustDialogVisible.value = false
    limitAdjustTarget.value = undefined
    await refreshAll()
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.saveFailed')))
  } finally {
    dialogSubmitting.value = false
  }
}

const handleResetUnbindCount = async () => {
  if (!limitAdjustTarget.value) return
  resettingUnbind.value = true
  try {
    await ElMessageBox.confirm(
      i18ns.t('remoteTerminalProduct.resetUnbindConfirm'),
      i18ns.t('warning'),
      { type: 'warning' },
    )
    await remoteTerminalProductService.resetUnbindCount(limitAdjustTarget.value.id)
    ElMessage.success(i18ns.t('updateSuccess'))
    await refreshAll()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.resetUnbindFailed')))
  } finally {
    resettingUnbind.value = false
  }
}

const handleRevokeDevice = async (id: string) => {
  try {
    await ElMessageBox.confirm(i18ns.t('confirmDelete'), i18ns.t('warning'), { type: 'warning' })
    await remoteTerminalProductService.revokeDevice(id)
    ElMessage.success(i18ns.t('deleteSuccess'))
    await refreshAll()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.revokeFailed')))
  }
}

watch([templateKeyword, templateStatus], () => {
  if (!canReadTemplate.value) return
  void loadTemplates()
})

watch(
  () => [entitlementFilter.userId, entitlementFilter.templateId, entitlementFilter.status],
  () => {
    if (!canReadAssignment.value) return
    void loadEntitlements()
  },
)

watch(
  () => [deviceFilter.userId, deviceFilter.entitlementId, deviceFilter.status],
  () => {
    if (!canReadDevice.value) return
    void loadDevices()
  },
)

watch(
  visibleTabs,
  (tabs) => {
    if (!tabs.includes(activeTab.value)) {
      activeTab.value = tabs[0] ?? 'templates'
    }
  },
  { immediate: true },
)

onMounted(async () => {
  await permissionService.ensureLoaded()
  await refreshAll()
})
</script>

<style scoped>
.page-wrap {
  width: 100%;
}

.management-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.title {
  font-size: 16px;
  font-weight: 600;
}

.subtitle,
.secondary-text {
  color: var(--el-text-color-secondary);
}

.toolbar-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.toolbar-input {
  width: 260px;
}

.toolbar-select {
  width: 200px;
}

.toolbar-user-select {
  width: 260px;
}

.token-stack,
.entitlement-mix {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.token-actions,
.tag-stack {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.full-width {
  width: 100%;
}

.template-range-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.template-range-separator {
  color: var(--el-text-color-secondary);
  font-weight: 600;
}

.permission-empty {
  padding: 24px 0;
}

.limit-adjust-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.limit-adjust-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.reset-unbind-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 0 4px;
}

.reset-unbind-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.reset-unbind-label {
  font-size: 14px;
  font-weight: 500;
}

.reset-unbind-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

@media (max-width: 768px) {
  .header-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .toolbar-input,
  .toolbar-select,
  .toolbar-user-select {
    width: 100%;
  }

  .template-range-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
