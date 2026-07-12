import '@/assets/main.css'
import '@/assets/tailwind.css'

import { ensureElementPlusDarkTheme, isDarkThemeActive } from '@/utils/elementPlusTheme'

export { bootstrapApp as bootstrap } from '@/bootstrap'
import { bootstrapApp } from '@/bootstrap'

if (import.meta.env.MODE !== 'test') {
  const startApp = async () => {
    if (isDarkThemeActive()) {
      void ensureElementPlusDarkTheme()
    }

    await bootstrapApp()
  }

  void startApp()
}
