<template>
  <el-dialog
    v-model="workingDirectoryDialogVisible"
    :title="i18ns.t('remoteTerminal.changeOpenLocation')"
    width="520px"
  >
    <el-form label-position="top">
      <el-form-item :label="i18ns.t('remoteTerminal.openLocation')">
        <el-tree-select
          :key="directoryTreeRenderKey"
          v-model="workingDirectoryDraft"
          class="directory-tree-select"
          :placeholder="i18ns.t('remoteTerminal.openLocationPlaceholder')"
          clearable
          check-strictly
          filterable
          lazy
          :cache-data="directoryTreeCacheData"
          :disabled="!currentSelectedOnlineDeviceId"
          :load="loadRemoteDirectoryTree"
          :props="directoryTreeProps"
        />
      </el-form-item>
      <div class="directory-browser-toolbar">
        <el-button
          :disabled="!currentSelectedOnlineDeviceId || directoryBrowserLoading"
          @click="browseRemoteDirectory(workingDirectoryDraft || undefined)"
        >
          {{ i18ns.t('remoteTerminal.browseCurrentDirectory') }}
        </el-button>
        <el-button
          :disabled="
            !currentSelectedOnlineDeviceId || directoryBrowserLoading || !directoryBrowser.parentPath
          "
          @click="browseRemoteDirectory(directoryBrowser.parentPath)"
        >
          {{ i18ns.t('remoteTerminal.goParentDirectory') }}
        </el-button>
        <el-button
          :disabled="!currentSelectedOnlineDeviceId || directoryBrowserLoading"
          @click="browseRemoteDirectory()"
        >
          {{ i18ns.t('remoteTerminal.browseRootDirectory') }}
        </el-button>
      </div>
      <div class="dialog-hint directory-browser-current">
        {{ i18ns.t('remoteTerminal.currentRemoteDirectory') }}:
        {{ directoryBrowser.currentPath || i18ns.t('remoteTerminal.remoteDirectoryRoot') }}
      </div>
      <div v-if="directoryBrowserLoading" class="directory-browser-empty">
        {{ i18ns.t('remoteTerminal.loadingDirectories') }}
      </div>
      <div class="dialog-hint">{{ i18ns.t('remoteTerminal.openLocationDialogHint') }}</div>
    </el-form>
    <template #footer>
      <el-button @click="workingDirectoryDialogVisible = false">{{ i18ns.t('close') }}</el-button>
      <el-button @click="clearWorkingDirectoryDraft">
        {{ i18ns.t('remoteTerminal.clearOpenLocation') }}
      </el-button>
      <el-button type="primary" @click="saveWorkingDirectoryDraft">
        {{ i18ns.t('remoteTerminal.applyOpenLocation') }}
      </el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="shortcutDialogVisible"
    :title="i18ns.t('remoteTerminal.manageShortcuts')"
    width="720px"
  >
    <div class="shortcut-manager">
      <div class="shortcut-manager-list">
        <div class="shortcut-manager-title">
          {{ i18ns.t('remoteTerminal.customShortcuts') }}
        </div>
        <el-empty
          v-if="customShortcuts.length === 0"
          :description="i18ns.t('remoteTerminal.noCustomShortcuts')"
          :image-size="88"
        />
        <div v-else class="custom-shortcut-list">
          <div v-for="shortcut in customShortcuts" :key="shortcut.id" class="custom-shortcut-row">
            <div class="custom-shortcut-content">
              <div class="custom-shortcut-name">{{ getShortcutDisplayLabel(shortcut) }}</div>
              <div class="custom-shortcut-meta">{{ describeShortcut(shortcut) }}</div>
            </div>
            <div class="custom-shortcut-actions">
              <el-button text @click="openShortcutDialog(shortcut)">
                {{ i18ns.t('remoteTerminal.editShortcut') }}
              </el-button>
              <el-button text type="danger" @click="deleteShortcut(shortcut.id)">
                {{ i18ns.t('remoteTerminal.deleteShortcut') }}
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <div class="shortcut-manager-editor">
        <div class="shortcut-manager-title">
          {{
            shortcutEditMode === 'create'
              ? i18ns.t('remoteTerminal.addShortcut')
              : i18ns.t('remoteTerminal.editShortcut')
          }}
        </div>
        <el-form label-position="top">
          <el-form-item :label="i18ns.t('remoteTerminal.shortcutLabel')">
            <el-input
              v-model="shortcutDraft.label"
              :placeholder="i18ns.t('remoteTerminal.shortcutLabelPlaceholder')"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('remoteTerminal.shortcutType')">
            <el-radio-group v-model="shortcutDraft.kind">
              <el-radio-button label="key">
                {{ i18ns.t('remoteTerminal.shortcutTypeKey') }}
              </el-radio-button>
              <el-radio-button label="sequence">
                {{ i18ns.t('remoteTerminal.shortcutTypeSequence') }}
              </el-radio-button>
            </el-radio-group>
          </el-form-item>
          <template v-if="shortcutDraft.kind === 'key'">
            <el-form-item :label="i18ns.t('remoteTerminal.shortcutKey')">
              <div class="shortcut-key-editor">
                <el-input
                  v-model="shortcutDraft.key"
                  :placeholder="i18ns.t('remoteTerminal.shortcutKeyPlaceholder')"
                />
                <el-button
                  :type="isShortcutCaptureActive ? 'danger' : 'primary'"
                  plain
                  @click="toggleShortcutCapture"
                >
                  {{
                    isShortcutCaptureActive
                      ? i18ns.t('remoteTerminal.stopShortcutCapture')
                      : i18ns.t('remoteTerminal.captureShortcutKey')
                  }}
                </el-button>
              </div>
            </el-form-item>
            <el-form-item :label="i18ns.t('remoteTerminal.shortcutModifiers')">
              <el-checkbox-group v-model="shortcutDraft.modifiers">
                <el-checkbox label="ctrl">Ctrl</el-checkbox>
                <el-checkbox label="alt">Alt</el-checkbox>
                <el-checkbox label="shift">Shift</el-checkbox>
                <el-checkbox label="meta">Meta</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
            <div class="dialog-hint">
              {{
                isShortcutCaptureActive
                  ? i18ns.t('remoteTerminal.shortcutCaptureListeningHint')
                  : i18ns.t('remoteTerminal.shortcutCaptureHint')
              }}
            </div>
          </template>
          <template v-else>
            <el-form-item :label="i18ns.t('remoteTerminal.shortcutSequence')">
              <el-input
                v-model="shortcutDraft.sequenceText"
                type="textarea"
                :rows="4"
                :placeholder="i18ns.t('remoteTerminal.shortcutSequencePlaceholder')"
              />
            </el-form-item>
          </template>
          <div class="dialog-hint">{{ i18ns.t('remoteTerminal.shortcutEditorHint') }}</div>
          <div class="shortcut-editor-actions">
            <el-button @click="resetShortcutDraft">{{ i18ns.t('remoteTerminal.clearShortcutDraft') }}</el-button>
            <el-button type="primary" @click="saveShortcutDraft">
              {{
                shortcutEditMode === 'create'
                  ? i18ns.t('remoteTerminal.addShortcut')
                  : i18ns.t('remoteTerminal.saveShortcut')
              }}
            </el-button>
          </div>
        </el-form>
      </div>
    </div>
  </el-dialog>

  <el-dialog
    v-model="quickCommandDialogVisible"
    :title="i18ns.t('remoteTerminal.manageQuickCommands')"
    :width="isDesktop ? '1145px' : '90%'"
  >
    <div class="shortcut-manager">
      <div class="shortcut-manager-list">
        <div class="shortcut-manager-title">
          {{ i18ns.t('remoteTerminal.quickCommands') }}
        </div>
        <el-empty
          v-if="quickCommands.length === 0"
          :description="i18ns.t('remoteTerminal.noQuickCommands')"
          :image-size="88"
        />
        <div v-else class="custom-shortcut-list">
          <div v-for="command in quickCommands" :key="command.id" class="custom-shortcut-row">
            <div class="custom-shortcut-content">
              <div class="custom-shortcut-name">{{ command.label }}</div>
              <div class="custom-shortcut-meta">{{ command.command }}</div>
            </div>
            <div class="custom-shortcut-actions">
              <el-button text @click="openQuickCommandDialog(command)">
                {{ i18ns.t('remoteTerminal.editQuickCommand') }}
              </el-button>
              <el-button text @click="sendQuickCommand(command)">
                {{ i18ns.t('remoteTerminal.sendQuickCommand') }}
              </el-button>
              <el-button text type="danger" @click="deleteQuickCommand(command.id)">
                {{ i18ns.t('remoteTerminal.deleteQuickCommand') }}
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <div class="shortcut-manager-editor">
        <div class="shortcut-manager-title">
          {{
            quickCommandEditMode === 'create'
              ? i18ns.t('remoteTerminal.addQuickCommand')
              : i18ns.t('remoteTerminal.editQuickCommand')
          }}
        </div>
        <el-form label-position="top">
          <el-form-item :label="i18ns.t('remoteTerminal.quickCommandLabel')">
            <el-input
              v-model="quickCommandDraft.label"
              :placeholder="i18ns.t('remoteTerminal.quickCommandLabelPlaceholder')"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('remoteTerminal.quickCommandContent')">
            <el-input
              v-model="quickCommandDraft.command"
              type="textarea"
              :rows="5"
              :placeholder="i18ns.t('remoteTerminal.quickCommandPlaceholder')"
            />
          </el-form-item>
          <div class="dialog-hint">{{ i18ns.t('remoteTerminal.quickCommandHint') }}</div>
          <div class="shortcut-editor-actions">
            <el-button @click="resetQuickCommandDraft">
              {{ i18ns.t('remoteTerminal.clearQuickCommandDraft') }}
            </el-button>
            <el-button type="primary" @click="saveQuickCommandDraft">
              {{
                quickCommandEditMode === 'create'
                  ? i18ns.t('remoteTerminal.addQuickCommand')
                  : i18ns.t('remoteTerminal.saveQuickCommand')
              }}
            </el-button>
          </div>
        </el-form>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useRemoteTerminalManagementContext } from '../context'

const state = useRemoteTerminalManagementContext()

const {
  browseRemoteDirectory,
  clearWorkingDirectoryDraft,
  currentSelectedOnlineDeviceId,
  customShortcuts,
  deleteQuickCommand,
  deleteShortcut,
  describeShortcut,
  directoryBrowser,
  directoryBrowserLoading,
  directoryTreeCacheData,
  directoryTreeProps,
  directoryTreeRenderKey,
  getShortcutDisplayLabel,
  isDesktop,
  isShortcutCaptureActive,
  loadRemoteDirectoryTree,
  openQuickCommandDialog,
  openShortcutDialog,
  quickCommandDialogVisible,
  quickCommandDraft,
  quickCommandEditMode,
  quickCommands,
  resetQuickCommandDraft,
  resetShortcutDraft,
  saveQuickCommandDraft,
  saveShortcutDraft,
  saveWorkingDirectoryDraft,
  sendQuickCommand,
  shortcutDialogVisible,
  shortcutDraft,
  shortcutEditMode,
  toggleShortcutCapture,
  workingDirectoryDialogVisible,
  workingDirectoryDraft,
} = state
</script>
