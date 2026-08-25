import type { Component } from 'vue'

export default import.meta.glob<Component>('../../views/relay/**/*.vue', {
  eager: true,
  import: 'default',
})
