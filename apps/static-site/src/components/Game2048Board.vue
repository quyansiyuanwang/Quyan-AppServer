<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const size = 4
const board = ref<number[][]>(Array.from({ length: size }, () => Array(size).fill(0)))
const score = ref(0)

function getEmptyCells() {
  const cells: [number, number][] = []
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board.value[r]?.[c] === 0) cells.push([r, c])
    }
  }
  return cells
}

function addRandomTile() {
  const empties = getEmptyCells()
  if (empties.length === 0) return
  const cell = empties[Math.floor(Math.random() * empties.length)]
  if (!cell) return
  const [r, c] = cell
  const row = board.value[r]
  if (!row) return
  row[c] = Math.random() < 0.9 ? 2 : 4
}

function reset() {
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const row = board.value[r]
      if (row) row[c] = 0
    }
  }
  score.value = 0
  addRandomTile()
  addRandomTile()
}

reset()

function slide(row: number[]): number[] {
  const arr = row.filter((x) => x)
  for (let i = 0; i < arr.length - 1; i++) {
    const current = arr[i]
    const next = arr[i + 1]
    if (current && next && current === next) {
      arr[i] = current * 2
      score.value += arr[i] ?? 0
      arr[i + 1] = 0
    }
  }
  return arr.filter((x) => x).concat(Array(size - arr.filter((x) => x).length).fill(0))
}

function moveLeft() {
  let moved = false
  for (let r = 0; r < size; r++) {
    const row = board.value[r]
    if (!row) continue
    const newRow = slide(row)
    if (newRow.join() !== row.join()) moved = true
    board.value[r] = newRow
  }
  if (moved) addRandomTile()
}

function rotateBoard(times: number) {
  for (let t = 0; t < times; t++) {
    const newBoard = Array.from({ length: size }, () => Array(size).fill(0))
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const sourceRow = board.value[r]
        const targetRow = newBoard[c]
        if (sourceRow && targetRow) {
          targetRow[size - 1 - r] = sourceRow[c] ?? 0
        }
      }
    }
    board.value = newBoard
  }
}

function move(dir: 'left' | 'right' | 'up' | 'down') {
  // 标准2048方向
  if (dir === 'left') moveLeft()
  else if (dir === 'right') {
    rotateBoard(2)
    moveLeft()
    rotateBoard(2)
  } else if (dir === 'up') {
    rotateBoard(3)
    moveLeft()
    rotateBoard(1)
  } else if (dir === 'down') {
    rotateBoard(1)
    moveLeft()
    rotateBoard(3)
  }
}

function handleKey(e: KeyboardEvent) {
  if (e.key === 'ArrowLeft') move('left')
  else if (e.key === 'ArrowRight') move('right')
  else if (e.key === 'ArrowUp') move('up')
  else if (e.key === 'ArrowDown') move('down')
}

// 移动端触摸滑动支持
let touchStartX = 0,
  touchStartY = 0,
  touchEndX = 0,
  touchEndY = 0
function handleTouchStart(e: TouchEvent) {
  const touch = e.touches[0]
  if (e.touches.length !== 1 || !touch) return
  touchStartX = touch.clientX
  touchStartY = touch.clientY
}
function handleTouchMove(e: TouchEvent) {
  const touch = e.touches[0]
  if (e.touches.length !== 1 || !touch) return
  touchEndX = touch.clientX
  touchEndY = touch.clientY
}
function handleTouchEnd() {
  const dx = touchEndX - touchStartX
  const dy = touchEndY - touchStartY
  if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return
  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > 0) move('right')
    else move('left')
  } else {
    if (dy > 0) move('down')
    else move('up')
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKey)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKey)
})
</script>
<template>
  <div class="board-wrap">
    <div class="score">分数：{{ score }}</div>
    <div
      class="board"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
    >
      <div v-for="(row, r) in board" :key="r" class="board-row">
        <div
          v-for="(cell, c) in row"
          :key="`${r}-${c}`"
          class="cell"
          :class="['cell-' + cell, { nonzero: cell !== 0 }]"
        >
          <span v-if="cell !== 0">{{ cell }}</span>
        </div>
      </div>
    </div>
    <button class="reset-btn" @click="reset">重新开始</button>
  </div>
</template>
<style scoped>
.board-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.score {
  margin-bottom: 1rem;
  font-weight: bold;
}

.board {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  background: #bbada0;
  padding: 8px;
  border-radius: 12px;
  width: 360px;
}

.board-row {
  display: contents;
}

.cell {
  background: #cdc1b4;
  color: #333;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  border-radius: 6px;
  font-weight: bold;
  transition:
    background 0.16s,
    transform 0.18s,
    opacity 0.18s;
  aspect-ratio: 1 / 1;
  width: 100%;
}

.cell.nonzero {
  animation: tile-appear 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes tile-appear {
  0% {
    transform: scale(0.6);
    opacity: 0;
  }
  60% {
    transform: scale(1.08);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.cell-2 {
  background: #eee4da;
}
.cell-4 {
  background: #ede0c8;
}
.cell-8 {
  background: #f2b179;
  color: #fff;
}
.cell-16 {
  background: #f59563;
  color: #fff;
}
.cell-32 {
  background: #f67c5f;
  color: #fff;
}
.cell-64 {
  background: #f65e3b;
  color: #fff;
}
.cell-128 {
  background: #edcf72;
  color: #fff;
}
.cell-256 {
  background: #edcc61;
  color: #fff;
}
.cell-512 {
  background: #edc850;
  color: #fff;
}
.cell-1024 {
  background: #edc53f;
  color: #fff;
}
.cell-2048 {
  background: #edc22e;
  color: #fff;
}

.reset-btn {
  margin-top: 1.2rem;
  padding: 0.4rem 1.2rem;
  border: none;
  background: #8f7a66;
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
}

@media (max-width: 600px) {
  .board {
    width: min(92vw, 360px);
    padding: 3vw;
    border-radius: 8px;
    gap: 3vw;
  }
  .cell {
    border-radius: 4vw;
    font-size: 1.1rem;
  }
  .score {
    font-size: 1rem;
  }
  .reset-btn {
    width: 90vw;
    max-width: 340px;
    margin: 1rem auto 0 auto;
    display: block;
  }
}
</style>
