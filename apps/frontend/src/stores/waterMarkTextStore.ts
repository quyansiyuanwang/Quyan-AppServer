import { i18ns } from '@/locales'
import { defineStore } from 'pinia'
import { ref, computed, type Ref } from 'vue'
import { i18nEventBus } from './globalInstance'

export const useWaterMarkTextStore = defineStore('waterMarkText', () => {
  const _textRefs: Ref<Ref<string>[]> = ref([])
  const _defaultRefs: Ref<Ref<string>[]> = ref([])

  const defaultIsAuto = ref(true)
  const manualOverride = ref(false)

  const text = computed(() => _textRefs.value.map((r) => r.value))

  const toRefsArray = (input?: string | string[] | Ref<string> | Ref<string>[]): Ref<string>[] => {
    if (!input) return []
    if (Array.isArray(input)) {
      return input.map((item) => (typeof item === 'string' ? ref(item) : item))
    }
    return typeof input === 'string' ? [ref(input)] : [input]
  }

  const isEmptyInput = (input?: string | string[] | Ref<string> | Ref<string>[]) => {
    if (!input) return true
    if (Array.isArray(input)) {
      return (
        input.length === 0 ||
        input.every((t) => (typeof t === 'string' ? t === '' : t.value === ''))
      )
    }
    return typeof input === 'string' ? input === '' : input.value === ''
  }

  const initAutoDefault = () => {
    _defaultRefs.value = [
      ref('AppSystem'),
      i18ns.tref('waterMark.internetError'),
      i18ns.tref('waterMark.dataMayBeUnreliable'),
    ]
    defaultIsAuto.value = true
  }

  initAutoDefault()
  _textRefs.value = _defaultRefs.value.slice()

  const setText = (newText?: string | string[] | Ref<string> | Ref<string>[]) => {
    if (!newText || isEmptyInput(newText)) {
      _textRefs.value = _defaultRefs.value.slice()
      manualOverride.value = false
      return
    }

    _textRefs.value = toRefsArray(newText)
    manualOverride.value = true
  }

  const reloadText = () => {
    if (defaultIsAuto.value) {
      _defaultRefs.value = [
        ref('AppSystem'),
        i18ns.tref('waterMark.internetError'),
        i18ns.tref('waterMark.dataMayBeUnreliable'),
      ]
      if (!manualOverride.value) _textRefs.value = _defaultRefs.value.slice()
    }
  }

  const setTemplateUserName = (name?: string) => {
    setText(name ? ['AppSystem', `${name}`] : undefined)
  }

  const setDefaultText = (default_text?: string | string[] | Ref<string> | Ref<string>[]) => {
    if (default_text && !isEmptyInput(default_text)) {
      _defaultRefs.value = toRefsArray(default_text)
      defaultIsAuto.value = false
    } else {
      initAutoDefault()
    }
    if (!manualOverride.value) _textRefs.value = _defaultRefs.value.slice()
  }

  const clearText = () => {
    manualOverride.value = false
    _textRefs.value = _defaultRefs.value.slice()
  }

  i18nEventBus.on(
    'LOCALE_CHANGED',
    () => {
      reloadText()
    },
    false,
  )

  const useText = () => text

  return { useText, setTemplateUserName, setText, setDefaultText, clearText, reloadText }
})
