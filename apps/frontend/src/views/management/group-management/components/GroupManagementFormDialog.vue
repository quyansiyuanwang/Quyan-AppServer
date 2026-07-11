<template>
  <el-dialog
    v-model="dialogVisible"
    :title="isEdit ? i18ns.t('GroupManagement.editGroup') : i18ns.t('GroupManagement.createGroup')"
    :width="isDesktop ? '500px' : '92%'"
    :close-on-click-modal="false"
    @closed="resetForm"
  >
    <el-form
      ref="formRef"
      :model="formData"
      :rules="formRules"
      :label-width="isDesktop ? '100px' : undefined"
      :label-position="isDesktop ? 'right' : 'top'"
    >
      <el-form-item v-if="!isEdit" :label="i18ns.t('GroupManagement.username')" prop="username">
        <el-input v-model="formData.username" />
      </el-form-item>
      <el-form-item :label="i18ns.t('GroupManagement.name')" prop="name">
        <el-input v-model="formData.name" />
      </el-form-item>
      <el-form-item :label="i18ns.t('GroupManagement.level')" prop="level">
        <el-input-number
          v-model="formData.level"
          :min="0"
          :max="100"
          :style="isDesktop ? undefined : 'width: 100%'"
        />
      </el-form-item>
      <el-form-item :label="i18ns.t('GroupManagement.description')" prop="description">
        <el-input v-model="formData.description" type="textarea" :rows="3" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">
        {{ i18ns.t('confirm') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useGroupManagementContext } from '../context'

const {
  isDesktop,
  dialogVisible,
  isEdit,
  submitting,
  formRef,
  formData,
  formRules,
  resetForm,
  handleSubmit,
} = useGroupManagementContext()
</script>
