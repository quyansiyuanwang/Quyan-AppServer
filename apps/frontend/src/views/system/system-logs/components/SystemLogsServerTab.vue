<script setup lang="ts">
import { useSystemLogsContext } from '../context'

const state = useSystemLogsContext()
const i18ns = state.i18ns
const serverLogType = state.serverLogType
const serverLines = state.serverLines
const serverSearch = state.serverSearch
const serverContentLoading = state.serverContentLoading
const serverFilesLoading = state.serverFilesLoading
const serverLogFiles = state.serverLogFiles
const selectedServerLogFileName = state.selectedServerLogFileName
const serverLogContent = state.serverLogContent
</script>

<template>
  <div>
    <div class="server-toolbar filters-container">
      <el-form :inline="true" class="toolbar-row">
        <el-form-item :label="i18ns.t('SystemLogs.serverLogType')">
          <el-select v-model="serverLogType" style="width: 180px" @change="state.handleServerLogTypeChange">
            <el-option :label="i18ns.t('SystemLogs.combinedLog')" value="combined" />
            <el-option :label="i18ns.t('SystemLogs.errorLog')" value="error" />
          </el-select>
        </el-form-item>

        <el-form-item :label="i18ns.t('SystemLogs.latestLines')">
          <el-input-number
            v-model="serverLines"
            :min="1"
            :max="2000"
            :step="50"
            @change="state.handleServerContentParamsChange"
          />
        </el-form-item>

        <el-form-item :label="i18ns.t('SystemLogs.search')">
          <el-input
            v-model="serverSearch"
            clearable
            :placeholder="i18ns.t('SystemLogs.searchPlaceholder')"
            style="width: 260px"
            @keyup.enter="state.loadSelectedServerLogContent"
          />
        </el-form-item>

        <el-form-item>
          <el-button @click="state.loadSelectedServerLogContent" :loading="serverContentLoading">
            {{ i18ns.t('SystemLogs.loadContent') }}
          </el-button>
        </el-form-item>

        <el-form-item>
          <el-button @click="state.loadServerLogFiles" :loading="serverFilesLoading">
            {{ i18ns.t('SystemLogs.refreshFiles') }}
          </el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="server-logs-layout">
      <div class="server-files-panel" v-loading="serverFilesLoading">
        <div class="panel-title-row">
          <span class="panel-title">{{ i18ns.t('SystemLogs.serverLogFiles') }}</span>
          <el-tag size="small" type="info">{{ serverLogFiles.length }}</el-tag>
        </div>

        <div v-if="serverLogFiles.length" class="server-file-list">
          <button
            v-for="file in serverLogFiles"
            :key="file.name"
            type="button"
            class="server-file-item"
            :class="{ active: file.name === selectedServerLogFileName }"
            @click="state.selectServerLogFile(file.name)"
          >
            <div class="server-file-main">
              <span class="server-file-name">{{ file.name }}</span>
              <el-tag size="small" :type="file.type === 'error' ? 'danger' : 'success'">
                {{ file.type === 'error' ? i18ns.t('SystemLogs.errorLog') : i18ns.t('SystemLogs.combinedLog') }}
              </el-tag>
            </div>
            <div class="server-file-meta">
              <span>{{ state.formatTimestamp(file.modifiedTime) }}</span>
              <span>{{ state.formatBytes(file.sizeBytes) }}</span>
            </div>
          </button>
        </div>
        <el-empty v-else :description="i18ns.t('SystemLogs.noServerLogFiles')" />
      </div>

      <div class="server-content-panel" v-loading="serverContentLoading">
        <template v-if="serverLogContent">
          <div class="panel-title-row panel-title-row-wrap">
            <span class="panel-title">{{ i18ns.t('SystemLogs.serverLogContent') }}</span>
            <div class="server-content-tags">
              <el-tag size="small" :type="serverLogContent.file.type === 'error' ? 'danger' : 'success'">
                {{ serverLogContent.file.type === 'error' ? i18ns.t('SystemLogs.errorLog') : i18ns.t('SystemLogs.combinedLog') }}
              </el-tag>
              <el-tag size="small" type="info">{{ state.formatBytes(serverLogContent.file.sizeBytes) }}</el-tag>
              <el-tag v-if="serverLogContent.file.compressed" size="small" type="warning">
                gzip
              </el-tag>
            </div>
          </div>

          <div class="server-content-meta">
            <div>
              <strong>{{ i18ns.t('SystemLogs.fileName') }}:</strong>
              {{ serverLogContent.file.name }}
            </div>
            <div>
              <strong>{{ i18ns.t('SystemLogs.modifiedTime') }}:</strong>
              {{ state.formatTimestamp(serverLogContent.file.modifiedTime) }}
            </div>
            <div>
              <strong>{{ i18ns.t('SystemLogs.totalLines') }}:</strong>
              {{ serverLogContent.totalLineCount }}
            </div>
            <div>
              <strong>{{ i18ns.t('SystemLogs.matchedLines') }}:</strong>
              {{ serverLogContent.matchedLineCount }}
            </div>
            <div>
              <strong>{{ i18ns.t('SystemLogs.returnedLines') }}:</strong>
              {{ serverLogContent.returnedLines }}
            </div>
            <div v-if="serverLogContent.search">
              <strong>{{ i18ns.t('SystemLogs.search') }}:</strong>
              {{ serverLogContent.search }}
            </div>
          </div>

          <el-alert v-if="serverLogContent.truncated" type="info" :closable="false" class="server-log-alert">
            {{ i18ns.t('SystemLogs.truncatedHint') }}
          </el-alert>

          <pre class="server-log-pre">{{ serverLogContent.content || '' }}</pre>
        </template>

        <el-empty
          v-else
          :description="selectedServerLogFileName ? i18ns.t('SystemLogs.noServerLogContent') : i18ns.t('SystemLogs.noServerLogSelected')"
        />
      </div>
    </div>
  </div>
</template>
