import type { Component } from 'vue'

export default import.meta.glob<Component>(
  [
    '../../views/common/404View.vue',
    '../../views/public/**/*.vue',
    '../../views/article/ArticleViewerView.vue',
  ],
  { eager: true, import: 'default' },
)
