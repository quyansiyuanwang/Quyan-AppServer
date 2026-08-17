import type { Component } from 'vue'

export default import.meta.glob<Component>('../../views/management/RamManagementView.vue', {
  eager: true,
  import: 'default',
})
