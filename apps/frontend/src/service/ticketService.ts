import { useRequestStore } from '@/stores/request'
import { checkApiResult } from '@/utils/service-utils'
import { cache } from '@/utils/common'
import type {
  CreateTicketCommentDto,
  CreateTicketDto,
  CreateTicketReviewCommentDto,
  ReviewTicketDto,
  SetTicketReviewAssignmentConfigDto,
  TicketControllerListMyTicketsData,
  TicketControllerListReviewTicketsData,
  TicketReviewAssignmentConfigDto,
  UpdateMyTicketDto,
} from '@/client/types.gen'
import { createTicketControllerApi } from '@/client/services/ticket-controller.gen'

const getTicketControllerApi = cache(() => createTicketControllerApi(useRequestStore().getAxios()))

export class TicketService {
  private static instance: TicketService

  static getInstance() {
    if (!this.instance) {
      this.instance = new TicketService()
    }
    return this.instance
  }

  async createTicket(data: CreateTicketDto) {
    const result = await getTicketControllerApi().createTicket({ body: data })
    return checkApiResult(result, true)
  }

  async listMyTickets(query?: TicketControllerListMyTicketsData['query']) {
    const result = await getTicketControllerApi().listMyTickets({ params: query ?? {} })
    return checkApiResult(result, true)
  }

  async getMyTicketDetail(id: string) {
    const result = await getTicketControllerApi().getMyTicketDetail({ path: { id } })
    return checkApiResult(result, true)
  }

  async updateMyTicket(id: string, data: UpdateMyTicketDto) {
    const result = await getTicketControllerApi().updateMyTicket({ path: { id }, body: data })
    return checkApiResult(result, true)
  }

  async addMyComment(id: string, data: CreateTicketCommentDto) {
    const result = await getTicketControllerApi().addMyComment({ path: { id }, body: data })
    return checkApiResult(result, true)
  }

  async listReviewTickets(query?: TicketControllerListReviewTicketsData['query']) {
    const result = await getTicketControllerApi().listReviewTickets({ params: query ?? {} })
    return checkApiResult(result, true)
  }

  async getReviewTicketDetail(id: string) {
    const result = await getTicketControllerApi().getReviewTicketDetail({ path: { id } })
    return checkApiResult(result, true)
  }

  async reviewTicket(id: string, data: ReviewTicketDto) {
    const result = await getTicketControllerApi().reviewTicket({ path: { id }, body: data })
    return checkApiResult(result, true)
  }

  async addReviewComment(id: string, data: CreateTicketReviewCommentDto) {
    const result = await getTicketControllerApi().addReviewComment({ path: { id }, body: data })
    return checkApiResult(result, true)
  }

  async deleteTicket(id: string) {
    const result = await getTicketControllerApi().deleteTicket({ path: { id } })
    checkApiResult(result, false)
    return true
  }

  async getReviewAssignmentRules(): Promise<TicketReviewAssignmentConfigDto> {
    const result = await getTicketControllerApi().getReviewAssignmentRules({})
    return checkApiResult(result, true).data
  }

  async setReviewAssignmentRules(
    data: SetTicketReviewAssignmentConfigDto,
  ): Promise<TicketReviewAssignmentConfigDto> {
    const result = await getTicketControllerApi().setReviewAssignmentRules({ body: data })
    return checkApiResult(result, true).data
  }
}

export const ticketService = TicketService.getInstance()