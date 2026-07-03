<script setup lang="ts">
import { ref } from 'vue'

const SIZE = 4
const TILE_COUNT = SIZE * SIZE

function createTiles() {
  const arr = Array.from({ length: TILE_COUNT }, (_, i) => i)
  // shuffle until not solved
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
  } while (arr.every((v, i) => v === i))
  return arr
}

const tiles = ref<number[]>(createTiles())
const moves = ref(0)
const solved = ref(false)
const selected = ref<number | null>(null)
const tileImages = ref<string[]>(Array(TILE_COUNT).fill(''))
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
  tileImages.value = Array(TILE_COUNT).fill('')
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
  tileImages.value = slices.slice()
  imagePreview.value = main.toDataURL('image/png')
}

function trySelect(i: number) {
  if (solved.value) return
  if (selected.value === null) {
    selected.value = i
    return
  }
  if (selected.value === i) {
    selected.value = null
    return
  }
  const a = selected.value
  const b = i
  const tileA = tiles.value[a]
  const tileB = tiles.value[b]
  if (tileA !== undefined && tileB !== undefined) {
    tiles.value[a] = tileB
    tiles.value[b] = tileA
  }
  moves.value++
  selected.value = null
  checkSolved()
}

function checkSolved() {
  solved.value = tiles.value.every((v, i) => v === i)
}

function reset() {
  tiles.value = createTiles()
  moves.value = 0
  solved.value = false
  selected.value = null
}
</script>

<template>
  <div class="swap-wrap">
    <div class="swap-info">
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

    <div class="swap-board" role="grid">
      <div
        v-for="(tile, idx) in tiles"
        :key="idx"
        class="swap-cell"
        :class="{ selected: selected === idx }"
        @click="trySelect(idx)"
        :style="
          tileImages[tile]
            ? {
                backgroundImage: `url(${tileImages[tile]})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : {}
        "
      >
        <span v-if="!tileImages[tile]">{{ tile + 1 }}</span>
      </div>
    </div>

    <div v-if="imagePreview" class="preview-wrap"><img :src="imagePreview" alt="preview" /></div>
  </div>
</template>

<style scoped>
.swap-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}
.swap-info {
  display: flex;
  gap: 1rem;
  align-items: center;
  margin-bottom: 0.8rem;
  flex-wrap: wrap;
  justify-content: center;
}
.swap-board {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  background: #f3f0ea;
  padding: 12px;
  border-radius: 10px;
  width: min(58vw, 560px);
  max-width: 640px;
  aspect-ratio: 1 / 1;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
}
.swap-cell {
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
  aspect-ratio: 1/1;
  width: 100%;
  font-size: 1.2rem;
  cursor: pointer;
}
.swap-cell.selected {
  transform: translateY(-6%);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.14);
  outline: 3px solid rgba(52, 152, 219, 0.18);
}
.swap-cell:hover {
  transform: translateY(-3px);
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
.preview-wrap img {
  margin-top: 12px;
  width: 120px;
  height: auto;
  border-radius: 6px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
}
.win {
  color: #27ae60;
  font-weight: bold;
}
@media (max-width: 900px) {
  .swap-board {
    width: min(86vw, 420px);
    gap: 10px;
    padding: 10px;
  }
  .swap-cell {
    font-size: 1.1rem;
  }
}
@media (max-width: 600px) {
  .swap-board {
    width: min(92vw, 360px);
    padding: 3vw;
    gap: 3vw;
  }
  .swap-cell {
    font-size: 1rem;
  }
}
</style>
