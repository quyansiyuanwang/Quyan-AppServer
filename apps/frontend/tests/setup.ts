import { afterEach, vi } from 'vitest'
import { config } from '@vue/test-utils'

const hasDomEnvironment = typeof window !== 'undefined' && typeof document !== 'undefined'

const simpleStub = (name: string) => ({
  name,
  template: `<div><slot /></div>`,
})

const tableColumnStub = {
  name: 'ElTableColumn',
  template: `<div><slot name="default" :row="{}" :$index="0" /></div>`,
}

if (hasDomEnvironment) {
  config.global.stubs = {
    ...(config.global.stubs || {}),
    'el-alert': simpleStub('ElAlert'),
    'el-aside': simpleStub('ElAside'),
    'el-autocomplete': simpleStub('ElAutocomplete'),
    'el-badge': simpleStub('ElBadge'),
    'el-button': simpleStub('ElButton'),
    'el-button-group': simpleStub('ElButtonGroup'),
    'el-card': simpleStub('ElCard'),
    'el-check-tag': simpleStub('ElCheckTag'),
    'el-checkbox': simpleStub('ElCheckbox'),
    'el-checkbox-group': simpleStub('ElCheckboxGroup'),
    'el-col': simpleStub('ElCol'),
    'el-collapse': simpleStub('ElCollapse'),
    'el-collapse-item': simpleStub('ElCollapseItem'),
    'el-collapse-transition': simpleStub('ElCollapseTransition'),
    'el-container': simpleStub('ElContainer'),
    'el-date-picker': simpleStub('ElDatePicker'),
    'el-descriptions': simpleStub('ElDescriptions'),
    'el-descriptions-item': simpleStub('ElDescriptionsItem'),
    'el-dialog': simpleStub('ElDialog'),
    'el-divider': simpleStub('ElDivider'),
    'el-drawer': simpleStub('ElDrawer'),
    'el-dropdown': simpleStub('ElDropdown'),
    'el-dropdown-item': simpleStub('ElDropdownItem'),
    'el-dropdown-menu': simpleStub('ElDropdownMenu'),
    'el-empty': simpleStub('ElEmpty'),
    'el-form': simpleStub('ElForm'),
    'el-form-item': simpleStub('ElFormItem'),
    'el-icon': simpleStub('ElIcon'),
    'el-input': simpleStub('ElInput'),
    'el-input-number': simpleStub('ElInputNumber'),
    'el-input-tag': simpleStub('ElInputTag'),
    'el-link': simpleStub('ElLink'),
    'el-main': simpleStub('ElMain'),
    'el-menu': simpleStub('ElMenu'),
    'el-menu-item': simpleStub('ElMenuItem'),
    'el-option': simpleStub('ElOption'),
    'el-pagination': simpleStub('ElPagination'),
    'el-popover': simpleStub('ElPopover'),
    'el-progress': simpleStub('ElProgress'),
    'el-radio': simpleStub('ElRadio'),
    'el-radio-button': simpleStub('ElRadioButton'),
    'el-radio-group': simpleStub('ElRadioGroup'),
    'el-result': simpleStub('ElResult'),
    'el-row': simpleStub('ElRow'),
    'el-scrollbar': simpleStub('ElScrollbar'),
    'el-segmented': simpleStub('ElSegmented'),
    'el-select': simpleStub('ElSelect'),
    'el-skeleton': simpleStub('ElSkeleton'),
    'el-slider': simpleStub('ElSlider'),
    'el-statistic': simpleStub('ElStatistic'),
    'el-step': simpleStub('ElStep'),
    'el-steps': simpleStub('ElSteps'),
    'el-sub-menu': simpleStub('ElSubMenu'),
    'el-switch': simpleStub('ElSwitch'),
    'el-table': simpleStub('ElTable'),
    'el-table-column': tableColumnStub,
    'el-tab-pane': simpleStub('ElTabPane'),
    'el-tabs': simpleStub('ElTabs'),
    'el-tag': simpleStub('ElTag'),
    'el-text': simpleStub('ElText'),
    'el-time-picker': simpleStub('ElTimePicker'),
    'el-timeline': simpleStub('ElTimeline'),
    'el-timeline-item': simpleStub('ElTimelineItem'),
    'el-tooltip': simpleStub('ElTooltip'),
    'el-transfer': simpleStub('ElTransfer'),
    'el-tree': simpleStub('ElTree'),
    'el-tree-select': simpleStub('ElTreeSelect'),
    'el-watermark': simpleStub('ElWatermark'),
  }

  config.global.directives = {
    ...(config.global.directives || {}),
    loading: () => undefined,
  }

  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  if (hasDomEnvironment) {
    localStorage.clear()
    sessionStorage.clear()
  }
})
