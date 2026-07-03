import type { RouteRecordRaw } from 'vue-router'

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
  },
  {
    path: '/about',
    name: 'about',
    component: () => import('@/views/AboutView.vue'),
  },
  {
    path: '/faq',
    name: 'faq',
    component: () => import('@/views/FaqView.vue'),
  },
  {
    path: '/updates',
    name: 'updates',
    component: () => import('@/views/UpdatesView.vue'),
  },
  {
    path: '/learning/resources',
    name: 'learning-resources',
    component: () => import('@/views/LearningResourcesView.vue'),
  },
  {
    path: '/games/guide',
    name: 'games-guide',
    component: () => import('@/views/GamesGuideView.vue'),
  },
  {
    path: '/learning',
    name: 'learning-hub',
    component: () => import('@/views/LearningHubView.vue'),
  },
  {
    path: '/learning/vocabulary',
    name: 'vocabulary',
    component: () => import('@/views/VocabularyView.vue'),
  },
  {
    path: '/games',
    name: 'games-hub',
    component: () => import('@/views/GamesHubView.vue'),
  },
  {
    path: '/games/reaction',
    name: 'game-reaction',
    component: () => import('@/views/ReactionGameView.vue'),
  },
  {
    path: '/games/number-guess',
    name: 'game-number-guess',
    component: () => import('@/views/NumberGuessGameView.vue'),
  },
  {
    path: '/games/memory',
    name: 'game-memory',
    component: () => import('@/views/MemoryGameView.vue'),
  },
  {
    path: '/games/pop-blast',
    name: 'game-pop-blast',
    component: () => import('@/views/PopBlastGameView.vue'),
  },
  {
    path: '/games/2048',
    name: 'game-2048',
    component: () => import('@/views/Game2048View.vue'),
  },
  {
    path: '/games/snake',
    name: 'game-snake',
    component: () => import('@/views/SnakeGameView.vue'),
  },
  {
    path: '/games/minesweeper',
    name: 'game-minesweeper',
    component: () => import('@/views/MinesweeperGameView.vue'),
  },
  {
    path: '/games/tetris',
    name: 'game-tetris',
    component: () => import('@/views/TetrisGameView.vue'),
  },
  {
    path: '/games/puzzle',
    name: 'game-puzzle',
    component: () => import('@/views/PuzzleGameView.vue'),
  },
  {
    path: '/games/memory-number',
    name: 'game-memory-number',
    component: () => import('@/views/MemoryNumberGameView.vue'),
  },
  {
    path: '/games/sequence',
    name: 'game-sequence',
    component: () => import('@/views/SequenceGameView.vue'),
  },
  {
    path: '/games/aim-train',
    name: 'game-aim-train',
    component: () => import('@/views/AimTrainGameView.vue'),
  },
  {
    path: '/games/shooting',
    name: 'game-shooting',
    component: () => import('@/views/ShootingGameView.vue'),
  },
  {
    path: '/vocabulary',
    redirect: '/learning/vocabulary',
  },
  {
    path: '/exam',
    redirect: '/learning/vocabulary',
  },
  {
    path: '/game/memory',
    redirect: '/games/memory',
  },
  {
    path: '/onboarding',
    name: 'onboarding',
    component: () => import('@/views/OnboardingView.vue'),
  },
  {
    path: '/explore',
    name: 'explore',
    component: () => import('@/views/ExploreView.vue'),
  },
  {
    path: '/feedback',
    name: 'feedback',
    component: () => import('@/views/FeedbackView.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
  },
]
