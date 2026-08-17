import type { Component } from 'vue'

export default import.meta.glob<Component>(
  '../../views/products/verification/VerificationUserPage.vue',
  { eager: true, import: 'default' },
)
