<template>
  <el-card class="page-card ticket-card ticket-card--form" shadow="never">
    <template #header>
      <div class="card-header-block">
        <div class="card-title">
          {{
            isEditing ? i18ns.t('ticket.updateSectionTitle') : i18ns.t('ticket.submitSectionTitle')
          }}
        </div>
        <div class="card-description">
          {{
            isEditing
              ? i18ns.t('ticket.updateSectionDescription')
              : i18ns.t('ticket.submitSectionDescription')
          }}
        </div>
      </div>
    </template>

    <el-alert
      v-if="isEditing && editingLocked"
      :title="i18ns.t('ticket.terminalLocked')"
      type="warning"
      show-icon
      :closable="false"
      class="section-alert"
    />

    <el-form ref="formRef" :model="ticketForm" :rules="ticketFormRules" label-position="top">
      <div class="form-grid">
        <el-form-item :label="i18ns.t('ticket.type')" prop="type">
          <el-select
            :model-value="ticketForm.type"
            @update:model-value="updateField('type', $event)"
          >
            <el-option
              v-for="type in ticketTypeOptions"
              :key="type"
              :label="getTypeLabel(type)"
              :value="type"
            />
          </el-select>
        </el-form-item>

        <el-form-item :label="i18ns.t('ticket.contactInfo')" prop="contactInfo">
          <el-input
            :model-value="ticketForm.contactInfo"
            :maxlength="200"
            :placeholder="i18ns.t('ticket.contactInfoPlaceholder')"
            clearable
            @update:model-value="updateField('contactInfo', $event)"
          />
        </el-form-item>

        <el-form-item class="form-grid__full" :label="i18ns.t('ticket.title')" prop="title">
          <el-input
            :model-value="ticketForm.title"
            :maxlength="200"
            :placeholder="i18ns.t('ticket.titlePlaceholder')"
            clearable
            @update:model-value="updateField('title', $event)"
          />
        </el-form-item>

        <el-form-item
          class="form-grid__full"
          :label="i18ns.t('ticket.description')"
          prop="description"
        >
          <el-input
            :model-value="ticketForm.description"
            type="textarea"
            :rows="5"
            :maxlength="5000"
            show-word-limit
            :placeholder="i18ns.t('ticket.descriptionPlaceholder')"
            @update:model-value="updateField('description', $event)"
          />
        </el-form-item>

        <el-form-item :label="i18ns.t('ticket.sourcePage')" prop="sourcePage">
          <el-input
            :model-value="ticketForm.sourcePage"
            :maxlength="500"
            :placeholder="i18ns.t('ticket.sourcePagePlaceholder')"
            clearable
            @update:model-value="updateField('sourcePage', $event)"
          />
        </el-form-item>

        <el-form-item
          class="form-grid__full"
          :label="i18ns.t('ticket.reproduceSteps')"
          prop="reproduceSteps"
        >
          <el-input
            :model-value="ticketForm.reproduceSteps"
            type="textarea"
            :rows="4"
            :maxlength="5000"
            show-word-limit
            :placeholder="i18ns.t('ticket.reproduceStepsPlaceholder')"
            @update:model-value="updateField('reproduceSteps', $event)"
          />
        </el-form-item>
      </div>

      <div class="form-actions">
        <el-button @click="$emit('reset')">{{ i18ns.t('reset') }}</el-button>
        <el-button v-if="isEditing" @click="$emit('cancelEdit')">{{
          i18ns.t('ticket.cancelEdit')
        }}</el-button>
        <el-button
          type="primary"
          :loading="ticketSubmitting"
          :disabled="isEditing && editingLocked"
          @click="$emit('submit')"
        >
          {{ isEditing ? i18ns.t('ticket.saveUpdate') : i18ns.t('ticket.submitAction') }}
        </el-button>
      </div>
    </el-form>
  </el-card>
</template>

<script setup lang="ts">
import type { FormInstance, FormRules } from 'element-plus'
import { ref } from 'vue'
import { i18ns } from '@/locales'
import type { TicketType } from '@/client/types.gen'
import type { TicketFormModel } from '../types'

const props = defineProps<{
  isEditing: boolean
  editingLocked: boolean
  ticketSubmitting: boolean
  ticketForm: TicketFormModel
  ticketFormRules: FormRules<TicketFormModel>
  ticketTypeOptions: TicketType[]
  getTypeLabel: (type: TicketType) => string
}>()

const formRef = ref<FormInstance>()

const emit = defineEmits<{
  reset: []
  cancelEdit: []
  submit: []
  'update:ticketForm': [value: TicketFormModel]
}>()

function updateField<K extends keyof TicketFormModel>(key: K, value: TicketFormModel[K]) {
  emit('update:ticketForm', {
    ...props.ticketForm,
    [key]: value,
  })
}

async function validate() {
  if (!formRef.value) return false
  await formRef.value.validate()
  return true
}

function clearValidate() {
  formRef.value?.clearValidate()
}

defineExpose({
  validate,
  clearValidate,
})
</script>

<style scoped>
.page-card {
  border-radius: 18px;
  height: 100%;
}

.ticket-card {
  overflow: hidden;
}

.ticket-card--form {
  position: sticky;
  top: 0;
}

.ticket-card--form :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 16px;
}

.card-header-block {
  display: grid;
  gap: 4px;
}

.card-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.card-description {
  margin: 0;
  color: var(--el-text-color-secondary);
}

.section-alert {
  margin-bottom: 16px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
}

.form-grid__full {
  grid-column: 1 / -1;
}

.form-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

@media (max-width: 1200px) {
  .ticket-card--form {
    position: static;
  }
}

@media (max-width: 768px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
