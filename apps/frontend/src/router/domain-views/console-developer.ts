import type { Component } from 'vue'

export default import.meta.glob<Component>(
  [
    '../../views/developer/**/*.vue',
    '../../views/settings/{OAuthClientManagementView,AuthCenterClientManagementView}.vue',
  ],
  { eager: true, import: 'default' },
)
