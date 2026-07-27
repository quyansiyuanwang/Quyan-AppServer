<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="not-found-container">
      <div class="not-found-content">
        <div class="error-code">
          <span class="digit">4</span>
          <span class="digit">0</span>
          <span class="digit">4</span>
        </div>

        <h1 class="error-title">{{ i18ns.t('notFound.title') }}</h1>
        <p class="error-description">{{ i18ns.t('notFound.description') }}</p>

        <div class="error-actions">
          <el-button type="primary" size="large" @click="goHome" class="home-button">
            <el-icon class="el-icon--left">
              <House />
            </el-icon>
            {{ i18ns.t('notFound.goHome') }}
          </el-button>

          <el-button size="large" @click="goBack" class="back-button">
            <el-icon class="el-icon--left">
              <ArrowLeft />
            </el-icon>
            {{ i18ns.t('notFound.goBack') }}
          </el-button>
        </div>

        <div class="floating-elements">
          <div class="floating-element" v-for="i in 6" :key="i"></div>
        </div>

        <section v-if="showAprilMiniGame" class="april-mini-game">
          <h3>{{ i18ns.t('notFound.miniGameTitle') }}</h3>
          <p>{{ i18ns.t('notFound.miniGameDescription') }}</p>
          <div class="mini-game-stage" @click="handleStageClick">
            <span class="target" :style="targetStyle"></span>
            <span class="score">{{ score }} {{ i18ns.t('notFound.scoreUnit') }}</span>
            <span class="timer">{{ leftSeconds }} {{ i18ns.t('notFound.secondUnit') }}</span>
          </div>
        </section>
      </div>
    </div>
  </div>
  <div v-else class="mobile-page mobile-adapter">
    <div class="not-found-container">
      <div class="not-found-content">
        <div class="error-code">
          <span class="digit">4</span>
          <span class="digit">0</span>
          <span class="digit">4</span>
        </div>

        <h1 class="error-title">{{ i18ns.t('notFound.title') }}</h1>
        <p class="error-description">{{ i18ns.t('notFound.description') }}</p>

        <div class="error-actions">
          <el-button type="primary" size="large" @click="goHome" class="home-button">
            <el-icon class="el-icon--left">
              <House />
            </el-icon>
            {{ i18ns.t('notFound.goHome') }}
          </el-button>

          <el-button size="large" @click="goBack" class="back-button">
            <el-icon class="el-icon--left">
              <ArrowLeft />
            </el-icon>
            {{ i18ns.t('notFound.goBack') }}
          </el-button>
        </div>

        <div class="floating-elements">
          <div class="floating-element" v-for="i in 6" :key="i"></div>
        </div>

        <section v-if="showAprilMiniGame" class="april-mini-game">
          <h3>{{ i18ns.t('notFound.miniGameTitle') }}</h3>
          <p>{{ i18ns.t('notFound.miniGameDescription') }}</p>
          <div class="mini-game-stage" @click="handleStageClick">
            <span class="target" :style="targetStyle"></span>
            <span class="score">{{ score }} {{ i18ns.t('notFound.scoreUnit') }}</span>
            <span class="timer">{{ leftSeconds }} {{ i18ns.t('notFound.secondUnit') }}</span>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { i18ns } from '@/locales'
import { router } from '@/router'
import { AprilFoolsService } from '@/service/aprilFoolsService'
import { House, ArrowLeft } from '@element-plus/icons-vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import StorageKey from '@/constant/storagekey'

const APRIL_PREVIEW_MODE_KEY = StorageKey.Easter.PREVIEW_MODE

const goHome = () => {
  router.push({ name: 'home' })
}

const goBack = () => {
  router.back()
}

const score = ref(0)
const leftSeconds = ref(15)
const targetX = ref(25)
const targetY = ref(30)
let timer: number | undefined

const showAprilMiniGame = computed(() => {
  const preview = TypedLocalStorage.get(APRIL_PREVIEW_MODE_KEY) === '1'
  const now = new Date()
  return preview || (now.getMonth() === 3 && now.getDate() === 1)
})

const targetStyle = computed(() => ({
  left: `${targetX.value}%`,
  top: `${targetY.value}%`,
}))

const moveTarget = () => {
  targetX.value = 8 + Math.round(Math.random() * 80)
  targetY.value = 12 + Math.round(Math.random() * 72)
}

const handleStageClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (!target.classList.contains('target')) return
  score.value += 1
  moveTarget()
  if (score.value === 10) {
    ElMessage.success(i18ns.t('notFound.unlockSuccess'))
    AprilFoolsService.triggerEgg({ id: 22, force: true })
    AprilFoolsService.openPanel()
  }
}

onMounted(() => {
  if (!showAprilMiniGame.value) return
  timer = window.setInterval(() => {
    leftSeconds.value -= 1
    moveTarget()
    if (leftSeconds.value <= 0) {
      window.clearInterval(timer)
      const message =
        score.value >= 10 ? i18ns.t('notFound.gameWin') : i18ns.t('notFound.gameRetry')
      ElMessage.info(i18ns.t('notFound.gameFinished', { message }))
    }
  }, 1000)
})

onBeforeUnmount(() => {
  window.clearInterval(timer)
})

const { isDesktop } = usePageDevice()
</script>

<style scoped>
.not-found-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    135deg,
    var(--color-background) 0%,
    var(--color-background-soft) 100%
  );
  position: relative;
  overflow: hidden;
}

.not-found-content {
  text-align: center;
  z-index: 2;
  position: relative;
  padding: 2rem;
}

.error-code {
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 2rem;
  gap: 0.5rem;
}

.digit {
  font-size: 8rem;
  font-weight: 700;
  background: linear-gradient(45deg, #3e5cd6 0%, #67a8f3 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  display: inline-block;
  animation: float 3s ease-in-out infinite;
  text-shadow: 0 0 30px rgba(62, 92, 214, 0.3);
}

.digit:nth-child(2) {
  animation-delay: 0.2s;
}

.digit:nth-child(3) {
  animation-delay: 0.4s;
}

.error-title {
  font-size: 2.5rem;
  font-weight: 600;
  color: var(--color-heading);
  margin-bottom: 1rem;
  animation: fadeInUp 0.8s ease-out;
}

.error-description {
  font-size: 1.2rem;
  color: var(--color-text);
  margin-bottom: 3rem;
  max-width: 500px;
  margin-left: auto;
  margin-right: auto;
  animation: fadeInUp 0.8s ease-out 0.2s both;
  line-height: 1.6;
}

.error-actions {
  display: flex;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
  animation: fadeInUp 0.8s ease-out 0.4s both;
}

.home-button {
  background: linear-gradient(45deg, #3e5cd6 0%, #67a8f3 100%);
  border: none;
  color: white;
  font-weight: 500;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(62, 92, 214, 0.3);
}

.home-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(62, 92, 214, 0.4);
}

.back-button {
  background: var(--surface-card-bg);
  border: 1px solid var(--surface-card-border);
  color: var(--color-text);
  font-weight: 500;
  transition: all 0.3s ease;
}

.back-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
}

.floating-elements {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}

.floating-element {
  position: absolute;
  width: 4px;
  height: 4px;
  background: linear-gradient(45deg, #3e5cd6 0%, #67a8f3 100%);
  border-radius: 50%;
  animation: floatElement 6s ease-in-out infinite;
  opacity: 0.6;
}

.floating-element:nth-child(1) {
  top: 20%;
  left: 10%;
  animation-delay: 0s;
}

.floating-element:nth-child(2) {
  top: 60%;
  left: 20%;
  animation-delay: 1s;
}

.floating-element:nth-child(3) {
  top: 80%;
  left: 70%;
  animation-delay: 2s;
}

.floating-element:nth-child(4) {
  top: 40%;
  left: 80%;
  animation-delay: 3s;
}

.floating-element:nth-child(5) {
  top: 10%;
  left: 50%;
  animation-delay: 4s;
}

.floating-element:nth-child(6) {
  top: 90%;
  left: 30%;
  animation-delay: 5s;
}

.april-mini-game {
  margin-top: 28px;
  padding: 16px;
  border-radius: 14px;
  border: 1px solid rgba(62, 92, 214, 0.25);
  background: rgba(62, 92, 214, 0.08);
}

.april-mini-game h3 {
  margin-bottom: 6px;
  font-size: 18px;
  font-weight: 700;
}

.mini-game-stage {
  margin-top: 10px;
  width: min(520px, 92vw);
  height: 180px;
  border-radius: 10px;
  border: 1px dashed rgba(15, 23, 42, 0.25);
  position: relative;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.58);
}

.target {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: linear-gradient(145deg, #ff7a18, #ffd166);
  box-shadow: 0 8px 16px rgba(255, 122, 24, 0.35);
  position: absolute;
  transform: translate(-50%, -50%);
  cursor: pointer;
}

.score,
.timer {
  position: absolute;
  top: 8px;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  background: rgba(15, 23, 42, 0.08);
}

.score {
  left: 8px;
}

.timer {
  right: 8px;
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-10px);
  }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes floatElement {
  0%,
  100% {
    transform: translateY(0px) rotate(0deg);
    opacity: 0.6;
  }
  50% {
    transform: translateY(-20px) rotate(180deg);
    opacity: 1;
  }
}

@media (max-width: 768px) {
  .digit {
    font-size: 6rem;
  }

  .error-title {
    font-size: 2rem;
  }

  .error-description {
    font-size: 1.1rem;
    padding: 0 1rem;
  }

  .error-actions {
    flex-direction: column;
    align-items: center;
  }

  .home-button,
  .back-button {
    width: 200px;
  }
}

@media (max-width: 480px) {
  .digit {
    font-size: 4rem;
  }

  .error-title {
    font-size: 1.5rem;
  }

  .error-description {
    font-size: 1rem;
  }
}
</style>

<style scoped>
.mobile-adapter {
  padding: 8px 6px 16px;
}

.mobile-adapter :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.mobile-adapter :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}
</style>
