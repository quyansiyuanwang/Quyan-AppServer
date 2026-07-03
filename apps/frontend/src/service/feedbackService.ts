import { useRequestStore } from '@/stores/request'
import { checkApiResult } from '@/utils/service-utils'
import { cache } from '@/utils/common'
import type {
  CreateFeedbackCommentDto,
  CreateFeedbackDto,
  CreateFeedbackReviewCommentDto,
  FeedbackControllerListMyFeedbackData,
  FeedbackControllerListReviewFeedbackData,
  ReviewFeedbackDto,
  UpdateMyFeedbackDto,
} from '@/client/types.gen'
import { createFeedbackControllerApi } from '@/client/services/feedback-controller.gen'

const getFeedbackControllerApi = cache(() =>
  createFeedbackControllerApi(useRequestStore().getAxios()),
)

export class FeedbackService {
  private static instance: FeedbackService

  static getInstance() {
    if (!this.instance) {
      this.instance = new FeedbackService()
    }
    return this.instance
  }

  async createFeedback(data: CreateFeedbackDto) {
    const result = await getFeedbackControllerApi().createFeedback({ body: data })
    return checkApiResult(result, true)
  }

  async listMyFeedback(query?: FeedbackControllerListMyFeedbackData['query']) {
    const result = await getFeedbackControllerApi().listMyFeedback({ params: query ?? {} })
    return checkApiResult(result, true)
  }

  async getMyFeedbackDetail(id: string) {
    const result = await getFeedbackControllerApi().getMyFeedbackDetail({ path: { id } })
    return checkApiResult(result, true)
  }

  async updateMyFeedback(id: string, data: UpdateMyFeedbackDto) {
    const result = await getFeedbackControllerApi().updateMyFeedback({ path: { id }, body: data })
    return checkApiResult(result, true)
  }

  async addMyComment(id: string, data: CreateFeedbackCommentDto) {
    const result = await getFeedbackControllerApi().addMyComment({ path: { id }, body: data })
    return checkApiResult(result, true)
  }

  async listReviewFeedback(query?: FeedbackControllerListReviewFeedbackData['query']) {
    const result = await getFeedbackControllerApi().listReviewFeedback({ params: query ?? {} })
    return checkApiResult(result, true)
  }

  async getReviewFeedbackDetail(id: string) {
    const result = await getFeedbackControllerApi().getReviewFeedbackDetail({ path: { id } })
    return checkApiResult(result, true)
  }

  async reviewFeedback(id: string, data: ReviewFeedbackDto) {
    const result = await getFeedbackControllerApi().reviewFeedback({ path: { id }, body: data })
    return checkApiResult(result, true)
  }

  async addReviewComment(id: string, data: CreateFeedbackReviewCommentDto) {
    const result = await getFeedbackControllerApi().addReviewComment({ path: { id }, body: data })
    return checkApiResult(result, true)
  }

  async deleteFeedback(id: string) {
    const result = await getFeedbackControllerApi().deleteFeedback({ path: { id } })
    checkApiResult(result, false)
    return true
  }
}

export const feedbackService = FeedbackService.getInstance()
