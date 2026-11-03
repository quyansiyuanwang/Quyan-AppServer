import { createRouter, createWebHistory } from 'vue-router'
import DocsView from '@/views/DocsView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/zh-CN/getting-started' },
    {
      path: '/:locale(en|zh-CN)?/:slug?',
      name: 'docs',
      component: DocsView,
    },
    { path: '/:pathMatch(.*)*', redirect: '/zh-CN/getting-started' },
  ],
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    const target = to.hash ? document.getElementById(to.hash.slice(1)) : null
    if (target) {
      return {
        el: target,
        top: Number.parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0,
      }
    }
    return { top: 0 }
  },
})

export default router
