<template>
  <div :class="isDesktop ? 'desktop-page' : 'mobile-page'">
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

          <el-table
            v-if="isDesktop"
            :data="templates"
            v-loading="loadingTemplates"
            style="width: 100%"
          >
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
              <template #default="{ row }">{{ formatPercentValue(row.discountPercent) }}</template>
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
              width="360"
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

          <el-table
            v-if="isDesktop"
            :data="userPasses"
            v-loading="loadingAssignments"
            style="width: 100%"
          >
            <el-table-column :label="i18ns.t('monthlyPass.user')">
              <template #default="{ row }">{{ row.username || row.userId }}</template>
            </el-table-column>
            <el-table-column prop="templateName" :label="i18ns.t('monthlyPass.template')" />
            <el-table-column :label="i18ns.t('monthlyPass.startAt')">
              <template #default="{ row }">{{ formatDateTime(row.startAt) }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.endAt')">
              <template #default="{ row }">{{ formatDateTime(row.endAt) }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.totalQuota')">
              <template #default="{ row }">{{
                formatQuotaValue(row.totalQuota, row.quotaUnit)
              }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.dailyQuota')">
              <template #default="{ row }">{{
                formatDailyQuota(row.dailyQuota, row.quotaUnit)
              }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.quotaUnit')">
              <template #default="{ row }">{{ formatQuotaUnit(row.quotaUnit) }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.quotaWindows')" min-width="220">
              <template #default="{ row }">{{
                formatQuotaWindows(getUserPassQuotaWindowSource(row))
              }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.usedQuota')">
              <template #default="{ row }">{{
                formatQuotaValue(row.usedQuota, row.quotaUnit)
              }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.remainingQuota')">
              <template #default="{ row }">{{
                formatQuotaValue(row.remainingQuota, row.quotaUnit)
              }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.status')">
              <template #default="{ row }">
                <el-tag :type="row.status === MANAGED_STATUS.ENABLED ? 'success' : 'info'">{{
                  statusLabel(row.status)
                }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.note')">
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

          <el-table
            v-if="isDesktop"
            :data="usageRecords"
            v-loading="loadingUsages"
            style="width: 100%"
          >
            <el-table-column :label="i18ns.t('monthlyPass.user')">
              <template #default="{ row }">
                {{ userNameById.get(row.userId) || row.userId }} ({{ row.userId }})
              </template>
            </el-table-column>
            <el-table-column prop="templateName" :label="i18ns.t('monthlyPass.template')" />
            <el-table-column prop="model" :label="i18ns.t('monthlyPass.model')">
              <template #default="{ row }">{{ row.model || '-' }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.channel')">
              <template #default="{ row }">{{ row.channelName || row.channelId || '-' }}</template>
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
            <el-table-column :label="i18ns.t('monthlyPass.createTime')">
              <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
            </el-table-column>
          </el-table>

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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { usePageDevice } from '@/composables/usePageDevice'
import { monthlyPassService } from '@/service/monthlyPassService'
import { configService } from '@/service/configService'
import { groupService } from '@/service/groupService'
import { modelPricingService } from '@/service/modelPricingService'
import { relayChannelService } from '@/service/relayChannelService'
import { userService } from '@/service/userService'
import { Permission } from '@/constant/permission'
import { MANAGED_STATUS } from '@/constant/status'
import { usePermissionStore } from '@/stores/permissionStore'
import type {
  AssignBatchUserMonthlyPassRequest,
  AssignUserMonthlyPassRequest,
  BatchAssignUserMonthlyPassResponse,
  MonthlyPassAssignmentMode,
  MonthlyPassQuotaWindowDto,
  MonthlyPassQuotaWindowInputDto,
  MonthlyPassTemplateDto,
  MonthlyPassTemplatePublishStatus,
  MonthlyPassUsageDto,
  UpdateMonthlyPassTemplateRequest,
  UpdateUserMonthlyPassRequest,
  UserMonthlyPassDto,
} from '@/client/types.gen'
import { PermissionService } from '@/service/permissionService'

type TabKey = 'templates' | 'assignments' | 'usages'
type QuotaUnit = 'amount' | 'request' | 'token'

interface ChannelOption {
  value: string
  label: string
  name: string
  allowedModels: string[] | null
}

interface UserOption {
  id: string
  username: string
}

interface GroupOption {
  id: string
  username: string
  name: string
}

interface EditableQuotaWindow {
  id: string
  quotaLimit: number | null
  quotaUnit: QuotaUnit
  quotaWindowHours: number | undefined
  days: number
  hours: number
}

const { isDesktop } = usePageDevice()
const permissionStore = usePermissionStore()

const canReadTemplates = computed(() =>
  permissionStore.hasPermission(Permission.MONTHLY_PASS_TEMPLATE_READ),
)
const canWriteTemplates = computed(() =>
  permissionStore.hasPermission(Permission.MONTHLY_PASS_TEMPLATE_WRITE),
)
const canReadAssignments = computed(() =>
  permissionStore.hasPermission(Permission.MONTHLY_PASS_ASSIGNMENT_READ),
)
const canWriteAssignments = computed(() =>
  permissionStore.hasPermission(Permission.MONTHLY_PASS_ASSIGNMENT_WRITE),
)
const canReadUsages = computed(() =>
  permissionStore.hasPermission(Permission.MONTHLY_PASS_USAGE_READ),
)

const hasAnyReadPermission = computed(
  () => canReadTemplates.value || canReadAssignments.value || canReadUsages.value,
)

const activeTab = ref<TabKey>('templates')
const refreshing = ref(false)

const loadingTemplates = ref(false)
const loadingAssignments = ref(false)
const loadingUsages = ref(false)

const templates = ref<MonthlyPassTemplateDto[]>([])
const userPasses = ref<UserMonthlyPassDto[]>([])
const usageRecords = ref<MonthlyPassUsageDto[]>([])

const modelOptions = ref<string[]>([])
const channelOptions = ref<ChannelOption[]>([])
const groupOptions = ref<GroupOption[]>([])
const userOptions = ref<UserOption[]>([])
const templateOptions = ref<MonthlyPassTemplateDto[]>([])
const userOptionsLoading = ref(false)
const batchUserOptions = ref<UserOption[]>([])
const batchUserOptionsLoading = ref(false)
const batchAssignmentResult = ref<BatchAssignUserMonthlyPassResponse | null>(null)

const templateFilters = reactive({
  keyword: '',
  status: '' as number | '',
})

const assignmentFilters = reactive({
  userId: '',
  templateId: '',
  status: '' as number | '',
})

const usageFilters = reactive({
  userId: '',
  templateId: '',
  model: '',
  startTime: '',
  endTime: '',
})

const usageDateRange = ref<[string, string] | null>(null)

const templatePagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
})

const billingRechargeRatio = ref<number | null>(null)

const assignmentPagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
})

const usagePagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
})

const showTemplateDialog = ref(false)
const editingTemplateId = ref<string | null>(null)
const templateDialogMode = ref<'create' | 'edit' | 'copy'>('create')
const savingTemplate = ref(false)

const templateForm = reactive({
  name: '',
  description: '',
  originalPrice: 1,
  discountPercent: 100,
  allowBalanceRedemption: true,
  purchaseLimitPerUser: undefined as number | undefined,
  purchaseLimitWindowDays: undefined as number | undefined,
  dailyQuota: undefined as number | undefined,
  rechargeRatioSnapshot: undefined as number | undefined,
  quotaWindows: [] as EditableQuotaWindow[],
  allowedModels: [] as string[],
  allowedChannels: [] as string[],
  status: MANAGED_STATUS.ENABLED as number,
})

const showAssignmentDialog = ref(false)
const editingAssignmentId = ref<string | null>(null)
const savingAssignment = ref(false)

const assignmentForm = reactive({
  batchMode: false,
  userId: '',
  userIds: [] as string[],
  assignmentMode: 'create_new' as MonthlyPassAssignmentMode,
  batchKeyword: '',
  batchGroupId: '',
  includeAllVisible: false,
  templateId: '',
  startAt: '',
  endAt: '',
  totalQuota: null as number | null,
  dailyQuota: undefined as number | undefined,
  quotaUnit: 'amount' as QuotaUnit,
  quotaWindows: [] as EditableQuotaWindow[],
  note: '',
  status: MANAGED_STATUS.ENABLED as number,
})

const quickDurationDays = ref<number | undefined>(7)
let editableQuotaWindowSeed = 0

const userNameById = computed(() => {
  return new Map(userOptions.value.map((item) => [item.id, item.username]))
})

const templateDialogTitle = computed(() => {
  if (templateDialogMode.value === 'edit') return i18ns.t('monthlyPass.editTemplate')
  if (templateDialogMode.value === 'copy') return i18ns.t('monthlyPass.copyTemplate')
  return i18ns.t('monthlyPass.createTemplate')
})

const channelNameById = computed(() => {
  return new Map(channelOptions.value.map((item) => [item.value, item.name]))
})

const availableTemplateModelOptions = computed(() => {
  if (!templateForm.allowedChannels.length) return modelOptions.value

  const selectedChannels = channelOptions.value.filter((item) =>
    templateForm.allowedChannels.includes(item.value),
  )

  if (!selectedChannels.length) return modelOptions.value

  const channelUnionModels = new Set<string>()
  let hasUnrestrictedChannel = false

  selectedChannels.forEach((channel) => {
    if (channel.allowedModels === null) {
      hasUnrestrictedChannel = true
      return
    }

    channel.allowedModels.forEach((model) => channelUnionModels.add(model))
  })

  if (hasUnrestrictedChannel) {
    const ordered = [...modelOptions.value]
    channelUnionModels.forEach((model) => {
      if (!ordered.includes(model)) ordered.push(model)
    })
    return ordered
  }

  const modelOptionsSet = new Set(modelOptions.value)
  const orderedInModelOptions: string[] = []
  modelOptions.value.forEach((model) => {
    if (channelUnionModels.has(model)) orderedInModelOptions.push(model)
  })

  const extras = Array.from(channelUnionModels)
    .filter((model) => !modelOptionsSet.has(model))
    .sort()
  return [...orderedInModelOptions, ...extras]
})

const assignableTemplateOptions = computed(() => {
  if (editingAssignmentId.value) return templateOptions.value
  return templateOptions.value.filter((item) => item.status === MANAGED_STATUS.ENABLED)
})

const selectedBatchUsers = computed(() => {
  const visibleMap = new Map(batchUserOptions.value.map((item) => [item.id, item]))
  return assignmentForm.userIds.map((userId) => {
    const visible = visibleMap.get(userId)
    return visible || { id: userId, username: userNameById.value.get(userId) || userId }
  })
})

const batchSelectionSummary = computed(() => {
  if (assignmentForm.includeAllVisible) {
    return i18ns.t('monthlyPass.batchIncludeAllVisibleSummary', {
      count: batchUserOptions.value.length,
    })
  }
  return i18ns.t('monthlyPass.batchSelectedUsersSummary', {
    count: assignmentForm.userIds.length,
  })
})

const getDefaultStartAt = () => new Date().toISOString()
const getDefaultEndAt = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_AMOUNT_QUOTA = 999999.9999
const MAX_INTEGER_QUOTA = 999999
const MAX_QUOTA_WINDOW_HOURS = 720
const MAX_QUOTA_WINDOW_DAYS = Math.floor(MAX_QUOTA_WINDOW_HOURS / 24)
const MAX_QUOTA_WINDOW_HOUR_PART = 23
const USER_OPTIONS_PAGE_SIZE = 50

const toErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

const round4 = (value: number) => Math.round(value * 10000) / 10000
const round2 = (value: number) => Math.round(value * 100) / 100

const formatDateTime = (value?: string) => {
  if (!value) return '-'
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return value
  return time.toLocaleString()
}

const formatAmount = (value?: number) => {
  if (value == null) return '-'
  return Number(value).toFixed(4)
}

const formatPriceValue = (value?: number) => {
  if (value == null) return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '-'
  return numeric.toFixed(4)
}

const formatPercentValue = (value?: number) => {
  if (value == null) return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '-'
  return `${numeric.toFixed(2)}%`
}

const formatRatioValue = (value?: number | null) => {
  if (value == null) return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '-'
  return numeric.toFixed(4)
}

const normalizeQuotaUnit = (value?: string): QuotaUnit => {
  if (value === 'request' || value === 'token') return value
  return 'amount'
}

const isIntegerQuotaUnit = (value?: string): boolean => {
  const unit = normalizeQuotaUnit(value)
  return unit === 'request' || unit === 'token'
}

const getQuotaMax = (value?: string): number => {
  return isIntegerQuotaUnit(value) ? MAX_INTEGER_QUOTA : MAX_AMOUNT_QUOTA
}

const getQuotaMin = (value?: string): number => {
  return isIntegerQuotaUnit(value) ? 1 : 0.0001
}

const getQuotaPrecision = (value?: string): number => {
  return isIntegerQuotaUnit(value) ? 0 : 4
}

const getQuotaStep = (value?: string): number => {
  return isIntegerQuotaUnit(value) ? 1 : 0.0001
}

const normalizeOptionalPositiveInteger = (value: unknown): number | undefined => {
  if (value == null || value === '') return undefined
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  return Math.floor(numeric)
}

const normalizeQuotaForSubmit = (value: number, unit?: string): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return numeric
  if (isIntegerQuotaUnit(unit)) return Math.floor(numeric)
  return Number(numeric.toFixed(4))
}

const normalizeQuotaForUnitSwitch = (value: number, unit?: string): number => {
  const normalized = normalizeQuotaForSubmit(value, unit)
  if (!Number.isFinite(normalized)) return normalized

  const clamped = Math.min(getQuotaMax(unit), Math.max(getQuotaMin(unit), normalized))
  return isIntegerQuotaUnit(unit) ? Math.floor(clamped) : Number(clamped.toFixed(4))
}

const normalizeAssignmentQuotaFieldsByUnit = () => {
  const unit = assignmentForm.quotaUnit

  if (assignmentForm.totalQuota != null) {
    assignmentForm.totalQuota = normalizeQuotaForUnitSwitch(assignmentForm.totalQuota, unit)
  }

  if (assignmentForm.dailyQuota != null) {
    assignmentForm.dailyQuota = normalizeQuotaForUnitSwitch(assignmentForm.dailyQuota, unit)
    if (
      assignmentForm.totalQuota != null &&
      assignmentForm.dailyQuota > assignmentForm.totalQuota
    ) {
      assignmentForm.dailyQuota = assignmentForm.totalQuota
    }
  }
}

const formatQuotaValue = (value?: number, unit?: string) => {
  if (value == null) return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '-'
  if (isIntegerQuotaUnit(unit)) return String(Math.floor(numeric))
  return numeric.toFixed(4)
}

const formatDailyQuota = (value?: number, unit?: string) => {
  if (value == null) return i18ns.t('monthlyPass.unlimited')
  return formatQuotaValue(value, unit)
}

const templatePricingPreview = computed(() => {
  const originalPrice = Number(templateForm.originalPrice)
  const discountPercent = Number(templateForm.discountPercent)
  const rechargeRatio =
    billingRechargeRatio.value != null
      ? billingRechargeRatio.value
      : templateForm.rechargeRatioSnapshot != null
        ? templateForm.rechargeRatioSnapshot
        : null

  const discountedPrice =
    Number.isFinite(originalPrice) &&
    Number.isFinite(discountPercent) &&
    originalPrice > 0 &&
    discountPercent > 0
      ? round4((originalPrice * discountPercent) / 100)
      : undefined

  const derivedQuota =
    rechargeRatio != null && Number.isFinite(originalPrice) && originalPrice > 0
      ? round4(originalPrice * rechargeRatio)
      : undefined

  return {
    discountedPrice,
    derivedQuota,
    rechargeRatio,
  }
})

const formatQuotaUnit = (value?: string) => {
  const unit = normalizeQuotaUnit(value)
  if (unit === 'request') return i18ns.t('monthlyPass.quotaUnitRequest')
  if (unit === 'token') return i18ns.t('monthlyPass.quotaUnitToken')
  return i18ns.t('monthlyPass.quotaUnitAmount')
}

const normalizeQuotaWindowHours = (value?: number): number | undefined => {
  if (value == null) return undefined
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  return Math.min(Math.floor(numeric), MAX_QUOTA_WINDOW_HOURS)
}

const createEditableQuotaWindow = (
  source?: Partial<MonthlyPassQuotaWindowDto | MonthlyPassQuotaWindowInputDto>,
): EditableQuotaWindow => {
  const normalizedHours = normalizeQuotaWindowHours(source?.quotaWindowHours)
  const parts = splitQuotaWindowParts(normalizedHours)
  editableQuotaWindowSeed += 1
  return {
    id: `quota-window-${editableQuotaWindowSeed}`,
    quotaLimit:
      source?.quotaLimit != null
        ? normalizeQuotaForSubmit(source.quotaLimit, source.quotaUnit)
        : null,
    quotaUnit: normalizeQuotaUnit(source?.quotaUnit),
    quotaWindowHours: normalizedHours,
    days: parts.days,
    hours: parts.hours,
  }
}

const updateEditableQuotaWindowHours = (window: EditableQuotaWindow) => {
  const normalized = combineQuotaWindowParts(window.days, window.hours)
  window.quotaWindowHours = normalized
  const parts = splitQuotaWindowParts(normalized)
  window.days = parts.days
  window.hours = parts.hours
}

const clearEditableQuotaWindow = (window: EditableQuotaWindow) => {
  window.quotaWindowHours = undefined
  window.days = 0
  window.hours = 0
}

const getTemplateQuotaWindowSource = (row: MonthlyPassTemplateDto) => {
  if (row.quotaWindows?.length) return row.quotaWindows
  if (row.quotaWindowHours && row.defaultQuota != null) {
    return [
      {
        quotaLimit: row.defaultQuota,
        quotaUnit: normalizeQuotaUnit(row.quotaUnit),
        quotaWindowHours: row.quotaWindowHours,
      },
    ]
  }
  return []
}

const getUserPassQuotaWindowSource = (row: UserMonthlyPassDto) => {
  if (row.quotaWindows?.length) return row.quotaWindows
  if (row.quotaWindowHours && row.totalQuota != null) {
    return [
      {
        quotaLimit: row.totalQuota,
        quotaUnit: normalizeQuotaUnit(row.quotaUnit),
        quotaWindowHours: row.quotaWindowHours,
      },
    ]
  }
  return []
}

const cloneEditableQuotaWindows = (
  source: Array<MonthlyPassQuotaWindowDto | MonthlyPassQuotaWindowInputDto>,
) => source.map((item) => createEditableQuotaWindow(item))

const addTemplateQuotaWindow = () => {
  templateForm.quotaWindows.push(createEditableQuotaWindow({ quotaUnit: 'amount' }))
}

const removeTemplateQuotaWindow = (index: number) => {
  templateForm.quotaWindows.splice(index, 1)
}

const addAssignmentQuotaWindow = () => {
  assignmentForm.quotaWindows.push(
    createEditableQuotaWindow({ quotaUnit: assignmentForm.quotaUnit }),
  )
}

const removeAssignmentQuotaWindow = (index: number) => {
  assignmentForm.quotaWindows.splice(index, 1)
}

const normalizeQuotaWindowsForSubmit = (
  windows: EditableQuotaWindow[],
): MonthlyPassQuotaWindowInputDto[] | undefined => {
  const normalizedWindows = windows
    .map((window) => ({
      quotaLimit:
        window.quotaLimit == null
          ? null
          : normalizeQuotaForSubmit(window.quotaLimit, window.quotaUnit),
      quotaUnit: normalizeQuotaUnit(window.quotaUnit),
      quotaWindowHours: normalizeQuotaWindowHours(window.quotaWindowHours),
    }))
    .filter((window) => window.quotaLimit != null || window.quotaWindowHours != null)

  if (!normalizedWindows.length) return undefined

  const uniqueKeys = new Set<string>()
  for (const window of normalizedWindows) {
    if (
      window.quotaLimit == null ||
      !Number.isFinite(window.quotaLimit) ||
      window.quotaLimit <= 0
    ) {
      throw new Error(i18ns.t('monthlyPass.quotaWindowQuotaInvalid'))
    }
    if (!window.quotaWindowHours) {
      throw new Error(i18ns.t('monthlyPass.quotaWindowHoursRequired'))
    }
    if (isIntegerQuotaUnit(window.quotaUnit) && !Number.isInteger(window.quotaLimit)) {
      throw new Error(i18ns.t('monthlyPass.integerQuotaRequired'))
    }
    if (window.quotaLimit > getQuotaMax(window.quotaUnit)) {
      throw new Error(i18ns.t('monthlyPass.quotaExceededMax'))
    }
    const key = `${window.quotaUnit}:${window.quotaWindowHours}`
    if (uniqueKeys.has(key)) {
      throw new Error(i18ns.t('monthlyPass.quotaWindowDuplicate'))
    }
    uniqueKeys.add(key)
  }

  return normalizedWindows as MonthlyPassQuotaWindowInputDto[]
}

const formatQuotaWindowRule = (window: {
  quotaLimit?: number | null
  quotaUnit?: string
  quotaWindowHours?: number
}) => {
  const quotaLabel = formatQuotaValue(window.quotaLimit ?? undefined, window.quotaUnit)
  return `${quotaLabel} ${formatQuotaUnit(window.quotaUnit)} / ${formatQuotaWindowHours(window.quotaWindowHours)}`
}

const formatQuotaWindows = (
  windows?: Array<{
    quotaLimit?: number | null
    quotaUnit?: string
    quotaWindowHours?: number
  }> | null,
) => {
  if (!windows?.length) return i18ns.t('monthlyPass.unlimited')
  return windows.map((item) => formatQuotaWindowRule(item)).join('；')
}

const clampNonNegativeInteger = (value: unknown, max: number): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return Math.min(Math.floor(numeric), max)
}

const splitQuotaWindowParts = (value?: number) => {
  const normalized = normalizeQuotaWindowHours(value)
  if (!normalized) {
    return {
      days: 0,
      hours: 0,
    }
  }

  return {
    days: Math.floor(normalized / 24),
    hours: normalized % 24,
  }
}

const combineQuotaWindowParts = (daysValue: unknown, hoursValue: unknown): number | undefined => {
  const days = clampNonNegativeInteger(daysValue, MAX_QUOTA_WINDOW_DAYS)
  const hours = clampNonNegativeInteger(hoursValue, MAX_QUOTA_WINDOW_HOUR_PART)
  const totalHours = days * 24 + hours
  return normalizeQuotaWindowHours(totalHours)
}

const formatQuotaWindowLabel = (hours: number) => {
  const normalized = normalizeQuotaWindowHours(hours)
  if (!normalized) return '-'
  const hoursLabel = `${normalized}${i18ns.t('monthlyPass.hoursUnit')}`
  if (normalized % 24 !== 0) return hoursLabel

  const days = normalized / 24
  return `${hoursLabel} (${days}${i18ns.t('monthlyPass.daysUnit')})`
}

const formatQuotaWindowHours = (value?: number) => {
  const normalized = normalizeQuotaWindowHours(value)
  if (!normalized) return i18ns.t('monthlyPass.unlimited')
  return formatQuotaWindowLabel(normalized)
}

const parseDate = (value?: string): Date | null => {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

const toIso = (date: Date): string => date.toISOString()

const normalizedQuickDurationDays = computed(() => {
  const numeric = Number(quickDurationDays.value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 1
  return Math.floor(numeric)
})

const setAssignmentDurationDays = (days: number) => {
  const start = parseDate(assignmentForm.startAt) || new Date()
  const end = new Date(start.getTime() + days * DAY_MS)
  assignmentForm.startAt = toIso(start)
  assignmentForm.endAt = toIso(end)
}

const applyQuickDuration = () => {
  setAssignmentDurationDays(normalizedQuickDurationDays.value)
}

const increaseAssignmentDuration = () => {
  shiftAssignmentEndDays(normalizedQuickDurationDays.value)
}

const decreaseAssignmentDuration = () => {
  shiftAssignmentEndDays(-normalizedQuickDurationDays.value)
}

const shiftAssignmentEndDays = (days: number) => {
  const start = parseDate(assignmentForm.startAt)
  const end = parseDate(assignmentForm.endAt) || start || new Date()
  const nextEnd = new Date(end.getTime() + days * DAY_MS)

  if (start && nextEnd.getTime() <= start.getTime()) {
    ElMessage.warning(i18ns.t('monthlyPass.timeRangeInvalid'))
    return
  }

  if (!assignmentForm.startAt) assignmentForm.startAt = toIso(start || new Date())
  assignmentForm.endAt = toIso(nextEnd)
}

const statusLabel = (status: number) => {
  if (status === MANAGED_STATUS.ENABLED) return i18ns.t('monthlyPass.enabled')
  return i18ns.t('monthlyPass.disabled')
}

const publishStatusLabel = (status?: MonthlyPassTemplatePublishStatus) => {
  if (status === 'published') return i18ns.t('monthlyPass.published')
  return i18ns.t('monthlyPass.draft')
}

const publishStatusTagType = (status?: MonthlyPassTemplatePublishStatus) => {
  return status === 'published' ? 'success' : 'info'
}

const canPublishTemplate = (row: MonthlyPassTemplateDto) => {
  return row.publishStatus !== 'published' && row.status === MANAGED_STATUS.ENABLED
}

const canUnpublishTemplate = (row: MonthlyPassTemplateDto) => {
  return row.publishStatus === 'published'
}

const formatAllowedModels = (allowedModels?: string[]) => {
  if (!allowedModels || allowedModels.length === 0) return i18ns.t('monthlyPass.allModels')
  return allowedModels.join(', ')
}

const formatAllowedChannels = (allowedChannels?: string[]) => {
  if (!allowedChannels || allowedChannels.length === 0) return i18ns.t('monthlyPass.allChannels')
  return allowedChannels
    .map((channelId) => channelNameById.value.get(channelId) || channelId)
    .join(', ')
}

const formatPurchaseLimit = (row: MonthlyPassTemplateDto) => {
  if (!row.purchaseLimitPerUser || !row.purchaseLimitWindowDays) {
    return i18ns.t('monthlyPass.unlimited')
  }

  return i18ns.t('monthlyPass.purchaseLimitValue', {
    count: row.purchaseLimitPerUser,
    days: row.purchaseLimitWindowDays,
  })
}

const parseChannelAllowedModels = (allowedModels?: string | null): string[] | null => {
  if (!allowedModels) return null

  try {
    const parsed = JSON.parse(allowedModels)
    if (!Array.isArray(parsed)) return null
    const cleaned = parsed.map((item) => String(item || '').trim()).filter(Boolean)
    return Array.from(new Set(cleaned))
  } catch {
    // Keep behavior aligned with backend fallback: invalid whitelist is treated as unrestricted.
    return null
  }
}

const loadModelOptions = async () => {
  try {
    const models = await modelPricingService.getModelPricing()
    modelOptions.value = Array.from(
      new Set(models.map((item) => item.model).filter(Boolean)),
    ).sort()
  } catch (_error) {
    modelOptions.value = []
  }
}

const loadChannelOptions = async () => {
  try {
    const channels = await relayChannelService.listChannels()
    channelOptions.value = channels
      .map((item) => ({
        value: item.id,
        name: item.name,
        label: item.name ? `${item.name} (${item.id})` : item.id,
        allowedModels: parseChannelAllowedModels(item.allowedModels),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  } catch (_error) {
    channelOptions.value = []
  }
}

const loadBillingConfig = async () => {
  try {
    const config = await configService.getBillingConfig()
    billingRechargeRatio.value = Number.isFinite(Number(config.rechargeRatio))
      ? Number(config.rechargeRatio)
      : null
  } catch (_error) {
    billingRechargeRatio.value = null
  }
}

const loadGroupOptions = async () => {
  try {
    const data = await groupService.getAllGroups()
    const groups = Array.isArray(data) ? data : data.groups
    groupOptions.value = groups
      .map((item: { id: string; username: string; name?: string | null }) => ({
        id: item.id,
        username: item.username,
        name: item.name || item.username,
      }))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
  } catch (_error) {
    groupOptions.value = []
  }
}

const handleTemplateAllowedChannelsChange = () => {
  if (!templateForm.allowedModels.length) return

  const availableModelSet = new Set(availableTemplateModelOptions.value)
  templateForm.allowedModels = templateForm.allowedModels.filter((model) =>
    availableModelSet.has(model),
  )
}

const ensureUserOption = (userId?: string, username?: string | null) => {
  if (!userId) return
  if (userOptions.value.some((item) => item.id === userId)) return

  userOptions.value = [
    {
      id: userId,
      username: username || userId,
    },
    ...userOptions.value,
  ]
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
  } catch (_error) {
    userOptions.value = []
  } finally {
    userOptionsLoading.value = false
  }
}

const handleUserSearch = (query: string) => {
  void loadUserOptions(query)
}

const loadBatchUserOptions = async () => {
  batchUserOptionsLoading.value = true
  try {
    const keyword = assignmentForm.batchKeyword.trim()
    const groupId = assignmentForm.batchGroupId || undefined
    const result = await userService.getAllUsers({
      page: 1,
      pageSize: 100,
      keyword: keyword || undefined,
      groupId,
    })
    const users = Array.isArray(result?.users) ? result.users : []
    batchUserOptions.value = users.map((item: { id: string; username?: string }) => ({
      id: item.id,
      username: item.username || item.id,
    }))
    batchUserOptions.value.forEach((user) => ensureUserOption(user.id, user.username))
  } catch (error) {
    batchUserOptions.value = []
    ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.loadFailed')))
  } finally {
    batchUserOptionsLoading.value = false
  }
}

const selectAllVisibleBatchUsers = () => {
  const merged = new Set(assignmentForm.userIds)
  batchUserOptions.value.forEach((user) => merged.add(user.id))
  assignmentForm.userIds = Array.from(merged)
  assignmentForm.includeAllVisible = true
}

const clearBatchUserSelection = () => {
  assignmentForm.userIds = []
  assignmentForm.includeAllVisible = false
}

const normalizedBatchTargetFilter = computed(() => {
  const keyword = assignmentForm.batchKeyword.trim()
  const groupId = assignmentForm.batchGroupId || undefined

  if (!assignmentForm.includeAllVisible && !keyword && !groupId) return undefined

  return {
    keyword: keyword || undefined,
    groupId,
    includeAllVisible: assignmentForm.includeAllVisible || undefined,
  }
})

const loadTemplateOptions = async () => {
  if (!canReadTemplates.value && !canReadAssignments.value && !canReadUsages.value) {
    templateOptions.value = []
    return
  }

  try {
    const records: MonthlyPassTemplateDto[] = []
    const pageSize = 100
    let page = 1
    let total = 0

    do {
      const result = await monthlyPassService.listTemplates({
        page,
        pageSize,
      })

      const pageRecords = result.records || []
      records.push(...pageRecords)
      total = result.total || 0
      page += 1

      if (pageRecords.length === 0) break
    } while (records.length < total)

    templateOptions.value = records
  } catch (_error) {
    templateOptions.value = []
  }
}

const loadTemplates = async () => {
  if (!canReadTemplates.value) return

  loadingTemplates.value = true
  try {
    const result = await monthlyPassService.listTemplates({
      page: templatePagination.page,
      pageSize: templatePagination.pageSize,
      keyword: templateFilters.keyword || undefined,
      status: templateFilters.status === '' ? undefined : templateFilters.status,
    })

    templates.value = result.records || []
    templatePagination.total = result.total || 0
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.loadFailed')))
  } finally {
    loadingTemplates.value = false
  }
}

const loadAssignments = async () => {
  if (!canReadAssignments.value) return

  loadingAssignments.value = true
  try {
    const result = await monthlyPassService.listUserPasses({
      page: assignmentPagination.page,
      pageSize: assignmentPagination.pageSize,
      userId: assignmentFilters.userId || undefined,
      templateId: assignmentFilters.templateId || undefined,
      status: assignmentFilters.status === '' ? undefined : assignmentFilters.status,
    })

    userPasses.value = result.records || []
    assignmentPagination.total = result.total || 0
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.loadFailed')))
  } finally {
    loadingAssignments.value = false
  }
}

const loadUsages = async () => {
  if (!canReadUsages.value) return

  loadingUsages.value = true
  try {
    const result = await monthlyPassService.listUsages({
      page: usagePagination.page,
      pageSize: usagePagination.pageSize,
      userId: usageFilters.userId || undefined,
      templateId: usageFilters.templateId || undefined,
      model: usageFilters.model || undefined,
      startTime: usageFilters.startTime || undefined,
      endTime: usageFilters.endTime || undefined,
    })

    usageRecords.value = result.records || []
    usagePagination.total = result.total || 0
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.loadFailed')))
  } finally {
    loadingUsages.value = false
  }
}

const loadByTab = async (tab: TabKey) => {
  if (tab === 'templates') {
    await loadTemplates()
    return
  }

  if (tab === 'assignments') {
    await loadAssignments()
    return
  }

  await loadUsages()
}

const initializeActiveTab = () => {
  if (canReadTemplates.value) {
    activeTab.value = 'templates'
    return
  }

  if (canReadAssignments.value) {
    activeTab.value = 'assignments'
    return
  }

  activeTab.value = 'usages'
}

const refreshCurrentTab = async () => {
  refreshing.value = true
  try {
    await loadByTab(activeTab.value)
  } finally {
    refreshing.value = false
  }
}

const handleTabChange = async (name: string | number) => {
  const normalized = String(name)
  if (normalized !== 'templates' && normalized !== 'assignments' && normalized !== 'usages') return

  await loadByTab(normalized)
}

const resetTemplateForm = () => {
  templateForm.name = ''
  templateForm.description = ''
  templateForm.originalPrice = 1
  templateForm.discountPercent = 100
  templateForm.allowBalanceRedemption = true
  templateForm.purchaseLimitPerUser = undefined
  templateForm.purchaseLimitWindowDays = undefined
  templateForm.dailyQuota = undefined
  templateForm.rechargeRatioSnapshot = undefined
  templateForm.quotaWindows = []
  templateForm.allowedModels = []
  templateForm.allowedChannels = []
  templateForm.status = MANAGED_STATUS.ENABLED
}

const clearTemplatePurchaseLimit = () => {
  templateForm.purchaseLimitPerUser = undefined
  templateForm.purchaseLimitWindowDays = undefined
}

const buildCopiedTemplateName = (name: string) => {
  const baseName = name.trim()
  const suffix = i18ns.t('monthlyPass.copyNameSuffix')
  const maxLength = 100

  if (!baseName) return suffix.trim().slice(0, maxLength)
  if (baseName.endsWith(suffix)) return baseName.slice(0, maxLength)
  if (baseName.length + suffix.length <= maxLength) return `${baseName}${suffix}`

  const truncatedBase = baseName.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd()
  return `${truncatedBase}${suffix}`
}

const applyTemplateFormFromRow = (row: MonthlyPassTemplateDto) => {
  templateForm.name = row.name
  templateForm.description = row.description || ''
  templateForm.originalPrice = row.originalPrice != null ? round4(Number(row.originalPrice)) : 1
  templateForm.discountPercent =
    row.discountPercent != null ? round2(Number(row.discountPercent)) : 100
  templateForm.allowBalanceRedemption = row.allowBalanceRedemption ?? true
  templateForm.purchaseLimitPerUser = row.purchaseLimitPerUser ?? undefined
  templateForm.purchaseLimitWindowDays = row.purchaseLimitWindowDays ?? undefined
  templateForm.dailyQuota =
    row.dailyQuota == null ? undefined : normalizeQuotaForSubmit(row.dailyQuota, 'amount')
  templateForm.rechargeRatioSnapshot =
    row.rechargeRatio != null ? Number(row.rechargeRatio) : undefined
  templateForm.quotaWindows = cloneEditableQuotaWindows(getTemplateQuotaWindowSource(row))
  templateForm.allowedModels = row.allowedModels ? [...row.allowedModels] : []
  templateForm.allowedChannels = row.allowedChannels ? [...row.allowedChannels] : []
  templateForm.status = row.status
}

const openCreateTemplateDialog = () => {
  templateDialogMode.value = 'create'
  editingTemplateId.value = null
  resetTemplateForm()
  showTemplateDialog.value = true
}

const openEditTemplateDialog = (row: MonthlyPassTemplateDto) => {
  templateDialogMode.value = 'edit'
  editingTemplateId.value = row.id
  applyTemplateFormFromRow(row)
  showTemplateDialog.value = true
}

const openCopyTemplateDialog = (row: MonthlyPassTemplateDto) => {
  templateDialogMode.value = 'copy'
  editingTemplateId.value = null
  applyTemplateFormFromRow(row)
  templateForm.name = buildCopiedTemplateName(row.name)
  templateForm.status = MANAGED_STATUS.ENABLED
  showTemplateDialog.value = true
}

const submitTemplate = async () => {
  const name = templateForm.name.trim()
  if (!name) {
    ElMessage.warning(i18ns.t('monthlyPass.templateNameRequired'))
    return
  }

  const originalPrice = round4(Number(templateForm.originalPrice))
  if (!Number.isFinite(originalPrice) || originalPrice <= 0) {
    ElMessage.warning(i18ns.t('monthlyPass.originalPriceInvalid'))
    return
  }
  if (originalPrice > MAX_AMOUNT_QUOTA) {
    ElMessage.warning(i18ns.t('monthlyPass.quotaExceededMax'))
    return
  }

  const discountPercent = round2(Number(templateForm.discountPercent))
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    ElMessage.warning(i18ns.t('monthlyPass.discountPercentInvalid'))
    return
  }

  const normalizedDailyQuota =
    templateForm.dailyQuota == null
      ? undefined
      : normalizeQuotaForSubmit(templateForm.dailyQuota, 'amount')

  if (normalizedDailyQuota != null) {
    if (!Number.isFinite(normalizedDailyQuota) || normalizedDailyQuota <= 0) {
      ElMessage.warning(i18ns.t('monthlyPass.dailyQuotaInvalid'))
      return
    }
    if (normalizedDailyQuota > MAX_AMOUNT_QUOTA) {
      ElMessage.warning(i18ns.t('monthlyPass.quotaExceededMax'))
      return
    }
    if (
      templatePricingPreview.value.derivedQuota != null &&
      normalizedDailyQuota > templatePricingPreview.value.derivedQuota
    ) {
      ElMessage.warning(i18ns.t('monthlyPass.dailyQuotaInvalid'))
      return
    }
  }

  templateForm.originalPrice = originalPrice
  templateForm.discountPercent = discountPercent
  templateForm.dailyQuota = normalizedDailyQuota

  const purchaseLimitPerUser = normalizeOptionalPositiveInteger(templateForm.purchaseLimitPerUser)
  const purchaseLimitWindowDays = normalizeOptionalPositiveInteger(
    templateForm.purchaseLimitWindowDays,
  )
  const hasPurchaseLimit = purchaseLimitPerUser != null || purchaseLimitWindowDays != null

  if (hasPurchaseLimit && (purchaseLimitPerUser == null || purchaseLimitWindowDays == null)) {
    ElMessage.warning(i18ns.t('monthlyPass.purchaseLimitInvalid'))
    return
  }

  templateForm.purchaseLimitPerUser = purchaseLimitPerUser
  templateForm.purchaseLimitWindowDays = purchaseLimitWindowDays

  savingTemplate.value = true
  try {
    const hasSelectedModels = templateForm.allowedModels.length > 0
    const hasSelectedChannels = templateForm.allowedChannels.length > 0
    const isEditingTemplate = Boolean(editingTemplateId.value)
    const normalizedQuotaWindows = normalizeQuotaWindowsForSubmit(templateForm.quotaWindows)

    const payload: UpdateMonthlyPassTemplateRequest = {
      name,
      description: templateForm.description.trim() || undefined,
      originalPrice,
      discountPercent,
      allowBalanceRedemption: templateForm.allowBalanceRedemption,
      purchaseLimitPerUser: purchaseLimitPerUser ?? (isEditingTemplate ? null : undefined),
      purchaseLimitWindowDays: purchaseLimitWindowDays ?? (isEditingTemplate ? null : undefined),
      dailyQuota:
        normalizedDailyQuota != null ? normalizedDailyQuota : isEditingTemplate ? null : undefined,
      quotaWindowHours: isEditingTemplate ? null : undefined,
      quotaWindows: normalizedQuotaWindows,
      allowedModels: hasSelectedModels
        ? [...templateForm.allowedModels]
        : isEditingTemplate
          ? null
          : undefined,
      allowedChannels: hasSelectedChannels
        ? [...templateForm.allowedChannels]
        : isEditingTemplate
          ? null
          : undefined,
      status: isEditingTemplate ? templateForm.status : undefined,
    }

    if (editingTemplateId.value) {
      await monthlyPassService.updateTemplate(editingTemplateId.value, payload)
    } else {
      await monthlyPassService.createTemplate({
        name,
        description: templateForm.description.trim() || undefined,
        originalPrice,
        discountPercent,
        allowBalanceRedemption: templateForm.allowBalanceRedemption,
        purchaseLimitPerUser,
        purchaseLimitWindowDays,
        dailyQuota: normalizedDailyQuota,
        quotaWindows: normalizedQuotaWindows,
        allowedModels:
          templateForm.allowedModels.length > 0 ? [...templateForm.allowedModels] : undefined,
        allowedChannels:
          templateForm.allowedChannels.length > 0 ? [...templateForm.allowedChannels] : undefined,
      })
    }

    ElMessage.success(i18ns.t('monthlyPass.saveSuccess'))
    showTemplateDialog.value = false
    await Promise.all([loadTemplates(), loadTemplateOptions()])
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.saveFailed')))
  } finally {
    savingTemplate.value = false
  }
}

const deleteTemplate = async (row: MonthlyPassTemplateDto) => {
  try {
    await ElMessageBox.confirm(i18ns.t('confirmDelete'), i18ns.t('warning'), {
      type: 'warning',
    })

    await monthlyPassService.deleteTemplate(row.id)
    ElMessage.success(i18ns.t('monthlyPass.deleteSuccess'))
    await Promise.all([loadTemplates(), loadTemplateOptions()])
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.deleteFailed')))
  }
}

const publishTemplate = async (row: MonthlyPassTemplateDto) => {
  try {
    await monthlyPassService.publishTemplate(row.id)
    ElMessage.success(i18ns.t('monthlyPass.publishSuccess'))
    await Promise.all([loadTemplates(), loadTemplateOptions()])
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.publishFailed')))
  }
}

const unpublishTemplate = async (row: MonthlyPassTemplateDto) => {
  try {
    await monthlyPassService.unpublishTemplate(row.id)
    ElMessage.success(i18ns.t('monthlyPass.unpublishSuccess'))
    await Promise.all([loadTemplates(), loadTemplateOptions()])
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.unpublishFailed')))
  }
}

const resetAssignmentForm = () => {
  assignmentForm.userId = ''
  assignmentForm.userIds = []
  assignmentForm.batchMode = false
  assignmentForm.assignmentMode = 'create_new'
  assignmentForm.batchKeyword = ''
  assignmentForm.batchGroupId = ''
  assignmentForm.includeAllVisible = false
  assignmentForm.templateId = ''
  assignmentForm.startAt = getDefaultStartAt()
  assignmentForm.endAt = getDefaultEndAt()
  assignmentForm.totalQuota = null
  assignmentForm.dailyQuota = undefined
  assignmentForm.quotaUnit = 'amount'
  assignmentForm.quotaWindows = []
  assignmentForm.note = ''
  assignmentForm.status = MANAGED_STATUS.ENABLED
  quickDurationDays.value = 7
}

const openCreateAssignmentDialog = () => {
  editingAssignmentId.value = null
  resetAssignmentForm()
  batchAssignmentResult.value = null
  showAssignmentDialog.value = true
}

const openEditAssignmentDialog = (row: UserMonthlyPassDto) => {
  editingAssignmentId.value = row.id
  ensureUserOption(row.userId, row.username)
  assignmentForm.userId = row.userId
  assignmentForm.templateId = row.templateId
  assignmentForm.startAt = row.startAt
  assignmentForm.endAt = row.endAt
  const quotaUnit = normalizeQuotaUnit(row.quotaUnit)
  assignmentForm.totalQuota = normalizeQuotaForSubmit(row.totalQuota, quotaUnit)
  assignmentForm.dailyQuota =
    row.dailyQuota == null ? undefined : normalizeQuotaForSubmit(row.dailyQuota, quotaUnit)
  assignmentForm.quotaUnit = quotaUnit
  assignmentForm.quotaWindows = cloneEditableQuotaWindows(getUserPassQuotaWindowSource(row))
  assignmentForm.note = row.note || ''
  assignmentForm.status = row.status
  assignmentForm.batchMode = false
  batchAssignmentResult.value = null
  showAssignmentDialog.value = true
}

const submitAssignment = async () => {
  if (!editingAssignmentId.value && !assignmentForm.batchMode && !assignmentForm.userId) {
    ElMessage.warning(i18ns.t('monthlyPass.userRequired'))
    return
  }

  if (
    !editingAssignmentId.value &&
    assignmentForm.batchMode &&
    !assignmentForm.includeAllVisible &&
    assignmentForm.userIds.length === 0
  ) {
    ElMessage.warning(i18ns.t('monthlyPass.batchTargetsRequired'))
    return
  }

  if (!assignmentForm.templateId) {
    ElMessage.warning(i18ns.t('monthlyPass.templateRequired'))
    return
  }

  if (!assignmentForm.startAt || !assignmentForm.endAt) {
    ElMessage.warning(i18ns.t('monthlyPass.timeRangeInvalid'))
    return
  }

  if (new Date(assignmentForm.endAt).getTime() <= new Date(assignmentForm.startAt).getTime()) {
    ElMessage.warning(i18ns.t('monthlyPass.timeRangeInvalid'))
    return
  }

  const quotaUnit = normalizeQuotaUnit(assignmentForm.quotaUnit)
  const quotaMax = getQuotaMax(quotaUnit)

  const normalizedTotalQuota =
    assignmentForm.totalQuota == null
      ? undefined
      : normalizeQuotaForSubmit(assignmentForm.totalQuota, quotaUnit)
  if (normalizedTotalQuota != null) {
    if (isIntegerQuotaUnit(quotaUnit) && !Number.isInteger(Number(assignmentForm.totalQuota))) {
      ElMessage.warning(i18ns.t('monthlyPass.integerQuotaRequired'))
      return
    }
    if (!Number.isFinite(normalizedTotalQuota) || normalizedTotalQuota <= 0) {
      ElMessage.warning(i18ns.t('monthlyPass.totalQuotaInvalid'))
      return
    }
    if (normalizedTotalQuota > quotaMax) {
      ElMessage.warning(i18ns.t('monthlyPass.quotaExceededMax'))
      return
    }
  }

  const normalizedDailyQuota =
    assignmentForm.dailyQuota == null
      ? undefined
      : normalizeQuotaForSubmit(assignmentForm.dailyQuota, quotaUnit)
  if (normalizedDailyQuota != null) {
    if (isIntegerQuotaUnit(quotaUnit) && !Number.isInteger(Number(assignmentForm.dailyQuota))) {
      ElMessage.warning(i18ns.t('monthlyPass.integerQuotaRequired'))
      return
    }
    if (!Number.isFinite(normalizedDailyQuota) || normalizedDailyQuota <= 0) {
      ElMessage.warning(i18ns.t('monthlyPass.dailyQuotaInvalid'))
      return
    }
    if (normalizedDailyQuota > quotaMax) {
      ElMessage.warning(i18ns.t('monthlyPass.quotaExceededMax'))
      return
    }
    if (normalizedTotalQuota != null && normalizedDailyQuota > normalizedTotalQuota) {
      ElMessage.warning(i18ns.t('monthlyPass.dailyQuotaInvalid'))
      return
    }
  }

  assignmentForm.totalQuota = normalizedTotalQuota ?? null
  assignmentForm.dailyQuota = normalizedDailyQuota

  savingAssignment.value = true
  try {
    const normalizedQuotaWindows = normalizeQuotaWindowsForSubmit(assignmentForm.quotaWindows)

    if (editingAssignmentId.value) {
      const payload: UpdateUserMonthlyPassRequest = {
        startAt: assignmentForm.startAt,
        endAt: assignmentForm.endAt,
        totalQuota: normalizedTotalQuota,
        dailyQuota: normalizedDailyQuota != null ? normalizedDailyQuota : null,
        quotaUnit,
        quotaWindowHours: null,
        quotaWindows: normalizedQuotaWindows,
        note: assignmentForm.note.trim() || undefined,
        status: assignmentForm.status,
      }
      await monthlyPassService.updateUserPass(editingAssignmentId.value, payload)
    } else if (assignmentForm.batchMode) {
      const payload: AssignBatchUserMonthlyPassRequest = {
        userIds: assignmentForm.includeAllVisible ? undefined : [...assignmentForm.userIds],
        targetFilter: normalizedBatchTargetFilter.value,
        templateId: assignmentForm.templateId,
        startAt: assignmentForm.startAt,
        endAt: assignmentForm.endAt,
        totalQuota: normalizedTotalQuota,
        dailyQuota: normalizedDailyQuota,
        quotaUnit,
        quotaWindows: normalizedQuotaWindows,
        note: assignmentForm.note.trim() || undefined,
        assignmentMode: assignmentForm.assignmentMode,
      }
      batchAssignmentResult.value = await monthlyPassService.assignUserPassBatch(payload)
    } else {
      const payload: AssignUserMonthlyPassRequest = {
        userId: assignmentForm.userId,
        templateId: assignmentForm.templateId,
        startAt: assignmentForm.startAt,
        endAt: assignmentForm.endAt,
        totalQuota: normalizedTotalQuota,
        dailyQuota: normalizedDailyQuota,
        quotaUnit,
        quotaWindows: normalizedQuotaWindows,
        note: assignmentForm.note.trim() || undefined,
      }
      await monthlyPassService.assignUserPass(payload)
    }

    ElMessage.success(i18ns.t('monthlyPass.saveSuccess'))
    await loadAssignments()
    if (!assignmentForm.batchMode || editingAssignmentId.value) {
      showAssignmentDialog.value = false
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : toErrorMessage(error, i18ns.t('monthlyPass.saveFailed'))
    ElMessage.error(message)
  } finally {
    savingAssignment.value = false
  }
}

const deleteAssignment = async (row: UserMonthlyPassDto) => {
  try {
    await ElMessageBox.confirm(i18ns.t('confirmDelete'), i18ns.t('warning'), {
      type: 'warning',
    })

    await monthlyPassService.deleteUserPass(row.id)
    ElMessage.success(i18ns.t('monthlyPass.deleteSuccess'))
    await loadAssignments()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.deleteFailed')))
  }
}

const handleUsageDateRangeChange = (value: [string, string] | null) => {
  if (!value) {
    usageFilters.startTime = ''
    usageFilters.endTime = ''
    return
  }

  usageFilters.startTime = value[0]
  usageFilters.endTime = value[1]
}

const searchTemplates = async () => {
  templatePagination.page = 1
  await loadTemplates()
}

const searchAssignments = async () => {
  assignmentPagination.page = 1
  await loadAssignments()
}

const searchUsages = async () => {
  usagePagination.page = 1
  await loadUsages()
}

watch(
  () => assignmentForm.quotaUnit,
  () => {
    normalizeAssignmentQuotaFieldsByUnit()
    assignmentForm.quotaWindows = assignmentForm.quotaWindows.map((window) => ({
      ...window,
      quotaUnit: normalizeQuotaUnit(window.quotaUnit),
      quotaLimit:
        window.quotaLimit == null
          ? null
          : normalizeQuotaForUnitSwitch(window.quotaLimit, window.quotaUnit),
    }))
  },
)

watch(
  () => [showAssignmentDialog.value, assignmentForm.batchMode, editingAssignmentId.value] as const,
  ([visible, batchMode, editingId]) => {
    if (!visible || !batchMode || Boolean(editingId)) return
    void loadBatchUserOptions()
  },
)

onMounted(async () => {
  PermissionService.getInstance()
    .ensureLoaded()
    .then(() => {
      Promise.all([loadTemplates()])
      Promise.all([
        loadBillingConfig(),
        loadGroupOptions(),
        loadModelOptions(),
        loadChannelOptions(),
        loadUserOptions(),
        loadTemplateOptions(),
      ])
      initializeActiveTab()
    })
})
</script>

<style scoped>
.monthly-pass-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wrap-gap {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}

.tab-filter-toolbar {
  align-items: flex-start;
}

.filter-field-sm {
  width: 180px;
}

.filter-field-md {
  width: 240px;
}

.filter-field-lg {
  width: 320px;
}

.filter-action-group {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-action-group :deep(.el-button + .el-button) {
  margin-left: 0;
}

.filter-action-group.single-action {
  margin-left: auto;
}

.quota-form-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}

.quota-window-picker {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.quota-window-input {
  width: 120px;
}

.quota-window-unit {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.quota-window-value {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.template-pricing-preview {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.template-pricing-preview__card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
}

.template-pricing-preview__label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.template-pricing-preview__value {
  color: var(--el-text-color-primary);
  font-size: 16px;
  line-height: 1.2;
}

.template-pricing-preview__hint {
  margin-top: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.template-toggle-field {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.template-toggle-field__hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.template-purchase-limit-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.template-purchase-limit-field__row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.template-purchase-limit-field__separator {
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.template-purchase-limit-field__hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.quota-window-editor {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.quota-window-editor__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.quota-window-editor__item {
  display: grid;
  padding: 14px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 14px;
  background: var(--el-fill-color-light);
  box-shadow: 0 1px 2px rgb(0 0 0 / 4%);
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr) minmax(0, 1.8fr) auto;
  gap: 8px;
  align-items: start;
}

.quota-window-editor__header {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.quota-window-editor__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--el-color-primary-light-8);
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.quota-window-editor__title {
  color: var(--el-text-color-primary);
  font-size: 13px;
  font-weight: 600;
}

.quota-window-editor__number,
.quota-window-editor__select {
  width: 100%;
}

.quota-window-editor__number :deep(.el-input-number),
.quota-window-editor__select :deep(.el-select__wrapper) {
  width: 100%;
}

.quota-window-editor__picker {
  min-width: 0;
}

.quota-window-editor__picker :deep(.el-input-number) {
  width: 100%;
}

.quota-window-editor__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.batch-target-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.batch-target-panel__filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 220px) auto;
  gap: 8px;
}

.batch-target-panel__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.batch-selected-users {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.batch-result-alert {
  margin-top: 12px;
}

.quick-time-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quick-time-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.quick-time-input {
  width: 128px;
}

.quick-time-label {
  min-width: 90px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.pager-wrap {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}

.mobile-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.monthly-mobile-card {
  border: 1px solid var(--el-border-color-light);
}

.monthly-mobile-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.monthly-mobile-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  word-break: break-word;
}

.monthly-mobile-tag-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.monthly-mobile-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.monthly-mobile-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.monthly-mobile-field.full {
  grid-column: 1 / -1;
}

.monthly-mobile-field .label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.monthly-mobile-field .value {
  color: var(--el-text-color-primary);
  font-size: 13px;
  word-break: break-word;
}

.monthly-mobile-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

@media (max-width: 768px) {
  .template-pricing-preview {
    grid-template-columns: 1fr;
  }
}

.monthly-mobile-actions :deep(.el-button) {
  width: 100%;
  margin-left: 0 !important;
}

@media (max-width: 768px) {
  .monthly-pass-card {
    margin: 6px;
  }

  .wrap-gap {
    gap: 8px;
  }

  .filter-field-sm,
  .filter-field-md,
  .filter-field-lg {
    width: 100%;
  }

  .filter-action-group {
    margin-left: 0;
    width: 100%;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .quick-time-custom-row .quick-time-input {
    width: 100%;
  }

  .filter-action-group.single-action {
    grid-template-columns: minmax(0, 1fr);
  }

  .filter-action-group :deep(.el-button) {
    width: 100%;
    margin-left: 0 !important;
  }

  .quota-form-row {
    flex-direction: column;
    align-items: stretch;
  }

  .quota-form-row :deep(.el-input-number) {
    width: 100% !important;
  }

  .quota-window-picker {
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .quota-window-input {
    width: 100%;
  }

  .quota-form-row :deep(.el-button) {
    width: auto;
    align-self: flex-end;
  }

  .quick-time-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .quota-window-editor__item,
  .batch-target-panel__filters {
    grid-template-columns: minmax(0, 1fr);
  }

  .quota-window-editor__actions {
    justify-content: flex-start;
  }

  .quick-time-label {
    grid-column: 1 / -1;
    min-width: 0;
  }

  .monthly-mobile-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .monthly-mobile-actions {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
