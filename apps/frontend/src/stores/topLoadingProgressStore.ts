import { defineStore } from 'pinia'
import { computed, reactive, watch } from 'vue'

const createUid = (() => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return () => globalThis.crypto.randomUUID()
  }

  const getTimeComponent = () => Date.now().toString(36)

  const getRandomComponent = () => Math.random().toString(36).slice(2, 10)

  return () => `${getTimeComponent()}-${getRandomComponent()}`
})()

const clamp = (value: number, min = 0, max = 100) => Math.min(Math.max(value, min), max)

interface Task {
  id: string
  completed: boolean
  start_time: number
}

export const useTopLoadingProgressStore = defineStore('topLoadingProgress', () => {
  const historySummaryStore = reactive({
    avgUsagePerTask: 0,
    completedTaskCount: 0,
  })

  const state = reactive({
    tasks: new Map<string, Task>(),
    completedNumber: 0,
    progress: -1,
  })

  let progressTimer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = () => {
    if (progressTimer !== null) {
      clearTimeout(progressTimer)
      progressTimer = null
    }
  }

  const startTimer = (delay: number) => {
    clearTimer()
    progressTimer = setInterval(() => {
      const current = state.progress
      const segments = segmentsInfo.value
      if (!segments) return

      const { targetProgress, nextBoundary, perTaskShare } = segments

      const historyAvgRuntimes = historySummaryStore.avgUsagePerTask / delay
      const randomIncrementRate = 1 / (historyAvgRuntimes === 0 ? 5 : historyAvgRuntimes)
      // rate line model: f(x) = 1 / (nx + 1)
      const chunkPercent = 1 - (nextBoundary - current) / perTaskShare
      const closerRate = 1 / (2 * chunkPercent + 1)
      const increment =
        (targetProgress - current) * (Math.random() * randomIncrementRate) * closerRate

      state.progress = clamp(current + increment, current, targetProgress)
    }, delay)
  }

  const reset = () => {
    clearTimer()
    state.tasks.clear()
    state.completedNumber = 0
    state.progress = -1
  }

  const addTask = (id: string) => {
    startTimer(100)
    state.tasks.set(id, { id, completed: false, start_time: Date.now() })
  }

  const completeTask = (id: string) => {
    if (state.tasks.has(id) && !state.tasks.get(id)?.completed) {
      state.tasks.get(id)!.completed = true
      state.completedNumber += 1

      // history
      historySummaryStore.completedTaskCount += 1
      const taskStartTime = state.tasks.get(id)!.start_time
      const taskDuration = Date.now() - taskStartTime
      const totalUsage =
        historySummaryStore.avgUsagePerTask * (historySummaryStore.completedTaskCount - 1) +
        taskDuration
      historySummaryStore.avgUsagePerTask = totalUsage / historySummaryStore.completedTaskCount
    }
  }

  const removeTask = (id: string) => {
    if (!state.tasks.has(id)) return

    const wasCompleted = state.tasks.get(id)?.completed === true
    if (wasCompleted) {
      state.completedNumber = Math.max(state.completedNumber - 1, 0)
    }

    state.tasks.delete(id)

    // 如果所有任务都已完成或清空，清理定时器
    if (state.tasks.size === 0) {
      clearTimer()
    }
  }

  const wrapTask = <T>(task: Promise<T>, id?: string): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const taskId = id ?? createUid()
      addTask(taskId)

      // 添加超时保护，防止任务永久卡住
      const timeoutId = setTimeout(() => {
        console.warn(`Task ${taskId} timeout, removing from progress`)
        removeTask(taskId)
      }, 30000) // 30秒超时

      task
        .then((result) => {
          clearTimeout(timeoutId)
          completeTask(taskId)
          resolve(result)
        })
        .catch((error) => {
          clearTimeout(timeoutId)
          removeTask(taskId)
          reject(error)
        })
        .finally(() => {
          // 确保任务最终一定会被清理
          clearTimeout(timeoutId)
          setTimeout(() => {
            // 延迟检查，如果任务还存在且未完成，强制移除
            if (state.tasks.has(taskId)) {
              const task = state.tasks.get(taskId)
              if (task && !task.completed) {
                console.warn(`Forcefully removing stuck task: ${taskId}`)
                removeTask(taskId)
              }
            }
          }, 100)
        })
    })
  }

  watch<[number, number]>(
    () => [state.tasks.size, state.completedNumber],
    ([taskCount, completedCount]: [number, number]) => {
      const hasTasks = taskCount > 0
      const allDone = hasTasks && completedCount >= taskCount

      if (allDone || !hasTasks) {
        state.progress = 100
        setTimeout(reset, 300)
        return
      }
      state.progress = segmentsInfo.value?.baseProgress ?? 0
    },
  )

  const segmentsInfo = computed(() => {
    const total = state.tasks.size
    if (total === 0) return null

    const completedCount = state.completedNumber

    const perTaskShare = 100 / total
    const baseProgress = clamp(completedCount * perTaskShare)
    const nextBoundary = clamp((completedCount + 1) * perTaskShare)

    const epsilon = perTaskShare * 0.1 // 10% 余量
    const targetProgress = clamp(nextBoundary - epsilon, baseProgress, 100)

    const remainingSpan = Math.max(targetProgress - baseProgress, 0)

    return {
      completedCount,
      total,
      perTaskShare,
      baseProgress,
      targetProgress,
      remainingSpan,
      nextBoundary,
    }
  })

  const progress = computed({
    get: () => state.progress,
    set: (value: number) => {
      state.progress = clamp(value)
    },
  })

  const isActive = computed(() => state.tasks.size > 0)
  const isVisible = computed(() => state.progress >= 0)

  return {
    progress,
    isActive,
    isVisible,
    addTask,
    removeTask,
    wrapTask,
    reset,
    getTaskCount: () => state.tasks.size,
  }
})
