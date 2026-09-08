import type { Component } from 'vue'

export default import.meta.glob<Component>(
  [
    '../../views/management/{UserManagementView,GroupManagementView,PermissionManagementView,LegalPolicyManagementView}.vue',
    '../../views/system/**/*.vue',
    '../../views/analytics/**/*.vue',
    '../../views/relay/{BalanceManagementView,MonthlyPassManagementView,RedemptionCodeManagementView}.vue',
    '../../views/{debug,json-endpoint,article}/**/*.vue',
  ],
  { eager: true, import: 'default' },
)
