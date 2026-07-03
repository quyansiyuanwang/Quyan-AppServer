<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'

const ROWS = 20
const COLS = 10
const TICK_MS = 600
const SOFT_TICK_MS = 80

// Tetromino shapes (4x4 matrices)
const SHAPES: Record<string, number[][][]> = {
  I: [
    [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 1, 0],
      [0, 0, 1, 0],
      [0, 0, 1, 0],
      [0, 0, 1, 0],
    ],
  ],
  O: [
    [
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  ],
  T: [
    [
      [0, 1, 0, 0],
      [1, 1, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 0, 0],
      [0, 1, 1, 0],
      [0, 1, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 0, 0],
      [1, 1, 1, 0],
      [0, 1, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 0, 0],
      [1, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 0, 0],
    ],
  ],
  L: [
    [
      [0, 0, 1, 0],
      [1, 1, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 0, 0],
      [1, 1, 1, 0],
      [1, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [1, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 0, 0],
    ],
  ],
  J: [
    [
      [1, 0, 0, 0],
      [1, 1, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 1, 0],
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 0, 0],
      [1, 1, 1, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [1, 1, 0, 0],
      [0, 0, 0, 0],
    ],
  ],
  S: [
    [
      [0, 1, 1, 0],
      [1, 1, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 0, 0],
      [0, 1, 1, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 0],
    ],
  ],
  Z: [
    [
      [1, 1, 0, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 1, 0],
      [0, 1, 1, 0],
      [0, 1, 0, 0],
      [0, 0, 0, 0],
    ],
  ],
}

const COLORS = ['#6C9EF8', '#F59C8A', '#FFD479', '#B6E3A8', '#C19BF5', '#FF9BDA', '#8BD6D1']

function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0))
}

const grid = ref<number[][]>(emptyBoard())
const score = ref(0)
const current = ref({ shape: 'T', rot: 0, r: 0, c: 3 })
const nextPiece = ref({ shape: '', rot: 0 })
let rafId: number | null = null
let lastTime = 0
let accumulator = 0
let currentGravity = TICK_MS
const running = ref(true)
let softActive = false
let moveRepeatTimeout: any = null
let moveRepeatInterval: any = null
let moveRepeatDir: 'left' | 'right' | null = null
const pressedLeft = ref(false)
const pressedRight = ref(false)
const pressedDown = ref(false)
const pressedRotate = ref(false)
const pressedDrop = ref(false)

const previewMatrix = computed(() => {
  const keys = Object.keys(SHAPES)
  const defaultShape = keys.length ? keys[0] : 'T'
  const shape = (nextPiece.value.shape || defaultShape) as string
  const rot = (nextPiece.value.rot || 0) as number
  const mat = getMatrixFor(shape, rot)
  return mat
})

const previewColor = computed(() => {
  const keys = Object.keys(SHAPES)
  const defaultShape = keys.length ? keys[0] : 'T'
  const shapeName = (nextPiece.value.shape || defaultShape) as string
  const idx = keys.indexOf(shapeName)
  if (idx < 0) return 'transparent'
  return COLORS[idx % COLORS.length]
})

const PREVIEW_SIZE = 96
const PREVIEW_GAP = 4
const PREVIEW_COUNT = 4
const previewTileSize = Math.floor(
  (PREVIEW_SIZE - PREVIEW_GAP * (PREVIEW_COUNT - 1)) / PREVIEW_COUNT,
)
const previewOffset = Math.round(
  (PREVIEW_SIZE - (previewTileSize * PREVIEW_COUNT + PREVIEW_GAP * (PREVIEW_COUNT - 1))) / 2,
)

function randShape(): string {
  const keys = Object.keys(SHAPES)
  if (!keys.length) return 'T'
  return keys[Math.floor(Math.random() * keys.length)] as string
}

// 初始化下一个方块
nextPiece.value.shape = randShape()

function spawn() {
  // 使用 nextPiece 作为当前方块，并生成新的 nextPiece
  const shapeToSpawn = nextPiece.value.shape || randShape()
  current.value.shape = shapeToSpawn
  current.value.rot = 0
  current.value.r = 0
  current.value.c = 3
  nextPiece.value.shape = randShape()
  nextPiece.value.rot = 0
  console.debug('[TETRIS] spawn', {
    shape: current.value.shape,
    rot: current.value.rot,
    r: current.value.r,
    c: current.value.c,
    next: nextPiece.value.shape,
  })
  if (collides(current.value)) {
    // game over -> reset
    console.debug('[TETRIS] spawn collided - game over, resetting')
    grid.value = emptyBoard()
    score.value = 0
  }
}

function getMatrixFor(shapeName: string, rot: number): number[][] {
  const arr = SHAPES[shapeName]
  if (!arr || arr.length === 0)
    return [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]
  const idx = rot % arr.length
  return (
    arr[idx] ?? [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]
  )
}

function collides(piece: any) {
  const mat = getMatrixFor(piece.shape as string, piece.rot as number)
  for (let rr = 0; rr < 4; rr++) {
    for (let cc = 0; cc < 4; cc++) {
      const matRow = mat[rr]
      if (!matRow || !matRow[cc]) continue
      const r = piece.r + rr
      const c = piece.c + cc
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return true
      if (grid.value[r] && grid.value[r][c]) return true
    }
  }
  return false
}

function lockPiece() {
  const mat = getMatrixFor(current.value.shape as string, current.value.rot as number)
  for (let rr = 0; rr < 4; rr++) {
    for (let cc = 0; cc < 4; cc++) {
      const matRow = mat[rr]
      if (!matRow || !matRow[cc]) continue
      const r = current.value.r + rr
      const c = current.value.c + cc
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS)
        (grid.value[r] as number[])[c] =
          1 + (Object.keys(SHAPES).indexOf(current.value.shape as string) % COLORS.length)
    }
  }
  console.debug('[TETRIS] lockPiece', {
    shape: current.value.shape,
    r: current.value.r,
    c: current.value.c,
  })
  clearLines()
  spawn()
}

function clearLines() {
  const newGrid: number[][] = []
  let cleared = 0
  for (let r = 0; r < ROWS; r++) {
    const row = grid.value[r] ?? Array(COLS).fill(0)
    if (row.every((v) => v !== 0)) {
      cleared++
    } else {
      newGrid.push(row)
    }
  }
  while (newGrid.length < ROWS) newGrid.unshift(Array(COLS).fill(0))
  if (cleared) {
    score.value += cleared * 100
  }
  grid.value = newGrid
}

function step() {
  if (!running.value) return
  current.value.r += 1
  if (collides(current.value)) {
    current.value.r -= 1
    lockPiece()
  }
}

function loop(ts: number) {
  if (!running.value) {
    rafId = null
    return
  }
  if (!lastTime) lastTime = ts
  const delta = ts - lastTime
  lastTime = ts
  accumulator += delta
  while (accumulator >= currentGravity) {
    step()
    accumulator -= currentGravity
  }
  rafId = requestAnimationFrame(loop)
}

function startTick() {
  stopTick()
  lastTime = 0
  accumulator = 0
  rafId = requestAnimationFrame(loop)
}

function stopTick() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  lastTime = 0
  accumulator = 0
}

function setGravity(ms: number) {
  currentGravity = ms
}

function softDropStart() {
  softActive = true
  setGravity(SOFT_TICK_MS)
}

function softDropEnd() {
  softActive = false
  setGravity(TICK_MS)
}

function moveLeft() {
  current.value.c -= 1
  if (collides(current.value)) current.value.c += 1
}
function moveRight() {
  current.value.c += 1
  if (collides(current.value)) current.value.c -= 1
}
function rotate() {
  const shapeArr = SHAPES[current.value.shape as string] || []
  const len = shapeArr.length || 1
  current.value.rot = (current.value.rot + 1) % len
  if (collides(current.value)) current.value.rot = (current.value.rot - 1 + len) % len
}
function softDrop() {
  step()
}
function hardDrop() {
  while (!collides(current.value)) current.value.r += 1
  current.value.r -= 1
  lockPiece()
}

function renderBoard() {
  const out = emptyBoard()
  // copy locked
  for (let r = 0; r < ROWS; r++) {
    const row = grid.value[r] ?? Array(COLS).fill(0)
    for (let c = 0; c < COLS; c++) (out[r] as number[])[c] = row[c] ?? 0
  }
  // draw current piece
  const mat = getMatrixFor(current.value.shape as string, current.value.rot as number)
  for (let rr = 0; rr < 4; rr++)
    for (let cc = 0; cc < 4; cc++) {
      const matRow = mat[rr]
      if (!matRow || !matRow[cc]) continue
      const r = current.value.r + rr
      const c = current.value.c + cc
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS)
        (out[r] as number[])[c] =
          1 + (Object.keys(SHAPES).indexOf(current.value.shape as string) % COLORS.length)
    }
  return out
}

function handleKey(e: KeyboardEvent) {
  const k = e.key
  // e.code is more consistent for space key on some platforms
  const code = (e as any).code
  if (k === 'ArrowLeft' || code === 'ArrowLeft') startMoveRepeat('left')
  else if (k === 'ArrowRight' || code === 'ArrowRight') startMoveRepeat('right')
  else if (k === 'ArrowUp' || code === 'ArrowUp') rotate()
  else if (k === 'ArrowDown' || code === 'ArrowDown') softDropStart()
  else if (k === ' ' || k === 'Spacebar' || code === 'Space') hardDrop()
}

function handleKeyUp(e: KeyboardEvent) {
  const k = e.key
  const code = (e as any).code
  if (k === 'ArrowDown' || code === 'ArrowDown') softDropEnd()
  if (k === 'ArrowLeft' || code === 'ArrowLeft' || k === 'ArrowRight' || code === 'ArrowRight')
    stopMoveRepeat()
}

function startMoveRepeat(dir: 'left' | 'right') {
  if (moveRepeatDir === dir) return
  stopMoveRepeat()
  moveRepeatDir = dir
  if (dir === 'left') moveLeft()
  else moveRight()
  moveRepeatTimeout = setTimeout(() => {
    moveRepeatInterval = setInterval(() => {
      if (dir === 'left') moveLeft()
      else moveRight()
    }, 80)
  }, 160)
}

function stopMoveRepeat() {
  if (moveRepeatTimeout) {
    clearTimeout(moveRepeatTimeout)
    moveRepeatTimeout = null
  }
  if (moveRepeatInterval) {
    clearInterval(moveRepeatInterval)
    moveRepeatInterval = null
  }
  moveRepeatDir = null
  // reset pressed states to avoid stuck UI/logic
  pressedLeft.value = false
  pressedRight.value = false
  pressedDown.value = false
  pressedRotate.value = false
  pressedDrop.value = false
}

function vibrate(ms = 8) {
  try {
    if (navigator?.vibrate) navigator.vibrate(ms)
  } catch {
    /* ignore */
  }
}

function handleVisibilityChange() {
  if (document.hidden) stopMoveRepeat()
}

function controlDownLeft() {
  pressedLeft.value = true
  vibrate()
  startMoveRepeat('left')
}
function controlUpLeft() {
  pressedLeft.value = false
  stopMoveRepeat()
}
function controlDownRight() {
  pressedRight.value = true
  vibrate()
  startMoveRepeat('right')
}
function controlUpRight() {
  pressedRight.value = false
  stopMoveRepeat()
}
function controlDownRotate() {
  pressedRotate.value = true
  vibrate()
  rotate()
}
function controlUpRotate() {
  pressedRotate.value = false
}
function controlDownDown() {
  pressedDown.value = true
  vibrate()
  softDropStart()
}
function controlUpDown() {
  pressedDown.value = false
  softDropEnd()
}
function controlDownDrop() {
  pressedDrop.value = true
  vibrate()
  hardDrop()
  setTimeout(() => (pressedDrop.value = false), 120)
}

function togglePause() {
  running.value = !running.value
  if (running.value) startTick()
  else stopTick()
}

// touch controls simple overlay handled in template

onMounted(() => {
  spawn()
  startTick()
  window.addEventListener('keydown', handleKey)
  window.addEventListener('keyup', handleKeyUp)
  // ensure we clear repeat moves when pointer is released anywhere or window loses focus
  window.addEventListener('pointerup', stopMoveRepeat)
  window.addEventListener('pointercancel', stopMoveRepeat)
  window.addEventListener('blur', stopMoveRepeat)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})
onUnmounted(() => {
  stopTick()
  stopMoveRepeat()
  window.removeEventListener('keydown', handleKey)
  window.removeEventListener('keyup', handleKeyUp)
  window.removeEventListener('pointerup', stopMoveRepeat)
  window.removeEventListener('pointercancel', stopMoveRepeat)
  window.removeEventListener('blur', stopMoveRepeat)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div class="tetris-wrap">
    <div class="tetris-info">
      <div>分数：{{ score }}</div>
      <div class="controls">
        <button
          :class="{ active: pressedLeft }"
          @pointerdown.prevent="controlDownLeft"
          @pointerup.prevent="controlUpLeft"
          @pointerleave.prevent="controlUpLeft"
        >
          ◀
        </button>
        <button
          :class="{ active: pressedRotate }"
          @pointerdown.prevent="controlDownRotate"
          @pointerup.prevent="controlUpRotate"
        >
          ⟳
        </button>
        <button
          :class="{ active: pressedRight }"
          @pointerdown.prevent="controlDownRight"
          @pointerup.prevent="controlUpRight"
          @pointerleave.prevent="controlUpRight"
        >
          ▶
        </button>
        <button
          @pointerdown.prevent="softDropStart"
          @pointerup.prevent="softDropEnd"
          @pointerleave.prevent="softDropEnd"
          @click="softDrop"
        >
          ▼
        </button>
        <button @click="togglePause">{{ running ? '暂停' : '继续' }}</button>
      </div>
      <div class="next-preview" aria-hidden="true">
        <div class="preview-title">下一个</div>
        <div class="preview-grid">
          <svg
            class="preview-svg"
            :width="PREVIEW_SIZE"
            :height="PREVIEW_SIZE"
            :viewBox="`0 0 ${PREVIEW_SIZE} ${PREVIEW_SIZE}`"
            preserveAspectRatio="xMidYMid meet"
          >
            <template v-for="(row, rr) in previewMatrix">
              <rect
                v-for="(cell, cc) in row"
                :key="`${rr}-${cc}`"
                :x="previewOffset + cc * (previewTileSize + PREVIEW_GAP)"
                :y="previewOffset + rr * (previewTileSize + PREVIEW_GAP)"
                :width="previewTileSize"
                :height="previewTileSize"
                :rx="4"
                :fill="cell ? previewColor : 'transparent'"
              />
            </template>
          </svg>
        </div>
      </div>
    </div>

    <div class="tetris-debug" aria-hidden="true">
      current: {{ current.shape }} rot:{{ current.rot }} pos:{{ current.r }},{{ current.c }} — next:
      {{ nextPiece.shape }}
    </div>

    <div class="tetris-board" role="grid" :style="{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }">
      <div
        v-for="(cell, idx) in renderBoard().flat()"
        :key="idx"
        class="tetris-cell"
        :style="{ background: cell ? COLORS[cell - 1] : 'transparent' }"
      ></div>
    </div>

    <div class="mobile-controls" aria-hidden="true">
      <button
        class="mc-left"
        :class="{ active: pressedLeft }"
        @pointerdown.prevent="controlDownLeft"
        @pointerup.prevent="controlUpLeft"
        @pointerleave.prevent="controlUpLeft"
      >
        ◀
      </button>
      <button
        class="mc-rotate"
        :class="{ active: pressedRotate }"
        @pointerdown.prevent="controlDownRotate"
        @pointerup.prevent="controlUpRotate"
      >
        ⟳
      </button>
      <button
        class="mc-right"
        :class="{ active: pressedRight }"
        @pointerdown.prevent="controlDownRight"
        @pointerup.prevent="controlUpRight"
        @pointerleave.prevent="controlUpRight"
      >
        ▶
      </button>
      <button
        class="mc-down"
        :class="{ active: pressedDown }"
        @pointerdown.prevent="controlDownDown"
        @pointerup.prevent="controlUpDown"
        @pointerleave.prevent="controlUpDown"
      >
        ▼
      </button>
      <button
        class="mc-drop"
        :class="{ active: pressedDrop }"
        @pointerdown.prevent="controlDownDrop"
      >
        ⤓
      </button>
    </div>
  </div>
</template>

<style scoped>
.tetris-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.tetris-info {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.6rem;
}
.controls button {
  margin-left: 0.4rem;
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
  border: none;
  background: #8f7a66;
  color: #fff;
}
.tetris-board {
  background: #111;
  padding: 6px;
  border-radius: 8px;
  width: min(60vw, 420px);
  display: grid;
  gap: 4px;
}
.tetris-cell {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  transition:
    background 0.12s,
    transform 0.12s;
  aspect-ratio: 1 / 1;
  width: 100%;
}
.tetris-cell:hover {
  transform: translateY(-4%);
}
.next-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-left: 8px;
}
.preview-grid {
  background: #222;
  padding: 8px;
  border-radius: 6px;
  width: 96px;
  height: 96px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview-svg {
  display: block;
}
@media (max-width: 600px) {
  .tetris-board {
    padding: 3vw;
    width: min(92vw, 360px);
  }
  .tetris-row {
    gap: 2vw;
  }
  .tetris-cell {
    aspect-ratio: 1/1;
  }
  .controls button {
    padding: 0.6rem;
  }
  .next-preview {
    display: none;
  }
}

.tetris-debug {
  margin: 8px 0;
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.9rem;
}

/* Mobile control bar shown on small screens */
.mobile-controls {
  display: none;
  position: relative;
  gap: 8px;
  margin-top: 12px;
}
.mobile-controls button {
  padding: 0.8rem 1rem;
  border-radius: 12px;
  border: none;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.48), rgba(0, 0, 0, 0.6));
  color: #fff;
  font-size: 1.1rem;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
  min-width: 48px;
}
.mobile-controls button.active {
  transform: translateY(2px) scale(0.98);
  box-shadow: inset 0 3px 10px rgba(0, 0, 0, 0.28);
  opacity: 0.95;
}
.controls button.active {
  transform: translateY(2px) scale(0.98);
}
@media (max-width: 700px) {
  .mobile-controls {
    display: flex;
    justify-content: space-around;
    width: 100%;
    padding: 0 6vw;
  }
  .controls {
    display: none;
  }
}
</style>
