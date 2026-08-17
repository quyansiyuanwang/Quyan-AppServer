import type { Component } from 'vue'

export default import.meta.glob<Component>('../../views/products/secret/SecretUserPage.vue', {
  eager: true,
  import: 'default',
})
