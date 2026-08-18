import type { Component } from 'vue'

export default import.meta.glob<Component>(
  [
    '../../views/settings/{ProfileSettingsView,PreferencesSettingsView,AccountSecuritySettingsView,NotificationSettingsView}.vue',
    '../../views/relay/{BalanceHistoryView,ConsumptionRecordsView,MyMonthlyPassesView}.vue',
    '../../views/{user-script,workspace}/**/*.vue',
  ],
  { eager: true, import: 'default' },
)
