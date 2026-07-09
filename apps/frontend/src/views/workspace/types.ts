import type { TicketType, TicketWorkflowStatus } from '@/client/types.gen'

export interface TicketFormModel {
  type: TicketType
  title: string
  description: string
  sourcePage: string
  reproduceSteps: string
  contactInfo: string
}

export interface TicketFiltersModel {
  keyword: string
  workflowStatus: '' | TicketWorkflowStatus
  type: '' | TicketType
}

export interface TicketPaginationModel {
  page: number
  pageSize: number
  total: number
}