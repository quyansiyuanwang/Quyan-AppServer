// Locale bundle: account/zh-CN.
import type en from './en'
import type { DeepStringify } from '@/types/common'

const zhCN = {
  workspace: {
    title: '工作区',
    placeholder: '用于承载文档与工具的浮动标签页区域',
    openDocs: '在工作区中打开文档',
    restore: '恢复工作台',
    docsShort: '文档',
    swaggerTitle: 'Swagger',
    emptyTitle: '在这里打开内容',
    emptyDescription: '使用悬浮标签页同时查看文档、建议页和常用工具。',
    ticketEyebrow: '占位页',
    ticketTitle: '工单面板',
    ticketDescription: '这里先提供一个前端占位，后续可接入建议提交与工单跟踪。',
    ticketIdeasTitle: '想法收集',
    ticketIdeasDescription: '集中整理产品想法、改进需求和工作流建议。',
    ticketBugsTitle: '问题记录',
    ticketBugsDescription: '统一记录 bug、复现步骤与受影响页面。',
    ticketRoadmapTitle: '后续跟进',
    ticketRoadmapDescription: '追踪下一步动作、状态变化和后续工作台集成。',
  },
} as const satisfies DeepStringify<typeof en>

export default zhCN
