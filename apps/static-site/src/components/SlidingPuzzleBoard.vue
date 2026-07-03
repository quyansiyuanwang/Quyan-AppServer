<script setup lang="ts">
import { ref } from 'vue'

const SIZE = 4

function createBoard() {
  const arr = Array.from({ length: SIZE * SIZE }, (_, i) => i)
  // shuffle until solvable
  do {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const temp = arr[i]
      const swap = arr[j]
      if (temp !== undefined && swap !== undefined) {
        arr[i] = swap
        arr[j] = temp
      }
    }
  } while (!isSolvable(arr))
  const board: number[][] = []
  for (let r = 0; r < SIZE; r++) board.push(arr.slice(r * SIZE, r * SIZE + SIZE))
  return board
}

function isSolvable(arr: number[]) {
  // count inversions ignoring zero (0 is blank)
  const copy = arr.slice()
  const blankRow = Math.floor(copy.indexOf(0) / SIZE)
  let inv = 0
  const list = copy.filter((x) => x !== 0)
  for (let i = 0; i < list.length; i++) {
    const vi = list[i]
    if (vi === undefined) continue
    for (let j = i + 1; j < list.length; j++) {
      const vj = list[j]
      if (vj !== undefined && vi > vj) inv++
    }
  }
  if (SIZE % 2 === 1) return inv % 2 === 0
  // blank on row from bottom
  const blankFromBottom = SIZE - blankRow
  return (inv + blankFromBottom) % 2 === 0
}

const board = ref<number[][]>(createBoard())
const moves = ref(0)
const solved = ref(false)
const movedTiles = ref<string[]>([])
const tileImages = ref<string[]>(Array(SIZE * SIZE).fill(''))
const imagePreview = ref('')

function onFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => generateTileImages(img)
    img.src = reader.result as string
  }
  reader.readAsDataURL(f)
}

function clearImages() {
  tileImages.value = Array(SIZE * SIZE).fill('')
  imagePreview.value = ''
}

function generateTileImages(img: HTMLImageElement) {
  const canvasSize = 512
  const tileSize = Math.floor(canvasSize / SIZE)
  const main = document.createElement('canvas')
  main.width = canvasSize
  main.height = canvasSize
  const mctx = main.getContext('2d')!
  // center-crop to square
  const sSize = Math.min(img.width, img.height)
  const sx = Math.floor((img.width - sSize) / 2)
  const sy = Math.floor((img.height - sSize) / 2)
  mctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, canvasSize, canvasSize)
  const slices: string[] = []
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const tc = document.createElement('canvas')
      tc.width = tileSize
      tc.height = tileSize
      const tctx = tc.getContext('2d')!
      tctx.drawImage(main, c * tileSize, r * tileSize, tileSize, tileSize, 0, 0, tileSize, tileSize)
      slices.push(tc.toDataURL('image/png'))
    }
  }
  // keep blank (0) empty
  tileImages.value = Array(SIZE * SIZE).fill('')
  for (let i = 1; i < slices.length; i++) {
    const slice = slices[i]
    if (slice) tileImages.value[i] = slice
  }
  // preview is full image
  imagePreview.value = main.toDataURL('image/png')
}

function findBlank(): [number, number] {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const row = board.value[r]
      if (row?.[c] === 0) return [r, c]
    }
  }
  return [0, 0]
}

function tryMove(r: number, c: number) {
  if (solved.value) return
  const [br, bc] = findBlank()
  const dr = Math.abs(br - r)
  const dc = Math.abs(bc - c)
  if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
    // mark moved tiles for temporary animation
    movedTiles.value = [`${r}-${c}`, `${br}-${bc}`]
    const blankRow = board.value[br]
    const targetRow = board.value[r]
    if (blankRow && targetRow) {
      const targetValue = targetRow[c]
      if (targetValue !== undefined) {
        blankRow[bc] = targetValue
        targetRow[c] = 0
      }
    }
    moves.value++
    checkSolved()
    setTimeout(() => {
      movedTiles.value = []
    }, 220)
  }
}

function isMoved(r: number, c: number) {
  return movedTiles.value.includes(`${r}-${c}`)
}

function checkSolved() {
  let ok = true
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const expected = r * SIZE + c
      const row = board.value[r]
      if (row?.[c] !== expected) ok = false
    }
  }
  solved.value = ok
}

function reset() {
  board.value = createBoard()
  moves.value = 0
  solved.value = false
}
</script>

<template>
  <div class="puzzle-wrap">
    <div class="puzzle-info">
      <span>步数：{{ moves }}</span>
      <div style="display: flex; gap: 0.6rem; align-items: center">
        <label class="img-upload">
          <input type="file" accept="image/*" @change="onFileChange" />上传图片
        </label>
        <button @click="clearImages">清除图片</button>
        <button @click="reset">重置</button>
      </div>
      <span v-if="solved" class="win">完成！</span>
    </div>
    <div class="puzzle-board">
      <div v-for="(row, r) in board" :key="r" class="puzzle-row">
        <button
          v-for="(cell, c) in row"
          :key="c"
          class="puzzle-cell"
          :class="{ blank: cell === 0, moved: isMoved(r, c) }"
          @click="tryMove(r, c)"
          :style="
            cell !== 0 && tileImages[cell]
              ? {
                  backgroundImage: `url(${tileImages[cell]})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }
              : {}
          "
        >
          <span v-if="cell !== 0 && !tileImages[cell]">{{ cell }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.puzzle-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}
.puzzle-info {
  display: flex;
  gap: 1rem;
  align-items: center;
  margin-bottom: 0.8rem;
  flex-wrap: wrap;
  justify-content: center;
}
.puzzle-board {
  display: grid;
  grid-template-rows: repeat(4, 1fr);
  gap: 12px;
  background: #f3f0ea;
  padding: 12px;
  border-radius: 10px;
  width: min(58vw, 560px);
  max-width: 640px;
  aspect-ratio: 1 / 1;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
}
.puzzle-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.puzzle-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  border-radius: 8px;
  border: none;
  background: #fff;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.06);
  transition:
    transform 0.18s,
    box-shadow 0.18s;
  aspect-ratio: 1 / 1;
  width: 100%;
  font-size: 1.2rem;
}
.puzzle-cell.blank {
  background: transparent;
}
.puzzle-cell.moved {
  transform: translateY(-6%);
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.12);
}
.puzzle-cell:hover {
  transform: translateY(-3px);
}
@media (max-width: 900px) {
  .puzzle-board {
    width: min(86vw, 420px);
    gap: 10px;
    padding: 10px;
  }
  .puzzle-row {
    gap: 10px;
  }
  .puzzle-cell {
    font-size: 1.1rem;
    border-radius: 6px;
  }
}
@media (max-width: 600px) {
  .puzzle-board {
    width: min(92vw, 360px);
    padding: 3vw;
    gap: 3vw;
  }
  .puzzle-cell {
    font-size: 1rem;
  }
  .puzzle-cell {
    border-radius: 8px;
  }
}
.img-upload input {
  display: none;
}
.img-upload {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.6rem;
  background: #3b3b3b;
  color: #fff;
  border-radius: 6px;
  cursor: pointer;
}
.puzzle-cell[style] {
  background-size: cover;
  background-position: center;
}
.win {
  color: #27ae60;
  font-weight: bold;
}
</style>
