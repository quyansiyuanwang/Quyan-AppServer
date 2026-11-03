// @vitest-environment jsdom
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProbeAccountEditor } from '@/views/relay/relay-channel-probe/useProbeAccountEditor'

const { getEditor, update, create, notice } = vi.hoisted(() => ({
  getEditor: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  notice: vi.fn(),
}))
vi.mock('@/service/relayChannelProbeService', () => ({
  relayChannelProbeService: {
    getAccountEditor: getEditor,
    updateAccount: update,
    createAccount: create,
  },
}))
vi.mock('@/utils/requestErrorNotice', () => ({ showRequestErrorNotice: notice }))
vi.mock('@/utils/elementPlusRuntime', () => ({ ElMessage: { success: vi.fn() } }))
const fixture = () => ({
  account: {
    id: 'fixture',
    name: 'Panel',
    tokenPath: 'data.token',
    fallbackTtlSeconds: 1800,
    minLoginIntervalSeconds: 300,
  },
  revision: 'a'.repeat(64),
  loginWorkflow: {
    method: 'POST',
    url: '',
    body: { username: '{{username}}', password: '{{password}}' },
  },
  retainedFields: [['url']],
  credentialNames: ['username', 'password'],
  requiredCredentialNames: ['username', 'password'],
})
function setup() {
  let editor!: ReturnType<typeof useProbeAccountEditor>
  const saved = vi.fn(async () => {})
  const wrapper = mount(
    defineComponent({
      setup() {
        editor = useProbeAccountEditor(saved)
        return () => null
      },
    }),
  )
  return { editor, saved, wrapper }
}
beforeEach(() => {
  vi.clearAllMocks()
  getEditor.mockResolvedValue(fixture())
})
describe('probe account editor', () => {
  it('configures modern New API login and scoped refresh without model invocation keys', async () => {
    const { editor, wrapper } = setup()
    editor.create()
    editor.applyNewApiPreset()
    editor.panelOrigin.value = 'https://panel.example.com'
    await flushPromises()
    expect(editor.form.url).toBe('https://panel.example.com/api/user/login')
    expect(editor.form.refreshUrl).toBe('https://panel.example.com/api/user/auth/refresh')
    expect(editor.form.refreshHeaders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'Cookie', value: '{{account.refreshCookie}}' }),
      ]),
    )
    expect(editor.credentialNames.value).toEqual(['password', 'username'])
    expect(editor.form.sessionFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'cookie', selector: 'new_api_refresh' }),
      ]),
    )
    wrapper.unmount()
  })
  it('retains saved request fields and changes only the entered credential', async () => {
    const { editor, saved, wrapper } = setup()
    await editor.edit('fixture')
    expect(editor.credentialNames.value).toEqual(['password', 'username'])
    editor.credentials.password = 'fixture-replacement'
    await editor.save()
    expect(update).toHaveBeenCalledWith(
      'fixture',
      expect.objectContaining({
        expectedRevision: 'a'.repeat(64),
        retainedFields: [['url']],
        credentialUpdates: { password: 'fixture-replacement' },
      }),
    )
    expect(saved).toHaveBeenCalledOnce()
    expect(editor.credentials).toEqual({})
    wrapper.unmount()
  })
  it('does not retain a field after it has been replaced', async () => {
    const { editor, wrapper } = setup()
    await editor.edit('fixture')
    editor.form.url = 'https://panel.example.com/login'
    await editor.save()
    expect(update.mock.calls[0]?.[1].retainedFields).toEqual([])
    wrapper.unmount()
  })
  it('rejects missing new credential values before saving', async () => {
    const { editor, wrapper } = setup()
    editor.create()
    editor.applyPasswordPreset()
    await editor.save()
    expect(create).not.toHaveBeenCalled()
    expect(notice).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
  it('ignores a late editor response after opening a new account', async () => {
    let resolve!: (value: ReturnType<typeof fixture>) => void
    getEditor.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const { editor, wrapper } = setup()
    const pending = editor.edit('old')
    editor.create()
    editor.form.name = 'New account'
    resolve(fixture())
    await pending
    expect(editor.form.name).toBe('New account')
    expect(editor.editingId.value).toBeUndefined()
    wrapper.unmount()
  })
  it('keeps user input after a version conflict and does not report success', async () => {
    const { editor, saved, wrapper } = setup()
    await editor.edit('fixture')
    update.mockRejectedValueOnce(new Error('fixture conflict'))
    editor.credentials.password = 'fixture-replacement'
    await editor.save()
    await flushPromises()
    expect(editor.open.value).toBe(true)
    expect(editor.credentials.password).toBe('fixture-replacement')
    expect(saved).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
