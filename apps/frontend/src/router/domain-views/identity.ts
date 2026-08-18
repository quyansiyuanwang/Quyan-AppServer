import type { Component } from 'vue'

export default import.meta.glob<Component>('../../views/auth/**/*.vue', {
  eager: true,
  import: 'default',
})
