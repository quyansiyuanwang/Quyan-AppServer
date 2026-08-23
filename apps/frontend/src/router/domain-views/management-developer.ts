import type { Component } from 'vue'

export default import.meta.glob<Component>(
  [
    '../../views/developer/*.vue',
    '../../views/products/{kv,short-link,secret,status,verification,ip-geolocation,push}/*ManagementPage.vue',
    '../../views/products/{kv,short-link,secret,status,verification,ip-geolocation,push}/*ConfigPage.vue',
    '../../views/settings/{OAuthClientReviewManagementView,AuthCenterClientReviewManagementView,TicketReviewManagementView}.vue',
  ],
  { eager: true, import: 'default' },
)
