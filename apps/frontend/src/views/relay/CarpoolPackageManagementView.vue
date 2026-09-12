<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
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
const rules: FormRules = {
  name: [{ required: true, message: '请输入套餐名称', trigger: 'blur' }],
  salePrice: [
    {
      required: true,
      validator: (_, v: number, cb) => (v > 0 ? cb() : cb(new Error('售价必须大于 0'))),
      trigger: 'blur',
    },
  ],
  upstreamCost: [
    {
      required: true,
      validator: (_, v: number, cb) => (v >= 0 ? cb() : cb(new Error('成本不能为负'))),
      trigger: 'blur',
    },
  ],
  maxMembers: [{ required: true, message: '请设置人数上限', trigger: 'blur' }],
  monthlyPassTemplateId: [{ required: true, message: '请选择关联月卡模板', trigger: 'change' }],
}
const load = async () => {
  loading.value = true
  try {
    const result = (await carpoolService.packages(page.value, pageSize)).data
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
    ElMessage.success('套餐已创建，发布后用户可见')
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
    ElMessage.success('套餐已发布')
  } else {
    await carpoolService.unpublishPackage(row.id)
    ElMessage.success('套餐已下线')
  }
  await load()
}
onMounted(load)
</script>
<template>
  <section class="page">
    <div class="heading">
      <h1>拼车套餐管理</h1>
      <p>基于月卡模板创建拼车套餐，发布后用户可在「我的拼车」页发起拼车。</p>
    </div>
    <div style="margin-bottom: 16px">
      <el-button type="primary" @click="openCreate">创建套餐</el-button>
    </div>
    <el-table v-loading="loading" :data="packages">
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="description" label="描述" show-overflow-tooltip />
      <el-table-column prop="salePrice" label="售价" />
      <el-table-column prop="upstreamCost" label="上游成本" />
      <el-table-column prop="snapshotQuota" label="总额度" />
      <el-table-column prop="snapshotValidityDays" label="有效期(天)" />
      <el-table-column prop="maxMembers" label="人数上限" />
      <el-table-column label="发布状态">
        <template #default="{ row }">
          <el-tag :type="row.publishStatus === 'published' ? 'success' : 'info'">
            {{ row.publishStatus === 'published' ? '已发布' : '草稿' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作">
        <template #default="{ row }">
          <el-button
            v-if="row.publishStatus !== 'published'"
            type="primary"
            link
            @click="publish(row, true)"
          >
            发布
          </el-button>
          <el-button v-else type="warning" link @click="publish(row, false)">下线</el-button>
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
    <el-dialog v-model="dialogVisible" title="创建拼车套餐" width="480px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="套餐名称" prop="name">
          <el-input v-model="form.name" maxlength="100" />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="2" maxlength="1000" />
        </el-form-item>
        <el-form-item label="关联月卡模板" prop="monthlyPassTemplateId">
          <el-select
            v-model="form.monthlyPassTemplateId"
            filterable
            placeholder="额度与有效期取自该模板"
          >
            <el-option
              v-for="t in templates"
              :key="t.id"
              :value="t.id"
              :label="`${t.name}（额度 ${t.defaultQuota} · ${t.validityDays} 天）`"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="售价" prop="salePrice">
          <el-input-number v-model="form.salePrice" :min="0.0001" :precision="4" :step="1" />
        </el-form-item>
        <el-form-item label="上游成本" prop="upstreamCost">
          <el-input-number v-model="form.upstreamCost" :min="0" :precision="4" :step="1" />
        </el-form-item>
        <el-form-item label="人数上限" prop="maxMembers">
          <el-input-number v-model="form.maxMembers" :min="1" :max="100" :step="1" step-strictly />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="create">创建</el-button>
      </template>
    </el-dialog>
  </section>
</template>
