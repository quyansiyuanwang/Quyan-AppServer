import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useToggle } from '@vueuse/shared'
import { useColorMode, usePreferredDark } from '@vueuse/core'
import localStorageKeys from '@/constant/storagekey'
import { ensureElementPlusDarkTheme } from '@/utils/elementPlusTheme'
import { getSharedPreference, setSharedPreference } from '@/utils/sharedPreferences'

const normalizeColorMode = (value: string | null): 'auto' | 'dark' | 'light' => {
  return value === 'dark' || value === 'light' || value === 'auto' ? value : 'auto'
}

export const useThemeToggleStore = defineStore('themeToggle', () => {
  const preferredDark = usePreferredDark()

  const colorMode = useColorMode({
    selector: 'html',
    attribute: 'data-theme',
    storageKey: localStorageKeys.Theme.THEME_TOGGLE_IS_DARK,
    initialValue: normalizeColorMode(
      getSharedPreference('theme', localStorageKeys.Theme.THEME_TOGGLE_IS_DARK),
    ),
    emitAuto: true,
    onChanged: (mode, defaultHandler) => {
      defaultHandler(mode)
      setSharedPreference('theme', mode, localStorageKeys.Theme.THEME_TOGGLE_IS_DARK)
      const resolvedDark = mode === 'auto' ? preferredDark.value : mode === 'dark'

      if (resolvedDark) {
        void ensureElementPlusDarkTheme()
      }

      document.documentElement.classList.toggle('dark', resolvedDark)
      document.documentElement.style.colorScheme = resolvedDark ? 'dark' : 'light'
    },
  })

  const isDark = computed({
    get: () => (colorMode.value === 'auto' ? preferredDark.value : colorMode.value === 'dark'),
    set: (value: boolean) => {
      colorMode.value = value ? 'dark' : 'light'
    },
  })

  /**
   * 获取当前主题: true: 深色主题; false: 浅色主题
   */
  const useIsDark = () => isDark

  /**
   * 切换主题
   */
  const toggleTheme = useToggle(isDark)

  const setAutoTheme = () => {
    colorMode.value = 'auto'
  }

  return { useIsDark, toggleTheme, setAutoTheme, colorMode }
})
