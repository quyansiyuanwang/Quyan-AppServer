import type { Component } from 'vue'

export default import.meta.glob<Component>(
  '../../views/relay/{RelayChannelReviewView,RelaySettingsView,RelayChannelHealthView,RelayRequestDiagnosticsView,RelayChannelProbeView,UpstreamStatusView}.vue',
  { eager: true, import: 'default' },
)
