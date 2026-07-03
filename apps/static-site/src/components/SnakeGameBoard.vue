<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const ROWS = 20
const COLS = 20
const INIT_SNAKE: [number, number][] = [
  [10, 8],
  [10, 9],
  [10, 10],
]
const INIT_DIR = 'right'
const SPEED = 120

const snake = ref<[number, number][]>([...INIT_SNAKE])
const dir = ref(INIT_DIR)
const food = ref<[number, number]>([5, 5])
const alive = ref(true)
const score = ref(0)
let timer: any = null

function reset() {
  snake.value = [...INIT_SNAKE]
  dir.value = INIT_DIR
  placeFood()
  alive.value = true
  score.value = 0
}

function placeFood() {
  while (true) {
    const r = Math.floor(Math.random() * ROWS)
    const c = Math.floor(Math.random() * COLS)
    if (!snake.value.some(([sr, sc]) => sr === r && sc === c)) {
      food.value = [r, c]
      break
    }
  }
}

function step() {
  if (!alive.value) return
  const head = snake.value[snake.value.length - 1]
  if (!head) return
  let [r, c] = head
  if (dir.value === 'up') r--
  else if (dir.value === 'down') r++
  else if (dir.value === 'left') c--
  else if (dir.value === 'right') c++
  // 撞墙或撞自己
  if (
    r < 0 ||
    r >= ROWS ||
    c < 0 ||
    c >= COLS ||
    snake.value.some(([sr, sc]) => sr === r && sc === c)
  ) {
    alive.value = false
    return
  }
  snake.value.push([r, c])
  const foodR = food.value[0]
  const foodC = food.value[1]
  if (foodR !== undefined && foodC !== undefined && r === foodR && c === foodC) {
    score.value++
    placeFood()
  } else {
    snake.value.shift()
  }
}

function handleKey(e: KeyboardEvent) {
  if (!alive.value) return
  if (e.key === 'ArrowUp' && dir.value !== 'down') dir.value = 'up'
  else if (e.key === 'ArrowDown' && dir.value !== 'up') dir.value = 'down'
  else if (e.key === 'ArrowLeft' && dir.value !== 'right') dir.value = 'left'
  else if (e.key === 'ArrowRight' && dir.value !== 'left') dir.value = 'right'
}

onMounted(() => {
  reset()
  timer = setInterval(step, SPEED)
  window.addEventListener('keydown', handleKey)
})
onUnmounted(() => {
  clearInterval(timer)
  window.removeEventListener('keydown', handleKey)
})
</script>
<template>
  <div class="snake-wrap">
    <div class="score">分数：{{ score }}</div>
    <div class="snake-board">
      <div v-for="r in ROWS" :key="r" class="snake-row">
        <div
          v-for="c in COLS"
          :key="c"
          class="snake-cell"
          :class="{
            snake: snake.some(([sr, sc]) => sr === r - 1 && sc === c - 1),
            head: snake[snake.length - 1]?.[0] === r - 1 && snake[snake.length - 1]?.[1] === c - 1,
            food: food[0] === r - 1 && food[1] === c - 1,
          }"
        ></div>
      </div>
    </div>
    <div v-if="!alive" class="snake-over">游戏结束！<button @click="reset">重来</button></div>
  </div>
</template>
<style scoped>
.snake-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.score {
  margin-bottom: 1rem;
  font-weight: bold;
}
.snake-board {
  display: grid;
  grid-template-rows: repeat(20, 1fr);
  background: #222;
  border-radius: 8px;
}
.snake-row {
  display: grid;
  grid-template-columns: repeat(20, 1fr);
}
.snake-cell {
  width: 18px;
  height: 18px;
  background: #333;
  border: 1px solid #222;
}
.snake-cell.snake {
  background: #6ab04c;
}
.snake-cell.head {
  background: #218c5a;
}
.snake-cell.food {
  background: #f6e58d;
}
.snake-over {
  margin-top: 1rem;
  color: #e74c3c;
  font-weight: bold;
}
.snake-over button {
  margin-left: 1rem;
  padding: 0.2rem 0.8rem;
  border: none;
  background: #8f7a66;
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
}
</style>
