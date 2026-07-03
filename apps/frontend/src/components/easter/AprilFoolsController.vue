<template>
  <div v-if="isShellVisible" class="april-shell">
    <button class="april-close-btn" type="button" @click="toggleAprilEffectsForToday">
      {{ userDismissedToday ? '开启愚人效果' : '关闭愚人效果' }}
    </button>

    <template v-if="showDebugConsole">
      <button
        class="april-toggle"
        type="button"
        :aria-expanded="showPanel"
        @click="showPanel = !showPanel"
        title="愚人节控制台"
      >
        4/1
      </button>

      <transition name="april-fade">
        <section v-if="showPanel" class="april-panel surface-card">
          <header class="april-panel-header">
            <h3>愚人节控制台</h3>
            <span class="mode-tag">{{ isAprDay ? '正式模式' : '预览模式' }}</span>
          </header>

          <div class="april-panel-actions">
            <el-button size="small" type="success" plain @click="toggleFeatureSwitch">
              {{ featureSwitch ? '关闭本地总开关' : '开启本地总开关' }}
            </el-button>
            <el-button size="small" @click="toggleMasterDisabled">
              {{ masterDisabled ? '开启今日彩蛋' : '关闭今日彩蛋' }}
            </el-button>
            <el-button size="small" type="primary" plain @click="runAutoSequence">
              一键演示
            </el-button>
          </div>

          <p class="april-panel-tip">
            触发框架已接入：日期开关、用户关闭记忆、手动触发与单项冷却都已启用。
          </p>

          <div class="mode-controls">
            <span class="mode-label">彩蛋强度</span>
            <el-radio-group v-model="runMode" size="small" @change="onRunModeChange">
              <el-radio-button label="light">轻量</el-radio-button>
              <el-radio-button label="medium">中等</el-radio-button>
              <el-radio-button label="intense">激进</el-radio-button>
            </el-radio-group>
          </div>

          <p class="april-panel-tip">
            被动触发器：每秒轮询 1 次，当前概率
            <span class="passive-prob">{{ passiveSummary }}</span>
          </p>

          <div class="passive-config surface-card">
            <div class="passive-config-header">
              <strong>被动概率调参</strong>
              <el-button size="small" text @click="resetPassiveProbabilities">恢复默认</el-button>
            </div>
            <div class="passive-row" v-for="item in passiveEggs" :key="item.id">
              <span class="passive-title">{{ item.id }}. {{ eggTitleMap[item.id] }}</span>
              <el-slider
                v-model="item.probabilityPerSecond"
                :min="0"
                :max="0.2"
                :step="0.005"
                @change="persistPassiveConfig"
              />
              <span class="passive-value">{{ (item.probabilityPerSecond * 100).toFixed(1) }}%</span>
            </div>
          </div>

          <div class="april-eggs">
            <button
              v-for="egg in visibleEggs"
              :key="egg.id"
              class="egg-item"
              type="button"
              @click="triggerEgg(egg.id)"
            >
              <span class="egg-id">{{ egg.id }}.</span>
              <span class="egg-title">{{ egg.title }}</span>
            </button>
          </div>
        </section>
      </transition>
    </template>

    <transition name="april-fade">
      <div v-if="showShutter" class="april-shutter" />
    </transition>

    <div v-if="showQuestDots" class="quest-dots">
      <button
        v-for="dot in 3"
        :key="dot"
        type="button"
        class="quest-dot"
        @click="handleQuestDot"
        :style="{ left: `${12 + dot * 22}%`, top: `${18 + (dot % 2) * 22}%` }"
      />
    </div>

    <div v-if="emojiDrops.length" class="emoji-rain">
      <span
        v-for="drop in emojiDrops"
        :key="drop.id"
        class="emoji-drop"
        :style="{ left: `${drop.left}%`, animationDuration: `${drop.duration}ms` }"
      >
        {{ drop.emoji }}
      </span>
    </div>

    <div v-if="mouseTrails.length" class="trail-layer" aria-hidden="true">
      <span
        v-for="trail in mouseTrails"
        :key="trail.id"
        class="trail-dot"
        :style="{ left: `${trail.x}px`, top: `${trail.y}px`, background: trail.color }"
      />
    </div>

    <button v-if="showVoiceButton" class="voice-button" type="button" @click="runVoiceAnnouncement">
      老板声线播报
    </button>

    <button
      v-if="showVacationButton"
      class="vacation-button"
      type="button"
      @click="runVacationRequest"
    >
      求放假按钮
    </button>

    <div v-if="npcVisible" class="npc-bubble">
      {{ npcLine }}
    </div>

    <div v-if="showMoodBar" class="mood-bar">
      <span>AI 心情：摸鱼中</span>
      <strong>{{ aiMood }}%</strong>
    </div>

    <div v-if="showClock" class="fast-clock">{{ acceleratedClock }}</div>

    <div v-if="showFakeProgress" class="fake-progress-wrap">
      <div class="fake-progress-label">{{ fakeProgressLabel }}</div>
      <div class="fake-progress-track">
        <div class="fake-progress-bar" :style="{ width: `${fakeProgress}%` }" />
      </div>
      <div class="fake-progress-value">{{ fakeProgress.toFixed(0) }}%</div>
    </div>

    <el-dialog v-model="drawDialogVisible" width="420" title="今日手气抽卡">
      <p class="draw-result">{{ drawResult }}</p>
      <template #footer>
        <el-button type="primary" @click="drawDialogVisible = false">收下好运</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="couponDialogVisible" width="420" title="彩蛋解锁成功">
      <p>你解锁了隐藏福利码：APRIL-FOOL-2026</p>
      <template #footer>
        <el-button type="primary" @click="couponDialogVisible = false">知道了</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { aprilFoolsEventBus } from '@/stores/globalInstance'

type EggId =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 27
  | 28
  | 29
  | 30
  | 31
  | 32
  | 33
  | 34
  | 35
  | 36
  | 37
  | 38
  | 39
  | 40
  | 41
  | 42
  | 43
  | 44
  | 45

type EggDefinition = {
  id: EggId
  title: string
  cooldownMs?: number
}

type PassiveEggConfig = {
  id: EggId
  probabilityPerSecond: number
}

type AprilRunMode = 'light' | 'medium' | 'intense'

type EmojiDrop = {
  id: number
  left: number
  duration: number
  emoji: string
}

type TrailPoint = {
  id: number
  x: number
  y: number
  color: string
}

const LS = {
  featureSwitch: 'AprilFools-feature-switch',
  previewMode: 'AprilFools-preview-mode',
  masterDisabled: 'AprilFools-master-disabled-2026',
  userDismissByDay: 'AprilFools-user-dismiss-day',
  triggeredByDay: 'AprilFools-triggered-by-day',
  runMode: 'AprilFools-run-mode',
  passiveConfigPrefix: 'AprilFools-passive-config',
} as const

const route = useRoute()
const showPanel = ref(false)
const showShutter = ref(false)
const showQuestDots = ref(false)
const questProgress = ref(0)
const showVoiceButton = ref(false)
const showVacationButton = ref(false)
const showMoodBar = ref(false)
const showClock = ref(false)
const npcVisible = ref(false)
const npcLine = ref('')
const aiMood = ref(87)
const acceleratedClock = ref('')
const drawDialogVisible = ref(false)
const drawResult = ref('')
const couponDialogVisible = ref(false)
const showFakeProgress = ref(false)
const fakeProgress = ref(0)
const fakeProgressLabel = ref('')
const emojiDrops = ref<EmojiDrop[]>([])
const mouseTrails = ref<TrailPoint[]>([])

const coolDownMap = new Map<number, number>()
let fakeProgressTimer: number | undefined
let mouseTrailTimer: number | undefined
let fastTypingTimer: number | undefined
let clockTimer: number | undefined
let moodTimer: number | undefined
let passiveTickTimer: number | undefined
let autoSequenceTimers: number[] = []
let dodgeListenerBound = false
let typingHitCounter = 0
let logoClicks = 0
let emojiSeed = 1
let trailSeed = 1

const randomLines = [
  '今天的 KPI 是让同事笑出来。',
  '检测到认真工作行为，建议立刻喝水。',
  '摸鱼雷达已开启，当前安全。',
]

const eggDrawPool = [
  'SSR: 今天所有 bug 都会自己消失',
  'SR: PR 一次过，review 只有点赞',
  'R: 咖啡无限续杯券（精神意义）',
  'N: 继续搬砖但会掉彩蛋',
]

const pickRandom = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)] as T

const eggs: EggDefinition[] = [
  { id: 1, title: '全站倒转 180 度' },
  { id: 2, title: '全站左右镜像' },
  { id: 3, title: '鼠标变搞怪光标' },
  { id: 4, title: '进度条卡 99%' },
  { id: 5, title: '取消按钮轻微闪避' },
  { id: 6, title: '随机假报错吐槽' },
  { id: 7, title: '老板来了模式快捷键' },
  { id: 8, title: '三点位彩蛋任务' },
  { id: 9, title: '页面重力模式' },
  { id: 10, title: '假系统升级条' },
  { id: 11, title: '错别字 2 秒修复' },
  { id: 12, title: '价格末位抖动' },
  { id: 13, title: '导航顺序短暂打乱' },
  { id: 14, title: '卡片漂浮模式' },
  { id: 15, title: '鼠标拖尾彩带' },
  { id: 16, title: '页面快门闪黑' },
  { id: 17, title: '假语音播报按钮' },
  { id: 18, title: 'Logo 连点 5 下解锁' },
  { id: 19, title: '截图报表伪装模式' },
  { id: 20, title: '404 小游戏提示' },
  { id: 21, title: '时间加速显示' },
  { id: 22, title: '表情雨' },
  { id: 23, title: '页面轻微地震' },
  { id: 24, title: '暗号解锁福利' },
  { id: 25, title: '角落 NPC 吐槽' },
  { id: 26, title: '按钮文案短暂反转' },
  { id: 27, title: '复古像素主题' },
  { id: 28, title: '进度条冲到 101%' },
  { id: 29, title: 'AI 心情条' },
  { id: 30, title: '夜间模式反向闪光' },
  { id: 31, title: '图标标题交换位置' },
  { id: 32, title: '彩蛋抽卡' },
  { id: 33, title: '输入太快吐槽' },
  { id: 34, title: '求放假按钮' },
  { id: 35, title: '页面贴纸胶带' },
  { id: 36, title: '黑客终端滤镜' },
  { id: 37, title: '轻微模糊眩晕' },
  { id: 38, title: '文本倾斜模式' },
  { id: 39, title: '随机夸夸弹幕' },
  { id: 40, title: '低电量假提示' },
  { id: 41, title: '页面慢动作' },
  { id: 42, title: '按钮弹跳模式' },
  { id: 43, title: '彩虹滤镜巡游' },
  { id: 44, title: '超级彩带风暴' },
  { id: 45, title: '老板巡逻提示条' },
]

const allEggIds = new Set<EggId>(eggs.map((egg) => egg.id))

const isEggId = (id: number): id is EggId => allEggIds.has(id as EggId)

const defaultPassiveEggs: PassiveEggConfig[] = [
  { id: 1, probabilityPerSecond: 0.01 },
  { id: 2, probabilityPerSecond: 0.01 },
  { id: 3, probabilityPerSecond: 0.008 },
  { id: 4, probabilityPerSecond: 0.01 },
  { id: 5, probabilityPerSecond: 0.01 },
  { id: 6, probabilityPerSecond: 0.008 },
  { id: 8, probabilityPerSecond: 0.004 },
  { id: 9, probabilityPerSecond: 0.03 },
  { id: 10, probabilityPerSecond: 0.02 },
  { id: 11, probabilityPerSecond: 0.02 },
  { id: 12, probabilityPerSecond: 0.015 },
  { id: 13, probabilityPerSecond: 0.01 },
  { id: 14, probabilityPerSecond: 0.04 },
  { id: 15, probabilityPerSecond: 0.02 },
  { id: 16, probabilityPerSecond: 0.012 },
  { id: 17, probabilityPerSecond: 0.01 },
  { id: 18, probabilityPerSecond: 0.005 },
  { id: 19, probabilityPerSecond: 0.01 },
  { id: 20, probabilityPerSecond: 0.01 },
  { id: 7, probabilityPerSecond: 0.01 },
  { id: 24, probabilityPerSecond: 0.004 },
  { id: 27, probabilityPerSecond: 0.01 },
  { id: 28, probabilityPerSecond: 0.01 },
  { id: 33, probabilityPerSecond: 0.008 },
  { id: 34, probabilityPerSecond: 0.01 },
  { id: 36, probabilityPerSecond: 0.01 },
  { id: 21, probabilityPerSecond: 0.015 },
  { id: 22, probabilityPerSecond: 0.025 },
  { id: 23, probabilityPerSecond: 0.02 },
  { id: 25, probabilityPerSecond: 0.03 },
  { id: 26, probabilityPerSecond: 0.03 },
  { id: 29, probabilityPerSecond: 0.03 },
  { id: 30, probabilityPerSecond: 0.012 },
  { id: 31, probabilityPerSecond: 0.01 },
  { id: 32, probabilityPerSecond: 0.008 },
  { id: 35, probabilityPerSecond: 0.015 },
  { id: 37, probabilityPerSecond: 0.012 },
  { id: 38, probabilityPerSecond: 0.012 },
  { id: 39, probabilityPerSecond: 0.02 },
  { id: 40, probabilityPerSecond: 0.01 },
  { id: 41, probabilityPerSecond: 0.01 },
  { id: 42, probabilityPerSecond: 0.015 },
  { id: 43, probabilityPerSecond: 0.01 },
  { id: 44, probabilityPerSecond: 0.008 },
  { id: 45, probabilityPerSecond: 0.01 },
]

const loadRunMode = (): AprilRunMode => {
  const saved = localStorage.getItem(LS.runMode)
  if (saved === 'light' || saved === 'medium' || saved === 'intense') return saved
  return 'medium'
}

const passiveConfigKey = (mode: AprilRunMode) => `${LS.passiveConfigPrefix}-${mode}`

const loadPassiveConfig = (mode: AprilRunMode): PassiveEggConfig[] => {
  const raw = localStorage.getItem(passiveConfigKey(mode))
  if (!raw) return defaultPassiveEggs.map((item) => ({ ...item }))

  try {
    const parsed = JSON.parse(raw) as PassiveEggConfig[]
    const merged = defaultPassiveEggs.map((item) => {
      const found = parsed.find((p) => p.id === item.id)
      if (!found || typeof found.probabilityPerSecond !== 'number') return { ...item }
      const probabilityPerSecond = Math.max(0, Math.min(0.2, found.probabilityPerSecond))
      return { id: item.id, probabilityPerSecond }
    })
    return merged
  } catch {
    return defaultPassiveEggs.map((item) => ({ ...item }))
  }
}

const isAprDay = computed(() => {
  const now = new Date()
  return now.getMonth() === 3 && now.getDate() === 1
})

const featureSwitch = ref(localStorage.getItem(LS.featureSwitch) !== '0')
const previewMode = ref(localStorage.getItem(LS.previewMode) === '1')
const runMode = ref<AprilRunMode>(loadRunMode())
const passiveEggs = ref<PassiveEggConfig[]>(loadPassiveConfig(runMode.value))
const isPreviewMode = computed(() => previewMode.value)
const isEnvEnabled = computed(() => (import.meta.env.VITE_APRIL_FOOL_ENABLED ?? 'true') !== 'false')
const isInSafeRoute = computed(
  () =>
    !String(route.name || '')
      .toLowerCase()
      .includes('login'),
)
const isDebugRoute = computed(() => {
  const name = String(route.name || '').toLowerCase()
  const path = String(route.path || '').toLowerCase()
  const fullPath = String(route.fullPath || '').toLowerCase()
  return name.includes('debug') || path.includes('/debug') || fullPath.includes('/debug')
})
const showDebugConsole = computed(() => isPreviewMode.value || isDebugRoute.value)

const todayKey = () => {
  const now = new Date()
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

const masterDisabled = ref(localStorage.getItem(LS.masterDisabled) === '1')
const userDismissedToday = ref(localStorage.getItem(LS.userDismissByDay) === todayKey())

const eggTitleMap = computed(() => {
  const map = {} as Record<number, string>
  eggs.forEach((egg) => {
    map[egg.id] = egg.title
  })
  return map
})

const passiveSummary = computed(() =>
  passiveEggs.value
    .map((item) => `${item.id}(${(item.probabilityPerSecond * 100).toFixed(1)}%)`)
    .join(' '),
)

const isEggAllowedByMode = (id: EggId): boolean => {
  if (runMode.value === 'intense') return true

  if (runMode.value === 'medium') {
    const blocked = new Set<EggId>([1, 2, 7, 27, 36, 43])
    return !blocked.has(id)
  }

  const lightOnly = new Set<EggId>([4, 6, 10, 11, 14, 22, 25, 29, 39, 45])
  return lightOnly.has(id)
}

const visibleEggs = computed(() => eggs.filter((egg) => isEggAllowedByMode(egg.id)))

const isFeatureReachable = computed(() => {
  if (!featureSwitch.value || !isEnvEnabled.value || !isInSafeRoute.value) {
    return false
  }
  if (isPreviewMode.value) {
    return true
  }
  if (userDismissedToday.value) {
    return false
  }
  return (isAprDay.value || isPreviewMode.value) && !masterDisabled.value
})

const isShellVisible = computed(() => {
  if (!featureSwitch.value || !isEnvEnabled.value || !isInSafeRoute.value) {
    return false
  }
  return isAprDay.value || isPreviewMode.value
})

const toggleFeatureSwitch = () => {
  featureSwitch.value = !featureSwitch.value
  localStorage.setItem(LS.featureSwitch, featureSwitch.value ? '1' : '0')
}

const persistRunMode = () => {
  localStorage.setItem(LS.runMode, runMode.value)
}

const onRunModeChange = () => {
  persistRunMode()
  passiveEggs.value = loadPassiveConfig(runMode.value)
}

const persistPassiveConfig = () => {
  localStorage.setItem(passiveConfigKey(runMode.value), JSON.stringify(passiveEggs.value))
}

const resetPassiveProbabilities = () => {
  passiveEggs.value = defaultPassiveEggs.map((item) => ({ ...item }))
  persistPassiveConfig()
}

const toggleMasterDisabled = () => {
  masterDisabled.value = !masterDisabled.value
  if (masterDisabled.value) {
    localStorage.setItem(LS.masterDisabled, '1')
    localStorage.setItem(LS.userDismissByDay, todayKey())
    userDismissedToday.value = true
  } else {
    localStorage.removeItem(LS.masterDisabled)
    localStorage.removeItem(LS.userDismissByDay)
    userDismissedToday.value = false
  }
}

const toggleAprilEffectsForToday = () => {
  showPanel.value = false

  if (userDismissedToday.value) {
    localStorage.removeItem(LS.masterDisabled)
    localStorage.removeItem(LS.userDismissByDay)
    userDismissedToday.value = false
    syncLocalSwitches()
    syncPassiveTicker()
    ElMessage.success('已开启今日愚人效果')
    return
  }

  previewMode.value = false
  masterDisabled.value = false
  localStorage.setItem(LS.previewMode, '0')
  localStorage.removeItem(LS.masterDisabled)
  localStorage.setItem(LS.userDismissByDay, todayKey())
  userDismissedToday.value = true

  syncLocalSwitches()
  syncPassiveTicker()
  ElMessage.success('已关闭今日愚人效果')
}

const addBodyClass = (className: string) => {
  document.body.classList.add(className)
}

const removeBodyClass = (className: string) => {
  document.body.classList.remove(className)
}

const withTemporaryClass = (className: string, duration = 1800) => {
  addBodyClass(className)
  window.setTimeout(() => removeBodyClass(className), duration)
}

const runProgress = (label: string, target: number) => {
  showFakeProgress.value = true
  fakeProgressLabel.value = label
  fakeProgress.value = 0
  window.clearInterval(fakeProgressTimer)
  fakeProgressTimer = window.setInterval(() => {
    if (fakeProgress.value >= target) {
      window.clearInterval(fakeProgressTimer)
      window.setTimeout(() => {
        showFakeProgress.value = false
      }, 1200)
      return
    }
    fakeProgress.value += Math.max(1.4, (target - fakeProgress.value) * 0.16)
  }, 120)
}

const runLogoHint = () => {
  ElMessage.info('尝试连点左侧 AppServer Logo 5 次，可解锁隐藏福利')
}

const runQuest = () => {
  questProgress.value = 0
  showQuestDots.value = true
  ElMessage.success('找到 3 个隐藏点位即可解锁彩蛋')
}

const handleQuestDot = () => {
  questProgress.value += 1
  if (questProgress.value >= 3) {
    showQuestDots.value = false
    couponDialogVisible.value = true
  }
}

const spawnEmojiRain = (count = 24) => {
  const emojis = ['🤣', '🎉', '🎈', '🐟', '🚀', '🥳']
  emojiDrops.value = Array.from({ length: count }).map(() => ({
    id: emojiSeed++,
    left: Math.round(Math.random() * 95),
    duration: 1800 + Math.round(Math.random() * 1800),
    emoji: pickRandom(emojis),
  }))
  window.setTimeout(() => {
    emojiDrops.value = []
  }, 3600)
}

const enableMouseTrail = (duration = 10000) => {
  const colors = ['#ff7a18', '#ffd166', '#06d6a0', '#118ab2', '#ef476f']
  const handler = (e: MouseEvent) => {
    mouseTrails.value.push({
      id: trailSeed++,
      x: e.clientX,
      y: e.clientY,
      color: pickRandom(colors),
    })
    if (mouseTrails.value.length > 24) {
      mouseTrails.value = mouseTrails.value.slice(-24)
    }
  }
  window.addEventListener('mousemove', handler)
  window.clearTimeout(mouseTrailTimer)
  mouseTrailTimer = window.setTimeout(() => {
    window.removeEventListener('mousemove', handler)
    mouseTrails.value = []
  }, duration)
}

const scrambleAsideMenu = () => {
  const menu = document.querySelector('.aside-nav')
  if (!menu) return

  const items = Array.from(menu.children)
  const frozen = [...items]
  const shuffled = [...items].sort(() => Math.random() - 0.5)
  shuffled.forEach((item) => menu.appendChild(item))

  window.setTimeout(() => {
    frozen.forEach((item) => menu.appendChild(item))
  }, 1500)
}

const runTypoFix = () => {
  const title = document.querySelector('h1, h2, .title, .brand-name') as HTMLElement | null
  if (!title || !title.innerText) return
  const original = title.innerText
  const typo = original.slice(0, Math.max(1, original.length - 1)) + '喵'
  title.innerText = typo
  window.setTimeout(() => {
    title.innerText = original
  }, 1800)
}

const runButtonReverseText = () => {
  const buttons = Array.from(document.querySelectorAll('button, .el-button')) as HTMLElement[]
  const changed: Array<{ el: HTMLElement; txt: string }> = []

  buttons.slice(0, 12).forEach((button) => {
    const text = button.innerText?.trim()
    if (!text || text.length < 2) return
    changed.push({ el: button, txt: text })
    button.innerText = text.split('').reverse().join('')
  })

  window.setTimeout(() => {
    changed.forEach((item) => {
      item.el.innerText = item.txt
    })
  }, 1400)
}

const runDodgeCancel = () => {
  const handler = (event: Event) => {
    const target = event.target as HTMLElement | null
    if (!target) return
    const button = target.closest('button, .el-button') as HTMLElement | null
    if (!button) return
    const txt = button.innerText || ''
    if (!txt.includes('取消') && !txt.toLowerCase().includes('cancel')) return
    button.style.transform = `translate(${Math.round((Math.random() - 0.5) * 32)}px, ${Math.round((Math.random() - 0.5) * 24)}px)`
    window.setTimeout(() => {
      button.style.transform = ''
    }, 700)
  }

  if (dodgeListenerBound) return
  dodgeListenerBound = true
  document.addEventListener('mouseover', handler)
  window.setTimeout(() => {
    document.removeEventListener('mouseover', handler)
    dodgeListenerBound = false
  }, 6000)
}

const runFastClock = () => {
  showClock.value = true
  let base = Date.now()
  window.clearInterval(clockTimer)
  clockTimer = window.setInterval(() => {
    base += 10000
    acceleratedClock.value = new Date(base).toLocaleTimeString('zh-CN')
  }, 1000)
  window.setTimeout(() => {
    window.clearInterval(clockTimer)
    showClock.value = false
  }, 9000)
}

const runNpc = () => {
  npcLine.value = pickRandom(randomLines)
  npcVisible.value = true
  window.setTimeout(() => {
    npcVisible.value = false
  }, 5200)
}

const runDrawCard = () => {
  drawResult.value = pickRandom(eggDrawPool)
  drawDialogVisible.value = true
}

const runFastTypingRoast = () => {
  const keyHandler = () => {
    typingHitCounter += 1
    if (typingHitCounter > 8) {
      ElMessage.warning('慢一点，键盘都要冒烟了。')
      typingHitCounter = 0
    }
  }

  window.addEventListener('keydown', keyHandler)
  window.clearTimeout(fastTypingTimer)
  fastTypingTimer = window.setTimeout(() => {
    window.removeEventListener('keydown', keyHandler)
    typingHitCounter = 0
  }, 10000)
}

const runVoiceAnnouncement = () => {
  ElMessage.info('正在用老板声线朗读中...已自动静音。')
}

const runVacationRequest = () => {
  ElMessage.success('申请已提交给平行宇宙 HR，排队号 #2026。')
}

const runPassphrase = async () => {
  try {
    const input = await ElMessageBox.prompt('请输入暗号解锁福利', '彩蛋暗号', {
      inputPlaceholder: '例如：今天摸鱼有理',
      confirmButtonText: '解锁',
      cancelButtonText: '取消',
    })
    if ((input.value || '').trim() === '今天摸鱼有理') {
      couponDialogVisible.value = true
      return
    }
    ElMessage.warning('暗号不正确，再试一次。')
  } catch {
    // ignore cancel
  }
}

const runLightFlash = () => {
  withTemporaryClass('april-light-flash', 1000)
}

const runMoodBar = () => {
  showMoodBar.value = true
  aiMood.value = 72 + Math.round(Math.random() * 20)
  window.clearInterval(moodTimer)
  moodTimer = window.setInterval(() => {
    aiMood.value = Math.max(40, Math.min(99, aiMood.value + Math.round((Math.random() - 0.5) * 8)))
  }, 1200)
  window.setTimeout(() => {
    window.clearInterval(moodTimer)
    showMoodBar.value = false
  }, 10000)
}

const runCompliment = () => {
  const lines = [
    '今日最佳：你写的代码居然零 warning。',
    '系统检测：你的 commit 信息特别优雅。',
    '恭喜，你的 bug 今日请假了。',
  ]
  ElMessage.success(pickRandom(lines))
}

const runBossPatrol = () => {
  npcLine.value = '老板巡逻中：切到认真模式 3...2...1...'
  npcVisible.value = true
  window.setTimeout(() => {
    npcVisible.value = false
  }, 4200)
}

const applyEgg = (id: EggId) => {
  switch (id) {
    case 1:
      withTemporaryClass('april-rotate', 2200)
      ElMessage.success('愚人节快乐，2 秒后自动恢复。')
      break
    case 2:
      document.body.classList.toggle('april-mirror')
      break
    case 3:
      document.body.classList.toggle('april-cursor-fish')
      break
    case 4:
      runProgress('加载快乐模块中，请稍候...', 99)
      break
    case 5:
      runDodgeCancel()
      break
    case 6:
      ElMessage.error('错误：今日不宜加班，请重试明天。')
      break
    case 7:
      document.body.classList.toggle('april-report-mode')
      ElMessage.info('老板来了模式已切换。')
      break
    case 8:
      runQuest()
      break
    case 9:
      withTemporaryClass('april-gravity', 6000)
      break
    case 10:
      runProgress('系统正在升级人格模块...', 88)
      break
    case 11:
      runTypoFix()
      break
    case 12:
      withTemporaryClass('april-price-jitter', 3200)
      break
    case 13:
      scrambleAsideMenu()
      break
    case 14:
      document.body.classList.toggle('april-floating')
      break
    case 15:
      enableMouseTrail()
      break
    case 16:
      showShutter.value = true
      window.setTimeout(() => {
        showShutter.value = false
      }, 500)
      break
    case 17:
      showVoiceButton.value = !showVoiceButton.value
      break
    case 18:
      runLogoHint()
      break
    case 19:
      document.body.classList.toggle('april-report-mode')
      break
    case 20:
      ElMessage.info('404 页面小游戏已启用，访问不存在地址可体验。')
      break
    case 21:
      runFastClock()
      break
    case 22:
      spawnEmojiRain()
      break
    case 23:
      withTemporaryClass('april-shake', 700)
      break
    case 24:
      void runPassphrase()
      break
    case 25:
      runNpc()
      break
    case 26:
      runButtonReverseText()
      break
    case 27:
      document.body.classList.toggle('april-retro')
      break
    case 28:
      runProgress('努力值过高，正在冲刺...', 101)
      break
    case 29:
      runMoodBar()
      break
    case 30:
      runLightFlash()
      break
    case 31:
      withTemporaryClass('april-swap-icon-title', 2400)
      break
    case 32:
      runDrawCard()
      break
    case 33:
      runFastTypingRoast()
      break
    case 34:
      showVacationButton.value = !showVacationButton.value
      break
    case 35:
      document.body.classList.toggle('april-stickers')
      break
    case 36:
      document.body.classList.toggle('april-matrix')
      break
    case 37:
      withTemporaryClass('april-blur', 2800)
      break
    case 38:
      withTemporaryClass('april-text-tilt', 2800)
      break
    case 39:
      runCompliment()
      break
    case 40:
      runProgress('警告：电量仅剩 1%，请立即摸鱼充电...', 1)
      break
    case 41:
      withTemporaryClass('april-slow-motion', 3800)
      break
    case 42:
      document.body.classList.toggle('april-bouncy')
      break
    case 43:
      withTemporaryClass('april-rainbow', 4800)
      break
    case 44:
      spawnEmojiRain(48)
      enableMouseTrail(16000)
      break
    case 45:
      runBossPatrol()
      break
    default:
      break
  }
}

const triggerEggWithCooldown = (id: EggId) => {
  if (!isEggAllowedByMode(id)) return false
  const now = Date.now()
  const last = coolDownMap.get(id) || 0
  if (now - last < 850) return false
  coolDownMap.set(id, now)
  applyEgg(id)
  return true
}

const triggerEgg = (id: EggId, options: { force?: boolean } = {}) => {
  if (!options.force && !isFeatureReachable.value && !isPreviewMode.value) {
    ElMessage.info('当前不在彩蛋生效窗口。')
    return
  }
  triggerEggWithCooldown(id)
}

const runPassiveTick = () => {
  if (!isFeatureReachable.value) return
  if (document.visibilityState !== 'visible') return

  const probabilityMultiplierByMode: Record<AprilRunMode, number> = {
    light: 1,
    medium: 1,
    intense: 1,
  }
  const maxTriggersByMode: Record<AprilRunMode, number> = {
    light: 1,
    medium: 1,
    intense: 2,
  }
  const modeMultiplier = probabilityMultiplierByMode[runMode.value]
  const maxTriggers = maxTriggersByMode[runMode.value]

  const hits = passiveEggs.value.filter(
    (item) =>
      isEggAllowedByMode(item.id) &&
      Math.random() < Math.min(1, item.probabilityPerSecond * modeMultiplier),
  )
  if (hits.length === 0) return

  const picked = [...hits].sort(() => Math.random() - 0.5).slice(0, maxTriggers)
  picked.forEach((item) => {
    triggerEggWithCooldown(item.id)
  })
}

const runAutoSequence = () => {
  autoSequenceTimers.forEach((timerId) => clearTimeout(timerId))
  autoSequenceTimers = []

  const sequence: EggId[] = [16, 1, 10, 11, 14, 15, 22, 25, 29]
  sequence.forEach((id, idx) => {
    const timerId = window.setTimeout(() => triggerEgg(id), idx * 900)
    autoSequenceTimers.push(timerId)
  })
}

const setupKeyboardShortcut = () => {
  const stack: string[] = []
  const handler = (event: KeyboardEvent) => {
    const key = typeof event.key === 'string' ? event.key.toLowerCase() : ''
    if (!key) return

    if (key === 'b' && event.ctrlKey && event.shiftKey) {
      triggerEgg(7)
      return
    }
    stack.push(key)
    if (stack.length > 5) stack.shift()
    if (stack.join('') === 'april') {
      showPanel.value = true
      ElMessage.success('彩蛋控制台已打开。')
      stack.length = 0
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}

const bindLogoCounter = () => {
  const logo = document.querySelector('.aside-brand')
  if (!logo) return () => {}

  const handler = () => {
    logoClicks += 1
    if (logoClicks >= 5) {
      logoClicks = 0
      couponDialogVisible.value = true
    }
  }
  logo.addEventListener('click', handler)
  return () => logo.removeEventListener('click', handler)
}

let disposeKeyboard = () => {}
let disposeLogo = () => {}
let disposeStorageSync = () => {}
let disposeAprilFoolsBus = () => {}

const setupAprilFoolsBus = () => {
  const onTriggerEgg = (payload?: { id?: number; force?: boolean }) => {
    if (!payload || typeof payload.id !== 'number' || !isEggId(payload.id)) return
    triggerEgg(payload.id, { force: payload.force })
  }

  const onTriggerRandomEgg = (payload?: { force?: boolean }) => {
    const pool = eggs.filter((egg) => isEggAllowedByMode(egg.id))
    if (!pool.length) return
    const picked = pickRandom(pool)
    triggerEgg(picked.id, { force: payload?.force })
  }

  const onRunAutoSequence = () => {
    runAutoSequence()
  }

  const onOpenPanel = () => {
    if (!showDebugConsole.value) return
    showPanel.value = true
  }

  const onSyncLocalState = () => {
    syncLocalSwitches()
    syncPassiveTicker()
  }

  aprilFoolsEventBus.on('TRIGGER_EGG', onTriggerEgg)
  aprilFoolsEventBus.on('TRIGGER_RANDOM_EGG', onTriggerRandomEgg)
  aprilFoolsEventBus.on('RUN_AUTO_SEQUENCE', onRunAutoSequence)
  aprilFoolsEventBus.on('OPEN_PANEL', onOpenPanel)
  aprilFoolsEventBus.on('SYNC_LOCAL_STATE', onSyncLocalState)

  return () => {
    aprilFoolsEventBus.off('TRIGGER_EGG', onTriggerEgg)
    aprilFoolsEventBus.off('TRIGGER_RANDOM_EGG', onTriggerRandomEgg)
    aprilFoolsEventBus.off('RUN_AUTO_SEQUENCE', onRunAutoSequence)
    aprilFoolsEventBus.off('OPEN_PANEL', onOpenPanel)
    aprilFoolsEventBus.off('SYNC_LOCAL_STATE', onSyncLocalState)
  }
}

const clearAllAprilEffects = () => {
  document.body.classList.remove(
    'april-mirror',
    'april-cursor-fish',
    'april-floating',
    'april-report-mode',
    'april-retro',
    'april-stickers',
    'april-matrix',
    'april-bouncy',
    'april-rotate',
    'april-gravity',
    'april-price-jitter',
    'april-shake',
    'april-light-flash',
    'april-swap-icon-title',
    'april-blur',
    'april-text-tilt',
    'april-slow-motion',
    'april-rainbow',
  )

  showShutter.value = false
  showQuestDots.value = false
  showVoiceButton.value = false
  showVacationButton.value = false
  showMoodBar.value = false
  showClock.value = false
  npcVisible.value = false
  showFakeProgress.value = false
  emojiDrops.value = []
  mouseTrails.value = []
}

const syncLocalSwitches = () => {
  featureSwitch.value = localStorage.getItem(LS.featureSwitch) !== '0'
  previewMode.value = localStorage.getItem(LS.previewMode) === '1'
  userDismissedToday.value = localStorage.getItem(LS.userDismissByDay) === todayKey()
  runMode.value = loadRunMode()
  passiveEggs.value = loadPassiveConfig(runMode.value)
}

const clearAutoSequenceTimers = () => {
  autoSequenceTimers.forEach((timerId) => window.clearTimeout(timerId))
  autoSequenceTimers = []
}

const syncPassiveTicker = () => {
  if (isFeatureReachable.value) {
    if (!passiveTickTimer) {
      passiveTickTimer = window.setInterval(runPassiveTick, 4000)
    }
    return
  }

  window.clearInterval(passiveTickTimer)
  passiveTickTimer = undefined
  clearAutoSequenceTimers()
  clearAllAprilEffects()
}

const setupStorageSync = () => {
  const knownKeys = Object.values(LS)
  const handler = (event: StorageEvent) => {
    if (!event.key || knownKeys.includes(event.key as (typeof knownKeys)[number])) {
      syncLocalSwitches()
      syncPassiveTicker()
    }
  }

  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

watch(
  () => route.fullPath,
  () => {
    syncLocalSwitches()
    syncPassiveTicker()
    disposeLogo()
    disposeLogo = bindLogoCounter()
  },
)

watch(isFeatureReachable, () => {
  syncPassiveTicker()
})

onMounted(() => {
  syncLocalSwitches()
  syncPassiveTicker()
  disposeKeyboard = setupKeyboardShortcut()
  disposeLogo = bindLogoCounter()
  disposeStorageSync = setupStorageSync()
  disposeAprilFoolsBus = setupAprilFoolsBus()

  const triggeredKey = `${todayKey()}-${String(route.name || 'unknown')}`
  if (isFeatureReachable.value && localStorage.getItem(LS.triggeredByDay) !== triggeredKey) {
    localStorage.setItem(LS.triggeredByDay, triggeredKey)
    window.setTimeout(() => runAutoSequence(), 1000)
  }
})

onBeforeUnmount(() => {
  disposeKeyboard()
  disposeLogo()
  disposeStorageSync()
  disposeAprilFoolsBus()
  window.clearInterval(fakeProgressTimer)
  window.clearTimeout(mouseTrailTimer)
  window.clearTimeout(fastTypingTimer)
  window.clearInterval(clockTimer)
  window.clearInterval(moodTimer)
  window.clearInterval(passiveTickTimer)
  clearAutoSequenceTimers()
  clearAllAprilEffects()
})
</script>

<style scoped>
.april-shell {
  position: fixed;
  right: 16px;
  bottom: 150px;
  z-index: 7000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.april-close-btn {
  border: none;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.82);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  padding: 8px 12px;
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(17, 24, 39, 0.26);
}

.april-toggle {
  width: 46px;
  height: 46px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: linear-gradient(145deg, #ff7a18, #ffb347);
  color: #1f2937;
  font-weight: 700;
  box-shadow: 0 12px 30px rgba(255, 122, 24, 0.35);
  cursor: pointer;
}

.april-panel {
  margin-bottom: 10px;
  width: min(440px, calc(100vw - 24px));
  max-height: min(74vh, 680px);
  overflow: auto;
  padding: 14px;
  border-radius: 16px;
}

.april-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.april-panel-header h3 {
  font-size: 16px;
  font-weight: 700;
}

.mode-tag {
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
  padding: 2px 10px;
  font-size: 12px;
}

.april-panel-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.april-panel-tip {
  margin-bottom: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.mode-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.mode-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.passive-prob {
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.passive-config {
  margin-bottom: 10px;
  padding: 10px;
  border-radius: 12px;
}

.passive-config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.passive-row {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) minmax(120px, 2fr) 54px;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}

.passive-title {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.passive-value {
  font-size: 12px;
  font-weight: 600;
  text-align: right;
}

.april-eggs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.egg-item {
  text-align: left;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 10px;
  background: var(--color-background-soft);
  color: var(--color-text);
  cursor: pointer;
  padding: 8px 10px;
  display: flex;
  gap: 6px;
  line-height: 1.3;
}

.egg-id {
  font-weight: 700;
  opacity: 0.7;
}

.egg-title {
  font-size: 12px;
}

.april-fade-enter-active,
.april-fade-leave-active {
  transition: all 0.2s ease;
}

.april-fade-enter-from,
.april-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.april-shutter {
  position: fixed;
  inset: 0;
  background: #000;
  z-index: 7600;
  pointer-events: none;
}

.quest-dots {
  position: fixed;
  inset: 0;
  z-index: 7600;
  pointer-events: none;
}

.quest-dot {
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: none;
  background: radial-gradient(circle, #ffd166 0%, #ff7a18 100%);
  box-shadow: 0 0 16px rgba(255, 122, 24, 0.7);
  cursor: pointer;
  pointer-events: auto;
}

.emoji-rain {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 7600;
}

.emoji-drop {
  position: absolute;
  top: -8%;
  font-size: 24px;
  animation: drop linear forwards;
}

@keyframes drop {
  to {
    transform: translateY(112vh) rotate(360deg);
    opacity: 0.2;
  }
}

.trail-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 7601;
}

.trail-dot {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  transform: translate(-50%, -50%);
  animation: trail-fade 650ms ease forwards;
}

@keyframes trail-fade {
  to {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.15);
  }
}

.voice-button,
.vacation-button {
  position: fixed;
  right: 18px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  padding: 8px 12px;
  color: #111827;
  background: linear-gradient(145deg, #ffd166, #fca311);
  box-shadow: 0 8px 20px rgba(252, 163, 17, 0.35);
  z-index: 7500;
}

.voice-button {
  bottom: 220px;
}

.vacation-button {
  bottom: 262px;
}

.npc-bubble {
  position: fixed;
  left: 16px;
  bottom: 20px;
  z-index: 7400;
  max-width: 280px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(17, 24, 39, 0.14);
  background: rgba(255, 255, 255, 0.92);
  color: #111827;
}

.mood-bar {
  position: fixed;
  top: 14px;
  right: 14px;
  z-index: 7400;
  display: flex;
  gap: 8px;
  align-items: center;
  border-radius: 12px;
  padding: 8px 12px;
  background: rgba(16, 185, 129, 0.14);
  border: 1px solid rgba(16, 185, 129, 0.32);
}

.fast-clock {
  position: fixed;
  top: 14px;
  left: 14px;
  z-index: 7400;
  border-radius: 12px;
  padding: 8px 12px;
  font-size: 18px;
  font-weight: 700;
  background: rgba(99, 102, 241, 0.14);
  border: 1px solid rgba(99, 102, 241, 0.32);
}

.fake-progress-wrap {
  position: fixed;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  min-width: min(560px, calc(100vw - 24px));
  z-index: 7600;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(17, 24, 39, 0.12);
  border-radius: 12px;
  padding: 10px 12px;
}

.fake-progress-label {
  font-size: 12px;
  margin-bottom: 6px;
}

.fake-progress-track {
  height: 8px;
  background: rgba(15, 23, 42, 0.1);
  border-radius: 999px;
  overflow: hidden;
}

.fake-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #ff7a18, #ffd166);
  transition: width 0.12s ease;
}

.fake-progress-value {
  margin-top: 4px;
  text-align: right;
  font-size: 12px;
  font-weight: 700;
}

.draw-result {
  font-size: 16px;
  font-weight: 600;
}

@media (max-width: 768px) {
  .april-shell {
    right: 10px;
    bottom: 128px;
  }

  .april-eggs {
    grid-template-columns: 1fr;
  }

  .passive-row {
    grid-template-columns: 1fr;
  }

  .passive-value {
    text-align: left;
  }

  .voice-button,
  .vacation-button {
    right: 10px;
  }

  .voice-button {
    bottom: 194px;
  }

  .vacation-button {
    bottom: 236px;
  }
}
</style>
