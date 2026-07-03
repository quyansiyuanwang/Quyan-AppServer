<script setup lang="ts">
// 检查是否还有可消除的组合
function hasAnyMatch(board: PopCell[][]): boolean {
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    for (let col = 0; col < BOARD_COLS; col += 1) {
      const group = collectGroupForBoard(board, row, col)
      if (group.length >= MIN_POP_GROUP) return true
    }
  }
  return false
}

// 用于hasAnyMatch的独立group收集器
function collectGroupForBoard(board: PopCell[][], startRow: number, startCol: number): PopPoint[] {
  const startCell = board[startRow]?.[startCol]
  if (!startCell) return []
  const targetColor = startCell.color
  const result: PopPoint[] = []
  const stack: PopPoint[] = [{ row: startRow, col: startCol }]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const point = stack.pop()
    if (!point) continue
    const key = toPointKey(point.row, point.col)
    if (visited.has(key)) continue
    visited.add(key)
    const current = board[point.row]?.[point.col]
    if (!current || current.color !== targetColor) continue
    result.push(point)
    const nextPoints: PopPoint[] = [
      { row: point.row - 1, col: point.col },
      { row: point.row + 1, col: point.col },
      { row: point.row, col: point.col - 1 },
      { row: point.row, col: point.col + 1 },
    ]
    for (const next of nextPoints) {
      if (!isInsideBoard(next.row, next.col)) continue
      stack.push(next)
    }
  }
  return result
}

// 自动打乱棋盘直到有可消组合
function shuffleBoardUntilMatch(board: PopCell[][]): PopCell[][] {
  let tries = 0
  const newBoard = board.map((row) => row.slice())
  while (!hasAnyMatch(newBoard) && tries < 10) {
    // 打乱所有cell
    const allCells = newBoard.flat()
    for (let i = allCells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = allCells[i]
      const swap = allCells[j]
      if (tmp && swap) {
        allCells[i] = swap
        allCells[j] = tmp
      }
    }
    // 重新填充
    let idx = 0
    for (let row = 0; row < BOARD_ROWS; row++) {
      for (let col = 0; col < BOARD_COLS; col++) {
        const cell = allCells[idx++]
        const targetRow = newBoard[row]
        if (cell && targetRow) {
          targetRow[col] = cell
        }
      }
    }
    tries++
  }
  return newBoard
}
import { computed, onBeforeUnmount, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useLearningProgressStore } from '@/stores/learningProgress'

type PopColor = 'coral' | 'mint' | 'sky' | 'sun' | 'berry'
type PopPhase = 'idle' | 'running' | 'ended'
type RoundDuration = 45 | 60 | 90

interface PopCell {
  id: string
  color: PopColor
}

interface PopPoint {
  row: number
  col: number
}

const BOARD_ROWS = 8
const BOARD_COLS = 8
const ROUND_DURATIONS: RoundDuration[] = [45, 60, 90]
const MIN_POP_GROUP = 3
const POP_ANIMATION_MS = 170
const COMBO_WINDOW_MS = 1600
const MAX_COMBO_MULTIPLIER = 4

const COLOR_POOL: PopColor[] = ['coral', 'mint', 'sky', 'sun', 'berry']
const COLOR_ICON_MAP: Record<PopColor, string> = {
  coral: '🍑',
  mint: '🥝',
  sky: '🫐',
  sun: '🍋',
  berry: '🍓',
}

const { t } = useI18n()
const progressStore = useLearningProgressStore()

const board = ref<PopCell[][]>([])
const selectedRoundSeconds = ref<RoundDuration>(60)
const score = ref(0)
const secondsLeft = ref(selectedRoundSeconds.value)
const comboChain = ref(0)
const phase = ref<PopPhase>('idle')
const feedback = ref(t('pop.idleTip'))
const poppingCellKeys = ref<string[]>([])
const lockBoard = ref(false)

let timer: ReturnType<typeof setInterval> | null = null
let comboTimer: ReturnType<typeof setTimeout> | null = null
let popTimer: ReturnType<typeof setTimeout> | null = null
let audioContext: AudioContext | null = null
let cellSequence = 0

const popBestScore = computed(() => progressStore.state.game.popBestScore)
const popPlays = computed(() => progressStore.state.game.popPlays)
// 记录每个cell的下落动画帧
const fallingMap = ref<Record<string, boolean>>({})

const flatCells = computed(() => {
  return board.value.flatMap((row, rowIndex) =>
    row.map((cell, colIndex) => ({
      cell,
      rowIndex,
      colIndex,
      falling: !!fallingMap.value[cell.id],
    })),
  )
})
const comboMultiplier = computed(() => {
  const rawMultiplier = 1 + Math.floor((comboChain.value - 1) / 2)
  return Math.max(1, Math.min(MAX_COMBO_MULTIPLIER, rawMultiplier))
})
const poppingCellKeySet = computed(() => new Set(poppingCellKeys.value))

const clearTimer = (): void => {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

const clearComboTimer = (): void => {
  if (!comboTimer) return
  clearTimeout(comboTimer)
  comboTimer = null
}

const clearPopTimer = (): void => {
  if (!popTimer) return
  clearTimeout(popTimer)
  popTimer = null
}

const nextCellId = (): string => {
  cellSequence += 1
  return `pop-${cellSequence}`
}

const randomColor = (): PopColor => {
  const index = Math.floor(Math.random() * COLOR_POOL.length)
  return COLOR_POOL[index] ?? 'coral'
}

const createCell = (): PopCell => {
  return {
    id: nextCellId(),
    color: randomColor(),
  }
}

const createBoard = (): PopCell[][] => {
  return Array.from({ length: BOARD_ROWS }, () =>
    Array.from({ length: BOARD_COLS }, () => createCell()),
  )
}

const isInsideBoard = (row: number, col: number): boolean => {
  return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS
}

const toPointKey = (row: number, col: number): string => `${row}:${col}`

const getAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null

  const AudioContextConstructor = window.AudioContext
  if (!AudioContextConstructor) return null

  if (!audioContext) {
    audioContext = new AudioContextConstructor()
  }

  if (audioContext.state === 'suspended') {
    void audioContext.resume()
  }

  return audioContext
}

const playTone = (
  context: AudioContext,
  frequency: number,
  options?: {
    duration?: number
    volume?: number
    waveform?: OscillatorType
    delay?: number
  },
): void => {
  const duration = options?.duration ?? 0.08
  const volume = options?.volume ?? 0.04
  const waveform = options?.waveform ?? 'triangle'
  const delay = options?.delay ?? 0

  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const startAt = context.currentTime + delay
  const endAt = startAt + duration

  oscillator.type = waveform
  oscillator.frequency.setValueAtTime(frequency, startAt)

  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, endAt)

  oscillator.connect(gain)
  gain.connect(context.destination)

  oscillator.start(startAt)
  oscillator.stop(endAt)
}

const playPopSound = (groupSize: number, multiplier: number): void => {
  const context = getAudioContext()
  if (!context) return

  const baseFrequency = 220 + groupSize * 18 + multiplier * 26
  playTone(context, baseFrequency, { waveform: 'triangle', duration: 0.09, volume: 0.045 })

  if (multiplier >= 2) {
    playTone(context, baseFrequency * 1.35, {
      waveform: 'sine',
      duration: 0.07,
      volume: 0.032,
      delay: 0.04,
    })
  }
}

const collectGroup = (startRow: number, startCol: number): PopPoint[] => {
  const startCell = board.value[startRow]?.[startCol]
  if (!startCell) return []

  const targetColor = startCell.color
  const result: PopPoint[] = []
  const stack: PopPoint[] = [{ row: startRow, col: startCol }]
  const visited = new Set<string>()

  while (stack.length > 0) {
    const point = stack.pop()
    if (!point) continue

    const key = toPointKey(point.row, point.col)
    if (visited.has(key)) continue
    visited.add(key)

    const current = board.value[point.row]?.[point.col]
    if (!current || current.color !== targetColor) continue

    result.push(point)

    const nextPoints: PopPoint[] = [
      { row: point.row - 1, col: point.col },
      { row: point.row + 1, col: point.col },
      { row: point.row, col: point.col - 1 },
      { row: point.row, col: point.col + 1 },
    ]

    for (const next of nextPoints) {
      if (!isInsideBoard(next.row, next.col)) continue
      stack.push(next)
    }
  }

  return result
}

const collapseAndRefillBoard = (removed: PopPoint[]): PopCell[][] => {
  const removedSet = new Set(removed.map((point) => toPointKey(point.row, point.col)))
  const nextBoard: Array<Array<PopCell | null>> = board.value.map((row, rowIndex) =>
    row.map((cell, colIndex) => (removedSet.has(toPointKey(rowIndex, colIndex)) ? null : cell)),
  )

  // 记录哪些cell需要下落动画
  const newFallingMap: Record<string, boolean> = {}

  for (let col = 0; col < BOARD_COLS; col += 1) {
    const kept: PopCell[] = []
    for (let row = BOARD_ROWS - 1; row >= 0; row -= 1) {
      const cell = nextBoard[row]?.[col]
      if (cell) kept.push(cell)
    }
    for (let row = BOARD_ROWS - 1, index = 0; row >= 0; row -= 1, index += 1) {
      const nextCell = kept[index] ?? null
      const rowCells = nextBoard[row]
      if (!rowCells) continue
      const currentCell = board.value[row]?.[col]
      if (nextCell && (!currentCell || currentCell.id !== nextCell.id)) {
        newFallingMap[nextCell.id] = true
      }
      rowCells[col] = nextCell
    }
  }

  for (let row = 0; row < BOARD_ROWS; row += 1) {
    for (let col = 0; col < BOARD_COLS; col += 1) {
      const rowCells = nextBoard[row]
      if (!rowCells) continue
      if (rowCells[col]) continue
      const newCell = createCell()
      rowCells[col] = newCell
      newFallingMap[newCell.id] = true
    }
  }

  // 动画帧只保留新下落的
  setTimeout(() => {
    fallingMap.value = {}
  }, 320)
  fallingMap.value = newFallingMap

  return nextBoard.map((row) => row.map((cell) => cell ?? createCell()))
}

const isCellPopping = (row: number, col: number): boolean => {
  return poppingCellKeySet.value.has(toPointKey(row, col))
}

const registerCombo = (): number => {
  comboChain.value += 1

  clearComboTimer()
  comboTimer = setTimeout(() => {
    comboChain.value = 0
  }, COMBO_WINDOW_MS)

  return comboMultiplier.value
}

const finishRound = (): void => {
  if (phase.value !== 'running') return
  clearTimer()
  clearComboTimer()
  clearPopTimer()
  comboChain.value = 0
  poppingCellKeys.value = []
  lockBoard.value = false
  phase.value = 'ended'
  feedback.value = t('pop.finished')
  progressStore.savePopRecord(score.value)
}

const startRound = (): void => {
  clearTimer()
  clearComboTimer()
  clearPopTimer()
  board.value = createBoard()
  score.value = 0
  secondsLeft.value = selectedRoundSeconds.value
  comboChain.value = 0
  poppingCellKeys.value = []
  lockBoard.value = false
  phase.value = 'running'
  feedback.value = t('pop.runningTip')

  timer = setInterval(() => {
    secondsLeft.value -= 1

    if (secondsLeft.value <= 0) {
      finishRound()
    }
  }, 1000)
}

const onSelectCell = (row: number, col: number): void => {
  if (phase.value !== 'running') return
  if (lockBoard.value) return

  // 检查是否无可消，自动打乱
  if (!hasAnyMatch(board.value)) {
    board.value = shuffleBoardUntilMatch(board.value)
    feedback.value = t('pop.shuffled')
    return
  }

  const group = collectGroup(row, col)
  if (group.length < MIN_POP_GROUP) {
    feedback.value = t('pop.needGroup', { min: MIN_POP_GROUP })
    return
  }

  const multiplier = registerCombo()
  const gained = Math.round(group.length * group.length * 3 * multiplier)
  score.value += gained
  feedback.value = t('pop.gained', { score: gained, multiplier })

  poppingCellKeys.value = group.map((point) => toPointKey(point.row, point.col))
  playPopSound(group.length, multiplier)

  lockBoard.value = true
  clearPopTimer()
  popTimer = setTimeout(() => {
    board.value = collapseAndRefillBoard(group)
    poppingCellKeys.value = []

    // 再次检测消除后是否无可消，自动打乱
    if (!hasAnyMatch(board.value)) {
      board.value = shuffleBoardUntilMatch(board.value)
      feedback.value = t('pop.shuffled')
    }

    lockBoard.value = false
    popTimer = null
  }, POP_ANIMATION_MS)
}

onBeforeUnmount(() => {
  clearTimer()
  clearComboTimer()
  clearPopTimer()

  if (audioContext) {
    void audioContext.close()
    audioContext = null
  }
})
</script>

<template>
  <section class="page-card">
    <h2 class="page-title">{{ t('pop.title') }}</h2>
    <p class="page-description">{{ t('pop.description') }}</p>

    <div class="grid cards-3" style="margin-bottom: 1rem">
      <div class="stat">
        <p class="stat-label">{{ t('pop.score') }}</p>
        <p class="stat-value">{{ score }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('pop.timeLeft') }}</p>
        <p class="stat-value">{{ secondsLeft }}s</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('pop.best') }} / {{ t('pop.plays') }}</p>
        <p class="stat-value">{{ popBestScore }} / {{ popPlays }}</p>
      </div>
    </div>

    <div class="toolbar" style="margin-bottom: 0.8rem">
      <span class="muted">{{ t('pop.duration') }}</span>
      <button
        v-for="duration in ROUND_DURATIONS"
        :key="duration"
        class="button"
        :class="{ primary: selectedRoundSeconds === duration }"
        type="button"
        :disabled="phase === 'running'"
        @click="selectedRoundSeconds = duration"
      >
        {{ duration }}s
      </button>

      <button class="button primary" type="button" @click="startRound">
        {{ phase === 'running' ? t('pop.restart') : t('pop.start') }}
      </button>
      <RouterLink to="/games" class="button ghost">{{ t('gamesHub.backToHub') }}</RouterLink>
      <span class="badge pop-combo" v-if="phase === 'running' && comboChain > 1">
        {{ t('pop.combo') }} x{{ comboMultiplier }}
      </span>
      <span class="badge" v-if="phase === 'ended'">{{ t('pop.finished') }}</span>
    </div>

    <p class="pop-feedback">{{ feedback }}</p>

    <p v-if="phase === 'idle'" class="empty-state">{{ t('pop.idleTip') }}</p>

    <div class="pop-board" :class="{ disabled: phase !== 'running' }" v-else>
      <button
        v-for="item in flatCells"
        :key="item.cell.id"
        class="pop-cell"
        :class="[
          `color-${item.cell.color}`,
          { popping: isCellPopping(item.rowIndex, item.colIndex), falling: item.falling },
        ]"
        :disabled="phase !== 'running' || lockBoard"
        type="button"
        @click="onSelectCell(item.rowIndex, item.colIndex)"
      >
        <span>{{ COLOR_ICON_MAP[item.cell.color] }}</span>
      </button>
    </div>
  </section>
</template>
