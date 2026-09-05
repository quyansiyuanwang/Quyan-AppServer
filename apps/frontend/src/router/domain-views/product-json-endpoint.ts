import type { Component } from 'vue'

export default import.meta.glob<Component>(
  '../../views/products/json-endpoints/{JsonEndpointUserPage,JsonEndpointManagementPage,JsonEndpointConfigPage}.vue',
  { eager: true, import: 'default' },
)
