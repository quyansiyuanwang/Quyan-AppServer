import { afterEach, vi } from 'vitest'
import { config } from '@vue/test-utils'

const simpleStub = (name: string) => ({
  name,
  template: `<div><slot /></div>`,
})

const tableColumnStub = {
  name: 'ElTableColumn',
  template: `<div><slot name="default" :row="{}" :$index="0" /></div>`,
}

config.global.stubs = {
  ...(config.global.stubs || {}),
  'el-alert': simpleStub('ElAlert'),
  'el-button': simpleStub('ElButton'),
  'el-card': simpleStub('ElCard'),
  'el-checkbox': simpleStub('ElCheckbox'),
  'el-collapse': simpleStub('ElCollapse'),
  'el-collapse-item': simpleStub('ElCollapseItem'),
  'el-dialog': simpleStub('ElDialog'),
  'el-divider': simpleStub('ElDivider'),
  'el-empty': simpleStub('ElEmpty'),
  'el-form': simpleStub('ElForm'),
  'el-form-item': simpleStub('ElFormItem'),
  'el-input': simpleStub('ElInput'),
  'el-input-number': simpleStub('ElInputNumber'),
  'el-option': simpleStub('ElOption'),
  'el-radio-button': simpleStub('ElRadioButton'),
  'el-radio-group': simpleStub('ElRadioGroup'),
  'el-select': simpleStub('ElSelect'),
  'el-skeleton': simpleStub('ElSkeleton'),
  'el-switch': simpleStub('ElSwitch'),
  'el-table': simpleStub('ElTable'),
  'el-table-column': tableColumnStub,
  'el-tab-pane': simpleStub('ElTabPane'),
  'el-tabs': simpleStub('ElTabs'),
  'el-tag': simpleStub('ElTag'),
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

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})
