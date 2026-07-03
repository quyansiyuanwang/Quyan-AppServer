<template>
  <div class="challenge-card" :class="{ 'challenge-card--disabled': !challengeReady }">
    <h2 class="challenge-title" id="challenge-title">{{ challengeTitle }}</h2>
    <p class="challenge-subtitle" id="challenge-description">{{ challengeSubtitle }}</p>

    <div v-if="!useRecoveryCode" class="challenge-input-group">
      <p class="challenge-input-label">{{ i18ns.t('twoFactor.code') }}</p>
      <SegmentedCodeInput
        v-model="codeModel"
        :length="6"
        :autofocus="true"
        :disabled="!challengeReady || submitting"
        :aria-label="i18ns.t('twoFactor.code')"
        :aria-describedby="'challenge-description'"
        @enter="$emit('submit')"
      />
    </div>

    <div v-else class="challenge-input-group">
      <p class="challenge-input-label">{{ i18ns.t('twoFactor.recoveryCodeLabel') }}</p>
      <SegmentedCodeInput
        v-model="recoveryCodeModel"
        :length="8"
        :separator-index="4"
        :allow-alphanumeric="true"
        :uppercase="true"
        :autofocus="true"
        :disabled="!challengeReady || submitting"
        :aria-label="i18ns.t('twoFactor.recoveryCodeLabel')"
        :aria-describedby="'challenge-description'"
        @enter="$emit('submit')"
      />
    </div>

    <div class="challenge-footer-row">
      <el-button link type="primary" :disabled="submitting" @click="toggleMethod">
        {{
          i18ns.or_t(useRecoveryCode, 'twoFactor.useAuthenticatorCode', 'twoFactor.useRecoveryCode')
        }}
      </el-button>

      <el-button
        type="primary"
        :loading="submitting"
        :disabled="!challengeReady"
        @click="$emit('submit')"
      >
        {{ submitLabel }}
      </el-button>
    </div>

    <p v-if="!challengeReady" class="challenge-empty-hint">
      {{ i18ns.t('twoFactor.challengeMissingHint') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'
import SegmentedCodeInput from '@/components/auth/SegmentedCodeInput.vue'

const props = withDefaults(
  defineProps<{
    code: string
    recoveryCode: string
    useRecoveryCode: boolean
    submitting: boolean
    challengeReady: boolean
    mode?: 'login' | 'disable'
  }>(),
  {
    mode: 'login',
  },
)

const emit = defineEmits<{
  (e: 'update:code', value: string): void
  (e: 'update:recoveryCode', value: string): void
  (e: 'update:useRecoveryCode', value: boolean): void
  (e: 'submit'): void
}>()

const challengeTitle = computed(() =>
  props.mode === 'disable' ? i18ns.t('twoFactor.disableTitle') : i18ns.t('twoFactor.loginTitle'),
)

const challengeSubtitle = computed(() =>
  props.mode === 'disable' ? i18ns.t('twoFactor.disableHint') : i18ns.t('twoFactor.verifyCodeHint'),
)

const submitLabel = computed(() =>
  props.mode === 'disable' ? i18ns.t('twoFactor.disableNow') : i18ns.t('twoFactor.submitCode'),
)

const codeModel = computed({
  get: () => props.code,
  set: (value: string) => emit('update:code', value),
})

const recoveryCodeModel = computed({
  get: () => props.recoveryCode,
  set: (value: string) => emit('update:recoveryCode', value.toUpperCase()),
})

const toggleMethod = () => {
  emit('update:useRecoveryCode', !props.useRecoveryCode)
  emit('update:code', '')
  emit('update:recoveryCode', '')
}
</script>

<style scoped>
.challenge-card {
  width: 100%;
  border: 1px solid var(--surface-control-border);
  border-radius: 14px;
  background: var(--surface-control-bg);
  padding: 20px;
}

.challenge-card--disabled {
  opacity: 0.72;
}

.challenge-title {
  margin: 0;
  color: var(--color-heading);
  font-size: 20px;
  font-weight: 650;
}

.challenge-subtitle {
  margin: 8px 0 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.challenge-input-group {
  margin-bottom: 16px;
}

.challenge-input-label {
  margin: 0 0 10px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.4;
}

.challenge-footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.challenge-empty-hint {
  margin: 14px 0 0;
  color: var(--el-color-danger);
  font-size: 12px;
}

@media (max-width: 768px) {
  .challenge-card {
    padding: 16px;
    border-radius: 12px;
  }

  .challenge-title {
    font-size: 18px;
  }

  .challenge-footer-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
