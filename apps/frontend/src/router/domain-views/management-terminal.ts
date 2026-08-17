import type { Component } from 'vue'

export default import.meta.glob<Component>(
  '../../views/products/remote-terminal-cloud/{RemoteTerminalProductTemplatesView,RemoteTerminalProductEntitlementsView,RemoteTerminalProductDevicesView}.vue',
  { eager: true, import: 'default' },
)
