import type { Component } from 'vue'

export default import.meta.glob<Component>('../../views/chat/**/*.vue', {
  eager: true,
  import: 'default',
})
