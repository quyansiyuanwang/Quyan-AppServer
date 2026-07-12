<template>
  <div :class="isDesktop ? 'desktop-page page-shell' : 'mobile-page'">
    <el-card class="page-card monthly-pass-card">
      <template #header>
        <div class="card-header toolbar-row">
          <span>{{ i18ns.t('monthlyPass.title') }}</span>
          <el-button :loading="refreshing" @click="refreshCurrentTab">{{
            i18ns.t('refresh')
          }}</el-button>
        </div>
      </template>

      <el-empty v-if="!hasAnyReadPermission" />

      <el-tabs v-else v-model="activeTab" @tab-change="handleTabChange">
        <el-tab-pane
          v-if="canReadTemplates"
          name="templates"
          :label="i18ns.t('monthlyPass.templateManagement')"
        >
          <div class="toolbar-row wrap-gap tab-filter-toolbar">
            <el-input
              v-model="templateFilters.keyword"
              :placeholder="i18ns.t('search')"
              clearable
              class="filter-field-md"
            />
            <el-select
              v-model="templateFilters.status"
              clearable
              :placeholder="i18ns.t('monthlyPass.status')"
              class="filter-field-sm"
            >
              <el-option :label="i18ns.t('monthlyPass.enabled')" :value="MANAGED_STATUS.ENABLED" />
              <el-option
                :label="i18ns.t('monthlyPass.disabled')"
                :value="MANAGED_STATUS.DISABLED"
              />
            </el-select>
            <div class="filter-action-group" :class="{ 'single-action': !canWriteTemplates }">
              <el-button type="primary" @click="searchTemplates">{{ i18ns.t('search') }}</el-button>
              <el-button v-if="canWriteTemplates" type="success" @click="openCreateTemplateDialog">
                {{ i18ns.t('monthlyPass.createTemplate') }}
              </el-button>
            </div>
          </div>

          <div v-if="isDesktop" class="desktop-table-wrap">
            <el-table :data="templates" v-loading="loadingTemplates" style="width: 100%">
              <el-table-column
                prop="name"
                :label="i18ns.t('monthlyPass.templateName')"
                min-width="160"
              />
              <el-table-column
                prop="description"
                :label="i18ns.t('monthlyPass.description')"
                min-width="180"
              >
                <template #default="{ row }">{{ row.description || '-' }}</template>
              </el-table-column>
              <el-table-column
                prop="originalPrice"
                :label="i18ns.t('monthlyPass.originalPrice')"
                width="130"
              >
                <template #default="{ row }">{{ formatPriceValue(row.originalPrice) }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.discountPercent')" width="120">
                <template #default="{ row }">{{
                  formatPercentValue(row.discountPercent)
                }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.discountedPrice')" width="130">
                <template #default="{ row }">{{ formatPriceValue(row.discountedPrice) }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.rechargeRatio')" width="120">
                <template #default="{ row }">{{ formatRatioValue(row.rechargeRatio) }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.derivedQuota')" width="130">
                <template #default="{ row }">{{
                  formatQuotaValue(row.defaultQuota, 'amount')
                }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.dailyQuota')" width="130">
                <template #default="{ row }">{{
                  formatDailyQuota(row.dailyQuota, 'amount')
                }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.purchaseLimit')" min-width="180">
                <template #default="{ row }">{{ formatPurchaseLimit(row) }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.quotaWindows')" min-width="220">
                <template #default="{ row }">{{
                  formatQuotaWindows(getTemplateQuotaWindowSource(row))
                }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.allowedModels')" min-width="200">
                <template #default="{ row }">{{ formatAllowedModels(row.allowedModels) }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.allowedChannels')" min-width="220">
                <template #default="{ row }">{{
                  formatAllowedChannels(row.allowedChannels)
                }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.status')" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.status === MANAGED_STATUS.ENABLED ? 'success' : 'info'">{{
                    statusLabel(row.status)
                  }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.publishStatus')" width="120">
                <template #default="{ row }">
                  <el-tag :type="publishStatusTagType(row.publishStatus)">{{
                    publishStatusLabel(row.publishStatus)
                  }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.publishedAt')" min-width="180">
                <template #default="{ row }">{{ formatDateTime(row.publishedAt) }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.createTime')" min-width="180">
                <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
              </el-table-column>
              <el-table-column
                v-if="canWriteTemplates"
                :label="i18ns.t('monthlyPass.actions')"
                width="300"
                fixed="right"
              >
                <template #default="{ row }">
                  <el-button type="info" size="small" @click="openCopyTemplateDialog(row)">{{
                    i18ns.t('monthlyPass.copyTemplate')
                  }}</el-button>
                  <el-button
                    v-if="canPublishTemplate(row)"
                    type="success"
                    size="small"
                    @click="publishTemplate(row)"
                  >
                    {{ i18ns.t('monthlyPass.publish') }}
                  </el-button>
                  <el-button
                    v-else-if="canUnpublishTemplate(row)"
                    type="warning"
                    size="small"
                    @click="unpublishTemplate(row)"
                  >
                    {{ i18ns.t('monthlyPass.unpublish') }}
                  </el-button>
                  <el-button type="primary" size="small" @click="openEditTemplateDialog(row)">{{
                    i18ns.t('edit')
                  }}</el-button>
                  <el-button type="danger" size="small" @click="deleteTemplate(row)">{{
                    i18ns.t('delete')
                  }}</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <div v-else class="mobile-card-list" v-loading="loadingTemplates">
            <el-empty v-if="!templates.length" :description="i18ns.t('monthlyPass.loadFailed')" />
            <el-card
              v-for="row in templates"
              :key="row.id"
              class="monthly-mobile-card"
              shadow="never"
            >
              <div class="monthly-mobile-card__header">
                <div class="monthly-mobile-title">{{ row.name }}</div>
                <div class="monthly-mobile-tag-group">
                  <el-tag
                    :type="row.status === MANAGED_STATUS.ENABLED ? 'success' : 'info'"
                    size="small"
                  >
                    {{ statusLabel(row.status) }}
                  </el-tag>
                  <el-tag :type="publishStatusTagType(row.publishStatus)" size="small">
                    {{ publishStatusLabel(row.publishStatus) }}
                  </el-tag>
                </div>
              </div>

              <div class="monthly-mobile-grid">
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.originalPrice') }}</span>
                  <span class="value">{{ formatPriceValue(row.originalPrice) }}</span>
                </div>
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.discountPercent') }}</span>
                  <span class="value">{{ formatPercentValue(row.discountPercent) }}</span>
                </div>
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.discountedPrice') }}</span>
                  <span class="value">{{ formatPriceValue(row.discountedPrice) }}</span>
                </div>
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.rechargeRatio') }}</span>
                  <span class="value">{{ formatRatioValue(row.rechargeRatio) }}</span>
                </div>
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.derivedQuota') }}</span>
                  <span class="value">{{ formatQuotaValue(row.defaultQuota, 'amount') }}</span>
                </div>
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.dailyQuota') }}</span>
                  <span class="value">{{ formatDailyQuota(row.dailyQuota, 'amount') }}</span>
                </div>
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.purchaseLimit') }}</span>
                  <span class="value">{{ formatPurchaseLimit(row) }}</span>
                </div>
                <div class="monthly-mobile-field full">
                  <span class="label">{{ i18ns.t('monthlyPass.quotaWindows') }}</span>
                  <span class="value">{{
                    formatQuotaWindows(getTemplateQuotaWindowSource(row))
                  }}</span>
                </div>
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.publishedAt') }}</span>
                  <span class="value">{{ formatDateTime(row.publishedAt) }}</span>
                </div>
                <div class="monthly-mobile-field full">
                  <span class="label">{{ i18ns.t('monthlyPass.allowedModels') }}</span>
                  <span class="value">{{ formatAllowedModels(row.allowedModels) }}</span>
                </div>
                <div class="monthly-mobile-field full">
                  <span class="label">{{ i18ns.t('monthlyPass.allowedChannels') }}</span>
                  <span class="value">{{ formatAllowedChannels(row.allowedChannels) }}</span>
                </div>
                <div class="monthly-mobile-field full" v-if="row.description">
                  <span class="label">{{ i18ns.t('monthlyPass.description') }}</span>
                  <span class="value">{{ row.description }}</span>
                </div>
              </div>

              <div v-if="canWriteTemplates" class="monthly-mobile-actions">
                <el-button type="info" size="small" @click="openCopyTemplateDialog(row)">
                  {{ i18ns.t('monthlyPass.copyTemplate') }}
                </el-button>
                <el-button
                  v-if="canPublishTemplate(row)"
                  type="success"
                  size="small"
                  @click="publishTemplate(row)"
                >
                  {{ i18ns.t('monthlyPass.publish') }}
                </el-button>
                <el-button
                  v-else-if="canUnpublishTemplate(row)"
                  type="warning"
                  size="small"
                  @click="unpublishTemplate(row)"
                >
                  {{ i18ns.t('monthlyPass.unpublish') }}
                </el-button>
                <el-button type="primary" size="small" @click="openEditTemplateDialog(row)">
                  {{ i18ns.t('edit') }}
                </el-button>
                <el-button type="danger" size="small" @click="deleteTemplate(row)">
                  {{ i18ns.t('delete') }}
                </el-button>
              </div>
            </el-card>
          </div>

          <div class="pager-wrap">
            <el-pagination
              v-model:current-page="templatePagination.page"
              v-model:page-size="templatePagination.pageSize"
              :page-sizes="[10, 20, 50, 100]"
              :total="templatePagination.total"
              layout="total, sizes, prev, pager, next"
              @current-change="loadTemplates"
              @size-change="loadTemplates"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane
          v-if="canReadAssignments"
          name="assignments"
          :label="i18ns.t('monthlyPass.assignmentManagement')"
        >
          <div class="toolbar-row wrap-gap tab-filter-toolbar">
            <el-select
              v-model="assignmentFilters.userId"
              filterable
              remote
              reserve-keyword
              clearable
              :loading="userOptionsLoading"
              :remote-method="handleUserSearch"
              :placeholder="i18ns.t('monthlyPass.filterUser')"
              class="filter-field-md"
            >
              <el-option
                v-for="user in userOptions"
                :key="user.id"
                :label="`${user.username} (${user.id})`"
                :value="user.id"
              />
            </el-select>
            <el-select
              v-model="assignmentFilters.templateId"
              filterable
              clearable
              :placeholder="i18ns.t('monthlyPass.filterTemplate')"
              class="filter-field-md"
            >
              <el-option
                v-for="template in templateOptions"
                :key="template.id"
                :label="template.name"
                :value="template.id"
              />
            </el-select>
            <el-select
              v-model="assignmentFilters.status"
              clearable
              :placeholder="i18ns.t('monthlyPass.status')"
              class="filter-field-sm"
            >
              <el-option :label="i18ns.t('monthlyPass.enabled')" :value="MANAGED_STATUS.ENABLED" />
              <el-option
                :label="i18ns.t('monthlyPass.disabled')"
                :value="MANAGED_STATUS.DISABLED"
              />
            </el-select>
            <div class="filter-action-group" :class="{ 'single-action': !canWriteAssignments }">
              <el-button type="primary" @click="searchAssignments">{{
                i18ns.t('search')
              }}</el-button>
              <el-button
                v-if="canWriteAssignments"
                type="success"
                @click="openCreateAssignmentDialog"
              >
                {{ i18ns.t('monthlyPass.createAssignment') }}
              </el-button>
            </div>
          </div>

          <div v-if="isDesktop" class="desktop-table-wrap">
            <el-table :data="userPasses" v-loading="loadingAssignments" style="width: 100%">
              <el-table-column :label="i18ns.t('monthlyPass.user')" min-width="180">
                <template #default="{ row }">{{ row.username || row.userId }}</template>
              </el-table-column>
              <el-table-column
                prop="templateName"
                :label="i18ns.t('monthlyPass.template')"
                min-width="160"
              />
              <el-table-column :label="i18ns.t('monthlyPass.startAt')" min-width="180">
                <template #default="{ row }">{{ formatDateTime(row.startAt) }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.endAt')" min-width="180">
                <template #default="{ row }">{{ formatDateTime(row.endAt) }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.totalQuota')" width="140">
                <template #default="{ row }">{{
                  formatQuotaValue(row.totalQuota, row.quotaUnit)
                }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.dailyQuota')" width="140">
                <template #default="{ row }">{{
                  formatDailyQuota(row.dailyQuota, row.quotaUnit)
                }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.quotaUnit')" width="120">
                <template #default="{ row }">{{ formatQuotaUnit(row.quotaUnit) }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.quotaWindows')" min-width="220">
                <template #default="{ row }">{{
                  formatQuotaWindows(getUserPassQuotaWindowSource(row))
                }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.usedQuota')" width="140">
                <template #default="{ row }">{{
                  formatQuotaValue(row.usedQuota, row.quotaUnit)
                }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.remainingQuota')" width="160">
                <template #default="{ row }">{{
                  formatQuotaValue(row.remainingQuota, row.quotaUnit)
                }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.status')" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.status === MANAGED_STATUS.ENABLED ? 'success' : 'info'">{{
                    statusLabel(row.status)
                  }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.note')" min-width="180">
                <template #default="{ row }">{{ row.note || '-' }}</template>
              </el-table-column>
              <el-table-column
                v-if="canWriteAssignments"
                :label="i18ns.t('monthlyPass.actions')"
                width="160"
                fixed="right"
              >
                <template #default="{ row }">
                  <el-button type="primary" size="small" @click="openEditAssignmentDialog(row)">{{
                    i18ns.t('edit')
                  }}</el-button>
                  <el-button type="danger" size="small" @click="deleteAssignment(row)">{{
                    i18ns.t('delete')
                  }}</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <div v-else class="mobile-card-list" v-loading="loadingAssignments">
            <el-empty v-if="!userPasses.length" :description="i18ns.t('monthlyPass.loadFailed')" />
            <el-card
              v-for="row in userPasses"
              :key="row.id"
              class="monthly-mobile-card"
              shadow="never"
            >
              <div class="monthly-mobile-card__header">
                <div class="monthly-mobile-title">{{ row.templateName }}</div>
                <el-tag
                  :type="row.status === MANAGED_STATUS.ENABLED ? 'success' : 'info'"
                  size="small"
                >
                  {{ statusLabel(row.status) }}
                </el-tag>
              </div>

              <div class="monthly-mobile-grid">
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.user') }}</span>
                  <span class="value">{{ row.username || row.userId }}</span>
                </div>
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.totalQuota') }}</span>
                  <span class="value">{{ formatQuotaValue(row.totalQuota, row.quotaUnit) }}</span>
                </div>
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.usedQuota') }}</span>
                  <span class="value">{{ formatQuotaValue(row.usedQuota, row.quotaUnit) }}</span>
                </div>
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.remainingQuota') }}</span>
                  <span class="value">{{
                    formatQuotaValue(row.remainingQuota, row.quotaUnit)
                  }}</span>
                </div>
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.dailyQuota') }}</span>
                  <span class="value">{{ formatDailyQuota(row.dailyQuota, row.quotaUnit) }}</span>
                </div>
                <div class="monthly-mobile-field full">
                  <span class="label">{{ i18ns.t('monthlyPass.quotaWindows') }}</span>
                  <span class="value">{{
                    formatQuotaWindows(getUserPassQuotaWindowSource(row))
                  }}</span>
                </div>
                <div class="monthly-mobile-field full">
                  <span class="label">{{ i18ns.t('monthlyPass.startAt') }}</span>
                  <span class="value">{{ formatDateTime(row.startAt) }}</span>
                </div>
                <div class="monthly-mobile-field full">
                  <span class="label">{{ i18ns.t('monthlyPass.endAt') }}</span>
                  <span class="value">{{ formatDateTime(row.endAt) }}</span>
                </div>
                <div class="monthly-mobile-field full" v-if="row.note">
                  <span class="label">{{ i18ns.t('monthlyPass.note') }}</span>
                  <span class="value">{{ row.note }}</span>
                </div>
              </div>

              <div v-if="canWriteAssignments" class="monthly-mobile-actions">
                <el-button type="primary" size="small" @click="openEditAssignmentDialog(row)">
                  {{ i18ns.t('edit') }}
                </el-button>
                <el-button type="danger" size="small" @click="deleteAssignment(row)">
                  {{ i18ns.t('delete') }}
                </el-button>
              </div>
            </el-card>
          </div>

          <div class="pager-wrap">
            <el-pagination
              v-model:current-page="assignmentPagination.page"
              v-model:page-size="assignmentPagination.pageSize"
              :page-sizes="[10, 20, 50, 100]"
              :total="assignmentPagination.total"
              layout="total, sizes, prev, pager, next"
              @current-change="loadAssignments"
              @size-change="loadAssignments"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane
          v-if="canReadUsages"
          name="usages"
          :label="i18ns.t('monthlyPass.usageManagement')"
        >
          <div class="toolbar-row wrap-gap tab-filter-toolbar">
            <el-select
              v-model="usageFilters.userId"
              filterable
              remote
              reserve-keyword
              clearable
              :loading="userOptionsLoading"
              :remote-method="handleUserSearch"
              :placeholder="i18ns.t('monthlyPass.filterUser')"
              class="filter-field-md"
            >
              <el-option
                v-for="user in userOptions"
                :key="user.id"
                :label="`${user.username} (${user.id})`"
                :value="user.id"
              />
            </el-select>
            <el-select
              v-model="usageFilters.templateId"
              clearable
              filterable
              :placeholder="i18ns.t('monthlyPass.filterTemplate')"
              class="filter-field-md"
            >
              <el-option
                v-for="template in templateOptions"
                :key="template.id"
                :label="template.name"
                :value="template.id"
              />
            </el-select>
            <el-select
              v-model="usageFilters.model"
              filterable
              clearable
              :placeholder="i18ns.t('monthlyPass.model')"
              class="filter-field-md"
            >
              <el-option v-for="model in modelOptions" :key="model" :label="model" :value="model" />
            </el-select>
            <el-date-picker
              v-model="usageDateRange"
              type="datetimerange"
              :start-placeholder="i18ns.t('balance.startDate')"
              :end-placeholder="i18ns.t('balance.endDate')"
              format="YYYY-MM-DD HH:mm:ss"
              value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
              class="filter-field-lg"
              @change="handleUsageDateRangeChange"
            />
            <div class="filter-action-group single-action">
              <el-button type="primary" @click="searchUsages">{{ i18ns.t('search') }}</el-button>
            </div>
          </div>

          <div v-if="isDesktop" class="desktop-table-wrap">
            <el-table :data="usageRecords" v-loading="loadingUsages" style="width: 100%">
              <el-table-column :label="i18ns.t('monthlyPass.user')" min-width="220">
                <template #default="{ row }">
                  {{ userNameById.get(row.userId) || row.userId }} ({{ row.userId }})
                </template>
              </el-table-column>
              <el-table-column
                prop="templateName"
                :label="i18ns.t('monthlyPass.template')"
                min-width="160"
              />
              <el-table-column prop="model" :label="i18ns.t('monthlyPass.model')" min-width="160">
                <template #default="{ row }">{{ row.model || '-' }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.channel')" min-width="180">
                <template #default="{ row }">{{
                  row.channelName || row.channelId || '-'
                }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.coverageAmount')" width="130">
                <template #default="{ row }">{{ formatAmount(row.coveredAmount) }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.totalRequestCost')" width="140">
                <template #default="{ row }">{{ formatAmount(row.totalRequestCost) }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.remainingRequestCost')" width="150">
                <template #default="{ row }">{{ formatAmount(row.remainingRequestCost) }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('monthlyPass.createTime')" min-width="180">
                <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
              </el-table-column>
            </el-table>
          </div>

          <div v-else class="mobile-card-list" v-loading="loadingUsages">
            <el-empty
              v-if="!usageRecords.length"
              :description="i18ns.t('monthlyPass.loadFailed')"
            />
            <el-card
              v-for="row in usageRecords"
              :key="row.id"
              class="monthly-mobile-card"
              shadow="never"
            >
              <div class="monthly-mobile-card__header">
                <div class="monthly-mobile-title">{{ row.templateName }}</div>
                <el-tag size="small">{{ row.model || '-' }}</el-tag>
              </div>

              <div class="monthly-mobile-grid">
                <div class="monthly-mobile-field full">
                  <span class="label">{{ i18ns.t('monthlyPass.user') }}</span>
                  <span class="value">
                    {{ userNameById.get(row.userId) || row.userId }} ({{ row.userId }})
                  </span>
                </div>
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.channel') }}</span>
                  <span class="value">{{ row.channelName || row.channelId || '-' }}</span>
                </div>
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.coverageAmount') }}</span>
                  <span class="value">{{ formatAmount(row.coveredAmount) }}</span>
                </div>
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.totalRequestCost') }}</span>
                  <span class="value">{{ formatAmount(row.totalRequestCost) }}</span>
                </div>
                <div class="monthly-mobile-field">
                  <span class="label">{{ i18ns.t('monthlyPass.remainingRequestCost') }}</span>
                  <span class="value">{{ formatAmount(row.remainingRequestCost) }}</span>
                </div>
                <div class="monthly-mobile-field full">
                  <span class="label">{{ i18ns.t('monthlyPass.createTime') }}</span>
                  <span class="value">{{ formatDateTime(row.createTime) }}</span>
                </div>
              </div>
            </el-card>
          </div>

          <div class="pager-wrap">
            <el-pagination
              v-model:current-page="usagePagination.page"
              v-model:page-size="usagePagination.pageSize"
              :page-sizes="[10, 20, 50, 100]"
              :total="usagePagination.total"
              layout="total, sizes, prev, pager, next"
              @current-change="loadUsages"
              @size-change="loadUsages"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useMonthlyPassManagementContext } from '../context'

const state = useMonthlyPassManagementContext()

const {
  MANAGED_STATUS,
  isDesktop,
  activeTab,
  refreshing,
  canReadTemplates,
  canWriteTemplates,
  canReadAssignments,
  canWriteAssignments,
  canReadUsages,
  hasAnyReadPermission,
  loadingTemplates,
  loadingAssignments,
  loadingUsages,
  templates,
  userPasses,
  usageRecords,
  modelOptions,
  userOptions,
  templateOptions,
  userOptionsLoading,
  templateFilters,
  assignmentFilters,
  usageFilters,
  usageDateRange,
  templatePagination,
  assignmentPagination,
  usagePagination,
  userNameById,
  formatDateTime,
  formatAmount,
  formatPriceValue,
  formatPercentValue,
  formatRatioValue,
  formatQuotaValue,
  formatDailyQuota,
  formatQuotaUnit,
  formatQuotaWindows,
  statusLabel,
  publishStatusLabel,
  publishStatusTagType,
  canPublishTemplate,
  canUnpublishTemplate,
  formatAllowedModels,
  formatAllowedChannels,
  formatPurchaseLimit,
  getTemplateQuotaWindowSource,
  getUserPassQuotaWindowSource,
  refreshCurrentTab,
  handleTabChange,
  handleUserSearch,
  openCreateTemplateDialog,
  openEditTemplateDialog,
  openCopyTemplateDialog,
  deleteTemplate,
  publishTemplate,
  unpublishTemplate,
  openCreateAssignmentDialog,
  openEditAssignmentDialog,
  deleteAssignment,
  handleUsageDateRangeChange,
  searchTemplates,
  searchAssignments,
  searchUsages,
  loadTemplates,
  loadAssignments,
  loadUsages,
} = state
</script>

<style scoped>
.desktop-table-wrap {
  width: 100%;
  min-width: 0;
  overflow-x: auto;
}

.desktop-table-wrap :deep(.el-table) {
  width: 100%;
}

.desktop-table-wrap :deep(.el-table__header),
.desktop-table-wrap :deep(.el-table__body) {
  width: 100% !important;
  table-layout: fixed;
}

.desktop-table-wrap :deep(.el-table__inner-wrapper),
.desktop-table-wrap :deep(.el-table__body-wrapper) {
  width: 100%;
}

.desktop-table-wrap :deep(.el-table .cell) {
  word-break: break-word;
}
</style>
