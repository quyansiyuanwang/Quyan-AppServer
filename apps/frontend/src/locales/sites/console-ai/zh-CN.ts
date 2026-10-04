// Locale bundle: console-ai/zh-CN.
import type en from './en'
import type { DeepStringify } from '@/types/common'

const zhCN: DeepStringify<typeof en> = {
  productConfig: {
    titleSuffix: '产品配置',
    description: '配置本产品的全局可用状态、默认免费额度与超额单价。',
    serviceSwitch: '服务开关',
    serviceSwitchDescription: '关闭后所有新的外部调用会立即拒绝，既有数据保持不变。',
    dailyQuota: '默认每日免费额度',
    overagePrice: '超额单价',
    freeUnlimitedHint: '超额单价为 0 时，该产品免费且每日额度不限。',
    instanceLimit: '默认实例上限',
    loadError: '产品配置暂时无法加载。',
    saved: '产品配置已保存',
  },
  productOperations: {
    titleSuffix: '运营管理',
    description: '管理主账号的产品额度、超额扣费和实例上限，不会修改 RAM 产品权限。',
    searchPlaceholder: '搜索用户名、显示名或账号 ID',
    user: '用户',
    userId: '账号 ID',
    quota: '每日免费额度',
    useDefaultQuota: '使用产品默认额度',
    overageEnabled: '允许超额扣费',
    instanceLimit: '实例上限',
    manageUser: '管理用户',
    accountNotConfigured: '未配置运营记录',
    accountSettings: '运营设置',
    instances: '实例',
    usage: '用量',
    audit: '调用审计',
    saveSuccess: '运营设置已保存',
  },
  productCatalog: {
    title: '产品目录',
    description: '每项服务拥有独立实例、API Key、RAM 授权和调用配额。',
    refresh: '刷新产品目录',
    api: 'API',
    managedService: '管理型服务',
    quota: '额度',
    perDay: '/ 日',
    enter: '进入产品',
    actions: '产品管理操作',
    noAccess: '无权限',
    disabled: '服务停用',
    available: '可访问',
    loadError: '产品目录暂时无法加载，请刷新后重试。',
  },
  productFeedback: {
    loadFailed: '产品数据加载失败，请重试。',
    operationFailed: '产品操作失败，请重试。',
    retry: '重试',
    formError: '请先处理请求错误后再试。',
  },
}

export default zhCN
