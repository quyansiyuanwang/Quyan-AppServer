import type { Component } from 'vue'

export default import.meta.glob<Component>(
  '../../views/relay/{RelayTokenManagementView,ApiDocumentationView,RelayChannelProviderView}.vue',
  { eager: true, import: 'default' },
)
