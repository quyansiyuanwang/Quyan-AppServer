<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import type {
  CarpoolPackageTemplateDto,
  CreateCarpoolPackageTemplateRequest,
  MonthlyPassTemplateDto,
} from '@/client/types.gen'
import { i18ns } from '@/locales'
import { carpoolService } from '@/service/carpoolService'
import { monthlyPassService } from '@/service/monthlyPassService'
import { formatCarpoolMoney } from './carpool'

const packages = ref<CarpoolPackageTemplateDto[]>([])
const templates = ref<MonthlyPassTemplateDto[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const keyword = ref('')
const publishStatus = ref<string>()
const loading = ref(false)
const dialogVisible = ref(false)
const submitting = ref(false)
const editingId = ref<string>()
const formRef = ref<FormInstance>()
const preview = computed(() => ({
  seatPrice: form.salePrice && form.maxMembers ? form.salePrice / form.maxMembers : 0,
  seatCost: form.upstreamCost && form.maxMembers ? form.upstreamCost / form.maxMembers : 0,
  margin: form.salePrice - form.upstreamCost,
}))
const form = reactive<CreateCarpoolPackageTemplateRequest>({
  name: '',
  description: '',
  salePrice: 0,
  upstreamCost: 0,
  maxMembers: 2,
  formationDeadlineHours: 72,
  monthlyPassTemplateId: '',
})
const rules: FormRules = {
  name: [{ required: true, message: i18ns.t('carpool.packages.ruleName'), trigger: 'blur' }],
  salePrice: [
    {
      required: true,
      type: 'number',
      min: 0.0001,
      message: i18ns.t('carpool.packages.ruleSalePrice'),
      trigger: 'change',
    },
  ],
  upstreamCost: [
    {
      required: true,
      type: 'number',
      min: 0,
      message: i18ns.t('carpool.packages.ruleUpstreamCost'),
      trigger: 'change',
    },
  ],
  maxMembers: [
    {
      required: true,
      type: 'number',
      min: 1,
      message: i18ns.t('carpool.packages.ruleMaxMembers'),
      trigger: 'change',
    },
  ],
  monthlyPassTemplateId: [
    { required: true, message: i18ns.t('carpool.packages.ruleTemplate'), trigger: 'change' },
  ],
}
const load = async () => {
  loading.value = true
  try {
    const result = await carpoolService.packages(
      page.value,
      pageSize,
      keyword.value || undefined,
      publishStatus.value,
    )
    const data = result.data as { total: number; records: CarpoolPackageTemplateDto[] }
    packages.value = data.records
    total.value = data.total
  } finally {
    loading.value = false
  }
}
const search = async () => {
  page.value = 1
  await load()
}
const loadTemplates = async () => {
  templates.value = (await monthlyPassService.listTemplates({ page: 1, pageSize: 100 })).records
}
const resetForm = () =>
  Object.assign(form, {
    name: '',
    description: '',
    salePrice: 0,
    upstreamCost: 0,
    maxMembers: 2,
    formationDeadlineHours: 72,
    monthlyPassTemplateId: '',
  })
const openCreate = () => {
  editingId.value = undefined
  resetForm()
  dialogVisible.value = true
}
const openEdit = (item: CarpoolPackageTemplateDto) => {
  editingId.value = item.id
  Object.assign(form, {
    name: item.name,
    description: item.description ?? '',
    salePrice: item.salePrice,
    upstreamCost: item.upstreamCost ?? 0,
    maxMembers: item.maxMembers,
    formationDeadlineHours: item.formationDeadlineHours,
    monthlyPassTemplateId: item.monthlyPassTemplateId,
  })
  dialogVisible.value = true
}
const submit = async () => {
  const valid = await formRef.value?.validate()
  if (!valid) return
  submitting.value = true
  try {
    if (editingId.value) {
      await carpoolService.updatePackage(editingId.value, form)
      ElMessage.success(i18ns.t('carpool.packages.updated'))
    } else {
      await carpoolService.createPackage(form)
      ElMessage.success(i18ns.t('carpool.packages.created'))
    }
    dialogVisible.value = false
    await load()
  } finally {
    submitting.value = false
  }
}
const publish = async (item: CarpoolPackageTemplateDto, value: boolean) => {
  await (value ? carpoolService.publishPackage(item.id) : carpoolService.unpublishPackage(item.id))
  ElMessage.success(
    value ? i18ns.t('carpool.packages.publishOk') : i18ns.t('carpool.packages.unpublishOk'),
  )
  await load()
}
const duplicate = async (item: CarpoolPackageTemplateDto) => {
  await carpoolService.duplicatePackage(item.id)
  ElMessage.success(i18ns.t('carpool.packages.duplicated'))
  await load()
}
const archive = async (item: CarpoolPackageTemplateDto) => {
  await ElMessageBox.confirm(
    i18ns.t('carpool.packages.archiveConfirm'),
    i18ns.t('carpool.common.confirmTitle'),
    { type: 'warning' },
  )
  await carpoolService.archivePackage(item.id)
  ElMessage.success(i18ns.t('carpool.packages.archived'))
  await load()
}
onMounted(() => {
  void Promise.all([load(), loadTemplates()])
})
</script>

<template>
  <section class="page package-page">
    <header class="heading">
      <h1>{{ i18ns.t('carpool.packages.title') }}</h1>
      <p>{{ i18ns.t('carpool.packages.subtitle') }}</p>
      <el-alert type="info" :closable="false" :title="i18ns.t('carpool.packages.snapshotHint')" />
    </header>
    <div class="toolbar">
      <el-input
        v-model="keyword"
        clearable
        :placeholder="i18ns.t('carpool.common.search')"
        @keyup.enter="search"
      /><el-select
        v-model="publishStatus"
        clearable
        :placeholder="i18ns.t('carpool.packages.colPublishStatus')"
        @change="search"
        ><el-option value="published" :label="i18ns.t('carpool.packages.published')" /><el-option
          value="draft"
          :label="i18ns.t('carpool.packages.draft')" /></el-select
      ><el-button @click="search">{{ i18ns.t('carpool.common.searchButton') }}</el-button
      ><el-button type="primary" @click="openCreate">{{
        i18ns.t('carpool.packages.create')
      }}</el-button>
    </div>
    <el-table v-loading="loading" :data="packages"
      ><el-table-column
        prop="name"
        :label="i18ns.t('carpool.packages.colName')"
        min-width="150"
      /><el-table-column :label="i18ns.t('carpool.packages.delivery')" min-width="170"
        ><template #default="{ row }"
          >{{ row.snapshotQuota }} {{ row.snapshotQuotaUnit }} · {{ row.snapshotValidityDays }}
          {{ i18ns.t('carpool.common.day') }}</template
        ></el-table-column
      ><el-table-column :label="i18ns.t('carpool.packages.membersDeadline')" min-width="140"
        ><template #default="{ row }"
          >{{ row.maxMembers }} · {{ row.formationDeadlineHours }}h</template
        ></el-table-column
      ><el-table-column :label="i18ns.t('carpool.packages.margin')" min-width="180"
        ><template #default="{ row }"
          ><small>{{
            i18ns.t('carpool.packages.seatRevenue', {
              value: formatCarpoolMoney(row.estimatedSeatPrice),
            })
          }}</small
          ><small>{{
            i18ns.t('carpool.packages.seatCost', {
              value: formatCarpoolMoney(row.estimatedSeatCost),
            })
          }}</small
          ><strong>{{
            i18ns.t('carpool.packages.grossMargin', {
              value: formatCarpoolMoney(row.estimatedGrossMargin),
            })
          }}</strong></template
        ></el-table-column
      ><el-table-column :label="i18ns.t('carpool.packages.colPublishStatus')"
        ><template #default="{ row }"
          ><el-tag :type="row.publishStatus === 'published' ? 'success' : 'info'">{{
            row.publishStatus === 'published'
              ? i18ns.t('carpool.packages.published')
              : i18ns.t('carpool.packages.draft')
          }}</el-tag></template
        ></el-table-column
      ><el-table-column :label="i18ns.t('carpool.common.colActions')" width="300"
        ><template #default="{ row }"
          ><el-button link @click="openEdit(row)">{{ i18ns.t('carpool.packages.edit') }}</el-button
          ><el-button link @click="duplicate(row)">{{
            i18ns.t('carpool.packages.duplicate')
          }}</el-button
          ><el-button
            v-if="row.publishStatus !== 'published'"
            type="primary"
            link
            @click="publish(row, true)"
            >{{ i18ns.t('carpool.packages.publish') }}</el-button
          ><el-button v-else type="warning" link @click="publish(row, false)">{{
            i18ns.t('carpool.packages.unpublish')
          }}</el-button
          ><el-button type="danger" link @click="archive(row)">{{
            i18ns.t('carpool.packages.archive')
          }}</el-button></template
        ></el-table-column
      ></el-table
    >
    <el-pagination
      v-if="total > pageSize"
      v-model:current-page="page"
      :page-size="pageSize"
      layout="prev,pager,next"
      :total="total"
      @current-change="load"
    />
    <el-dialog
      v-model="dialogVisible"
      :title="
        editingId ? i18ns.t('carpool.packages.editTitle') : i18ns.t('carpool.packages.dialogTitle')
      "
      width="580px"
      ><el-form ref="formRef" :model="form" :rules="rules" label-width="130px"
        ><el-form-item :label="i18ns.t('carpool.packages.nameLabel')" prop="name"
          ><el-input v-model="form.name" maxlength="100" /></el-form-item
        ><el-form-item :label="i18ns.t('carpool.packages.descriptionLabel')"
          ><el-input v-model="form.description" type="textarea" maxlength="1000" /></el-form-item
        ><el-form-item
          :label="i18ns.t('carpool.packages.templateLabel')"
          prop="monthlyPassTemplateId"
          ><el-select v-model="form.monthlyPassTemplateId" filterable
            ><el-option
              v-for="template in templates"
              :key="template.id"
              :value="template.id"
              :label="
                i18ns.t('carpool.packages.templateOption', {
                  name: template.name,
                  quota: template.defaultQuota,
                  days: template.validityDays,
                })
              " /></el-select></el-form-item
        ><el-form-item :label="i18ns.t('carpool.packages.salePriceLabel')" prop="salePrice"
          ><el-input-number v-model="form.salePrice" :min="0.0001" :precision="4" /></el-form-item
        ><el-form-item :label="i18ns.t('carpool.packages.upstreamCostLabel')" prop="upstreamCost"
          ><el-input-number v-model="form.upstreamCost" :min="0" :precision="4" /></el-form-item
        ><el-form-item :label="i18ns.t('carpool.packages.maxMembersLabel')" prop="maxMembers"
          ><el-input-number
            v-model="form.maxMembers"
            :min="1"
            :max="100"
            step-strictly /></el-form-item
        ><el-form-item
          :label="i18ns.t('carpool.packages.deadlineLabel')"
          prop="formationDeadlineHours"
          ><el-input-number v-model="form.formationDeadlineHours" :min="1" :max="720" /><span
            class="input-suffix"
            >{{ i18ns.t('carpool.common.hour') }}</span
          ></el-form-item
        ><el-alert
          type="info"
          :closable="false"
          :title="
            i18ns.t('carpool.packages.preview', {
              price: formatCarpoolMoney(preview.seatPrice),
              cost: formatCarpoolMoney(preview.seatCost),
              margin: formatCarpoolMoney(preview.margin),
            })
          " /></el-form
      ><template #footer
        ><el-button @click="dialogVisible = false">{{ i18ns.t('carpool.common.cancel') }}</el-button
        ><el-button type="primary" :loading="submitting" @click="submit">{{
          i18ns.t('carpool.packages.submit')
        }}</el-button></template
      ></el-dialog
    >
  </section>
</template>
<style scoped>
.package-page {
  display: grid;
  gap: 16px;
}
.toolbar {
  display: flex;
  gap: 12px;
}
.input-suffix {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
}
small,
strong {
  display: block;
}
@media (max-width: 700px) {
  .toolbar {
    flex-direction: column;
  }
}
</style>
