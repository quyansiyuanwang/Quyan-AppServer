<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { i18ns } from '@/locales'
import { carpoolService } from '@/service/carpoolService'
import { monthlyPassService } from '@/service/monthlyPassService'
import type { CarpoolPackageTemplateDto, MonthlyPassTemplateDto } from '@/client/types.gen'

const packages = ref<CarpoolPackageTemplateDto[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const templates = ref<MonthlyPassTemplateDto[]>([])
const dialogVisible = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({
  name: '',
  description: '',
  salePrice: 0,
  upstreamCost: 0,
  maxMembers: 4,
  monthlyPassTemplateId: '',
})
const rules = computed<FormRules>(() => ({
  name: [{ required: true, message: i18ns.t('carpool.packages.ruleName'), trigger: 'blur' }],
  salePrice: [
    {
      required: true,
      validator: (_, v: number, cb) =>
        v > 0 ? cb() : cb(new Error(i18ns.t('carpool.packages.ruleSalePrice'))),
      trigger: 'blur',
    },
  ],
  upstreamCost: [
    {
      required: true,
      validator: (_, v: number, cb) =>
        v >= 0 ? cb() : cb(new Error(i18ns.t('carpool.packages.ruleUpstreamCost'))),
      trigger: 'blur',
    },
  ],
  maxMembers: [
    { required: true, message: i18ns.t('carpool.packages.ruleMaxMembers'), trigger: 'blur' },
  ],
  monthlyPassTemplateId: [
    { required: true, message: i18ns.t('carpool.packages.ruleTemplate'), trigger: 'change' },
  ],
}))
const load = async () => {
  loading.value = true
  try {
    const result = (await carpoolService.packages(page.value, pageSize)).data as {
      total: number
      records: CarpoolPackageTemplateDto[]
    }
    packages.value = result.records
    total.value = result.total
  } finally {
    loading.value = false
  }
}
const loadTemplates = async () => {
  try {
    templates.value = (await monthlyPassService.listTemplates({ page: 1, pageSize: 100 })).records
  } catch {
    // 无月卡模板读权限时降级为已发布模板列表
    templates.value = await monthlyPassService.listPublishedTemplates()
  }
}
const openCreate = () => {
  dialogVisible.value = true
  if (!templates.value.length) void loadTemplates()
}
const create = async () => {
  await formRef.value?.validate()
  submitting.value = true
  try {
    await carpoolService.createPackage({
      name: form.name,
      description: form.description || undefined,
      salePrice: form.salePrice,
      upstreamCost: form.upstreamCost,
      maxMembers: form.maxMembers,
      monthlyPassTemplateId: form.monthlyPassTemplateId,
    })
    ElMessage.success(i18ns.t('carpool.packages.created'))
    dialogVisible.value = false
    form.name = ''
    form.description = ''
    form.monthlyPassTemplateId = ''
    await load()
  } finally {
    submitting.value = false
  }
}
const publish = async (row: CarpoolPackageTemplateDto, published: boolean) => {
  if (published) {
    await carpoolService.publishPackage(row.id)
    ElMessage.success(i18ns.t('carpool.packages.publishOk'))
  } else {
    await carpoolService.unpublishPackage(row.id)
    ElMessage.success(i18ns.t('carpool.packages.unpublishOk'))
  }
  await load()
}
onMounted(load)
</script>
<template>
  <section class="page">
    <div class="heading">
      <h1>{{ i18ns.t('carpool.packages.title') }}</h1>
      <p>{{ i18ns.t('carpool.packages.subtitle') }}</p>
    </div>
    <div style="margin-bottom: 16px">
      <el-button type="primary" @click="openCreate">
        {{ i18ns.t('carpool.packages.create') }}
      </el-button>
    </div>
    <el-table v-loading="loading" :data="packages">
      <el-table-column prop="name" :label="i18ns.t('carpool.packages.colName')" />
      <el-table-column
        prop="description"
        :label="i18ns.t('carpool.packages.colDescription')"
        show-overflow-tooltip
      />
      <el-table-column prop="salePrice" :label="i18ns.t('carpool.packages.colSalePrice')" />
      <el-table-column prop="upstreamCost" :label="i18ns.t('carpool.packages.colUpstreamCost')" />
      <el-table-column prop="snapshotQuota" :label="i18ns.t('carpool.packages.colQuota')" />
      <el-table-column
        prop="snapshotValidityDays"
        :label="i18ns.t('carpool.packages.colValidityDays')"
      />
      <el-table-column prop="maxMembers" :label="i18ns.t('carpool.packages.colMaxMembers')" />
      <el-table-column :label="i18ns.t('carpool.packages.colPublishStatus')">
        <template #default="{ row }">
          <el-tag :type="row.publishStatus === 'published' ? 'success' : 'info'">
            {{
              row.publishStatus === 'published'
                ? i18ns.t('carpool.packages.published')
                : i18ns.t('carpool.packages.draft')
            }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('carpool.common.colActions')">
        <template #default="{ row }">
          <el-button
            v-if="row.publishStatus !== 'published'"
            type="primary"
            link
            @click="publish(row, true)"
          >
            {{ i18ns.t('carpool.packages.publish') }}
          </el-button>
          <el-button v-else type="warning" link @click="publish(row, false)">
            {{ i18ns.t('carpool.packages.unpublish') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-if="total > pageSize"
      style="margin-top: 16px"
      layout="prev, pager, next"
      :total="total"
      :page-size="pageSize"
      :current-page="page"
      @current-change="
        (p: number) => {
          page = p
          load()
        }
      "
    />
    <el-dialog
      v-model="dialogVisible"
      :title="i18ns.t('carpool.packages.dialogTitle')"
      width="480px"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item :label="i18ns.t('carpool.packages.nameLabel')" prop="name">
          <el-input v-model="form.name" maxlength="100" />
        </el-form-item>
        <el-form-item :label="i18ns.t('carpool.packages.descriptionLabel')" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="2" maxlength="1000" />
        </el-form-item>
        <el-form-item
          :label="i18ns.t('carpool.packages.templateLabel')"
          prop="monthlyPassTemplateId"
        >
          <el-select
            v-model="form.monthlyPassTemplateId"
            filterable
            :placeholder="i18ns.t('carpool.packages.templatePlaceholder')"
          >
            <el-option
              v-for="t in templates"
              :key="t.id"
              :value="t.id"
              :label="
                i18ns.t('carpool.packages.templateOption', {
                  name: t.name,
                  quota: t.defaultQuota,
                  days: t.validityDays,
                })
              "
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="i18ns.t('carpool.packages.salePriceLabel')" prop="salePrice">
          <el-input-number v-model="form.salePrice" :min="0.0001" :precision="4" :step="1" />
        </el-form-item>
        <el-form-item :label="i18ns.t('carpool.packages.upstreamCostLabel')" prop="upstreamCost">
          <el-input-number v-model="form.upstreamCost" :min="0" :precision="4" :step="1" />
        </el-form-item>
        <el-form-item :label="i18ns.t('carpool.packages.maxMembersLabel')" prop="maxMembers">
          <el-input-number v-model="form.maxMembers" :min="1" :max="100" :step="1" step-strictly />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">
          {{ i18ns.t('carpool.packages.cancel') }}
        </el-button>
        <el-button type="primary" :loading="submitting" @click="create">
          {{ i18ns.t('carpool.packages.submit') }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>
