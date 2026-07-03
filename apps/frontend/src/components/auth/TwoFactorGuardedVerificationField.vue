<template>
  <el-form-item v-if="!isTwoFactorEnabled" :label="i18ns.t(verificationLabelKey)">
    <div :class="isDesktop ? 'verify-row' : 'verify-col'">
      <el-input
        v-model="verificationCode"
        :class="{ grow: isDesktop }"
        :placeholder="inputPlaceholder"
        :disabled="inputDisabled"
      />
      <el-button :loading="sendLoading" :disabled="sendButtonDisabled" @click="emit('send-code')">
        {{
          countdown > 0 ? i18ns.t(resendLabelKey, { seconds: countdown }) : i18ns.t(sendLabelKey)
        }}
      </el-button>
    </div>
  </el-form-item>

  <el-alert v-else class="two-factor-guard-alert" type="success" :closable="false" show-icon>
    {{ i18ns.t(guardHintKey) }}
  </el-alert>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'
import type { I18nENAvailableKeys } from '@/locales'

const props = withDefaults(
  defineProps<{
    modelValue: string
    isTwoFactorEnabled: boolean
    isDesktop: boolean
    countdown: number
    guardHintKey: I18nENAvailableKeys
    sendDisabled?: boolean
    sendLoading?: boolean
    inputDisabled?: boolean
    verificationLabelKey?: I18nENAvailableKeys
    sendLabelKey?: I18nENAvailableKeys
    resendLabelKey?: I18nENAvailableKeys
    inputPlaceholderKey?: I18nENAvailableKeys
  }>(),
  {
    sendDisabled: false,
    sendLoading: false,
    inputDisabled: false,
    verificationLabelKey: 'loginOrRegisterPage.verificationCode',
    sendLabelKey: 'loginOrRegisterPage.sendVerificationCode',
    resendLabelKey: 'loginOrRegisterPage.resendIn',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'send-code': []
}>()

const verificationCode = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value),
})

const sendButtonDisabled = computed(() => props.sendDisabled || props.countdown > 0)

const inputPlaceholder = computed(() =>
  props.inputPlaceholderKey ? i18ns.t(props.inputPlaceholderKey) : undefined,
)
</script>

<style scoped>
.verify-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.grow {
  flex: 1;
}

.verify-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.two-factor-guard-alert {
  margin-bottom: 6px;
}
</style>
