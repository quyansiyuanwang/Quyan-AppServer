<script setup lang="ts">
import { ref } from 'vue'

const ROWS = 10
const COLS = 10
const MINES = 15

interface Cell {
  mine: boolean
  revealed: boolean
  flagged: boolean
  count: number
}

function createCell(): Cell {
  return { mine: false, revealed: false, flagged: false, count: 0 }
}

const board = ref<Cell[][]>([])
const gameOver = ref(false)
const win = ref(false)
const flags = ref(0)

function init() {
  // 初始化棋盘
  board.value = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, createCell))
  gameOver.value = false
  win.value = false
  flags.value = 0
  // 随机埋雷
  let mines = 0
  while (mines < MINES) {
    const r = Math.floor(Math.random() * ROWS)
    const c = Math.floor(Math.random() * COLS)
    const cell = board.value[r]?.[c]
    if (cell && !cell.mine) {
      cell.mine = true
      mines++
    }
  }
  // 计算数字
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board.value[r]?.[c]
      if (!cell || cell.mine) continue
      let count = 0
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const nr = r + dr,
            nc = c + dc
          const neighbor = board.value[nr]?.[nc]
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && neighbor?.mine) count++
        }
      }
      cell.count = count
    }
  }
}

function reveal(r: number, c: number) {
  const cell = board.value[r]?.[c]
  if (!cell || gameOver.value || cell.flagged || cell.revealed) return
  cell.revealed = true
  if (cell.mine) {
    gameOver.value = true
    revealAll()
    return
  }
  if (cell.count === 0) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        const nr = r + dr,
          nc = c + dc
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) reveal(nr, nc)
      }
    }
  }
  checkWin()
}

function revealAll() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board.value[r]?.[c]
      if (cell) cell.revealed = true
    }
  }
}

function toggleFlag(r: number, c: number, e: Event) {
  e.preventDefault()
  const cell = board.value[r]?.[c]
  if (!cell || gameOver.value || cell.revealed) return
  cell.flagged = !cell.flagged
  flags.value += cell.flagged ? 1 : -1
  checkWin()
}

function checkWin() {
  let unrevealed = 0
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board.value[r]?.[c]
      if (cell && !cell.revealed && !cell.mine) unrevealed++
    }
  }
  if (unrevealed === 0 && !gameOver.value) win.value = true
}

init()
</script>
<template>
  <div class="minesweeper-wrap">
    <div class="minesweeper-info">
      <span>🚩 {{ flags }} / {{ MINES }}</span>
      <span v-if="gameOver" class="fail">💥 游戏失败</span>
      <span v-else-if="win" class="win">🎉 恭喜通关</span>
      <button @click="init">重开</button>
    </div>
    <div class="minesweeper-board">
      <div v-for="(row, r) in board" :key="r" class="minesweeper-row">
        <div
          v-for="(cell, c) in row"
          :key="c"
          class="minesweeper-cell"
          :class="{
            revealed: cell.revealed,
            mine: cell.mine && cell.revealed,
            flagged: cell.flagged,
            'cell-anim': cell.revealed || cell.flagged,
          }"
          @click="reveal(r, c)"
          @contextmenu="toggleFlag(r, c, $event)"
        >
          <transition name="cell-reveal" mode="out-in">
            <span v-if="cell.flagged && !cell.revealed" key="flag">🚩</span>
            <span v-else-if="cell.mine && cell.revealed" key="mine">💣</span>
            <span v-else-if="cell.revealed && cell.count > 0" key="count">{{ cell.count }}</span>
          </transition>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>
.minesweeper-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.minesweeper-info {
  margin-bottom: 1rem;
  display: flex;
  gap: 1.2rem;
  align-items: center;
}
.minesweeper-info button {
  margin-left: 1rem;
  padding: 0.2rem 0.8rem;
  border: none;
  background: #8f7a66;
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
}
.minesweeper-board {
  background: #bbb;
  padding: 8px;
  border-radius: 8px;
}
.minesweeper-row {
  display: flex;
}
.minesweeper-cell {
  width: 28px;
  height: 28px;
  background: #ccc;
  border: 1px solid #aaa;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  font-weight: bold;
  cursor: pointer;
  user-select: none;
  transition:
    background 0.25s,
    color 0.25s,
    box-shadow 0.18s;
}
.minesweeper-cell.revealed {
  background: #e0e0e0;
  cursor: default;
  animation: cell-pop 0.28s cubic-bezier(0.42, 1.7, 0.58, 1) 1;
}
.minesweeper-cell.mine {
  background: #e57373;
  color: #fff;
  animation: cell-bang 0.32s cubic-bezier(0.42, 1.7, 0.58, 1) 1;
}
.minesweeper-cell.flagged {
  background: #ffe082;
  animation: cell-flag 0.22s cubic-bezier(0.42, 1.7, 0.58, 1) 1;
}
.cell-anim {
  will-change: background, color, box-shadow, transform;
}
@keyframes cell-pop {
  0% {
    box-shadow: 0 0 0 0 #bdbdbd;
    transform: scale(0.7);
  }
  80% {
    box-shadow: 0 0 8px 2px #bdbdbd;
    transform: scale(1.08);
  }
  100% {
    box-shadow: 0 0 0 0 #bdbdbd;
    transform: scale(1);
  }
}
@keyframes cell-bang {
  0% {
    background: #fff;
    color: #e57373;
    transform: scale(1.2) rotate(0deg);
  }
  60% {
    background: #e57373;
    color: #fff;
    transform: scale(1.05) rotate(10deg);
  }
  100% {
    background: #e57373;
    color: #fff;
    transform: scale(1) rotate(0deg);
  }
}
@keyframes cell-flag {
  0% {
    background: #fffbe6;
    transform: scale(0.7);
  }
  80% {
    background: #ffe082;
    transform: scale(1.1);
  }
  100% {
    background: #ffe082;
    transform: scale(1);
  }
}
.cell-reveal-enter-active,
.cell-reveal-leave-active {
  transition:
    opacity 0.22s,
    transform 0.22s;
}
.cell-reveal-enter-from,
.cell-reveal-leave-to {
  opacity: 0;
  transform: scale(0.7);
}
.fail {
  color: #e74c3c;
  font-weight: bold;
}
.win {
  color: #27ae60;
  font-weight: bold;
}
@media (max-width: 600px) {
  .minesweeper-board {
    padding: 2vw;
  }
  .minesweeper-cell {
    width: 8vw;
    height: 8vw;
    min-width: 22px;
    min-height: 22px;
    font-size: 1rem;
  }
}
</style>
