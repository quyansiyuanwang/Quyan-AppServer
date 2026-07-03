import { createRouter, createWebHistory } from "vue-router";
import DocsView from "@/views/DocsView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/zh-CN/getting-started" },
    {
      path: "/:locale(en|zh-CN)?/:slug?",
      name: "docs",
      component: DocsView,
    },
    { path: "/:pathMatch(.*)*", redirect: "/zh-CN/getting-started" },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

export default router;
