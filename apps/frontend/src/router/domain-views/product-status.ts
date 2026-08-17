import type { Component } from 'vue'

export default import.meta.glob<Component>('../../views/products/status/StatusUserPage.vue', {
  eager: true,
  import: 'default',
})
