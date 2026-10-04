<script setup lang="ts">
import { computed } from 'vue'
import type { CarpoolOrderDto } from '@/client/types.gen'
import { i18ns } from '@/locales'
import { carpoolWorkflowStep } from '@/views/relay/carpool'
const props = defineProps<{ order?: CarpoolOrderDto }>()
const activeStep = computed(() => carpoolWorkflowStep(props.order))
const closed = computed(
  () => props.order && ['failed', 'cancelled', 'expired'].includes(props.order.state),
)
const steps = computed(() => [
  i18ns.t('carpool.view.workflowSteps.package'),
  i18ns.t('carpool.view.workflowSteps.invite'),
  i18ns.t('carpool.view.workflowSteps.confirm'),
  i18ns.t('carpool.view.workflowSteps.submit'),
  i18ns.t('carpool.view.workflowSteps.fulfilled'),
])
</script>
<template>
  <nav
    :aria-label="i18ns.t('carpool.view.workflowTitle')"
    class="carpool-workflow"
    :class="{ 'is-closed': closed }"
  >
    <ol>
      <li
        v-for="(step, index) in steps"
        :key="step"
        :class="{
          'is-complete': index < activeStep,
          'is-current': index === activeStep && !closed,
        }"
        :aria-current="index === activeStep && !closed ? 'step' : undefined"
      >
        <span class="step-number">{{ index < activeStep ? '✓' : index + 1 }}</span
        ><span>{{ step }}</span>
      </li>
    </ol>
  </nav>
</template>
<style scoped>
.carpool-workflow ol {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  padding: 0;
  margin: 0;
  list-style: none;
}
.carpool-workflow li {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
}
.step-number {
  display: grid;
  place-items: center;
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--el-fill-color);
  font-weight: 700;
}
.is-complete .step-number {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}
.is-current {
  font-weight: 700;
  color: var(--el-text-color-primary) !important;
}
.is-current .step-number {
  background: var(--el-color-primary);
  color: var(--el-color-white);
}
.is-closed {
  opacity: 0.7;
}
@media (max-width: 640px) {
  .carpool-workflow ol {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
</style>
