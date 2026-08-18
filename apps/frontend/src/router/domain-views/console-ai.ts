import type { Component } from 'vue'

export default import.meta.glob<Component>(
  [
    '../../views/relay/RelayTokenManagementView.vue',
    '../../views/relay/ApiDocumentationView.vue',
    '../../views/relay/RelayChannelProviderView.vue',
  ],
  { eager: true, import: 'default' },
)
