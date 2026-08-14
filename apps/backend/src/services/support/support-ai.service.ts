import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import type { Request } from 'express'
import { CONFIG_KEYS } from '@/constant/config-keys'
import { AIProviderService } from '@/services/chat/ai-provider.service'
import { RedisService } from '@/services/infrastructure/redis.service'
import { ConfigService } from '@/services/system/config.service'
import { TicketService } from '@/services/ticket/ticket.service'
import { supportKnowledge } from '@/generated/support-knowledge'
import { BadRequestError, TooManyRequestsError } from '@/util/errors'
import type { RelayRequestFormat, SupportCitation, SupportStreamEvent } from '@appserver/shared'
import type {
  SendSupportMessageDto,
  SupportAiConfigDto,
  SupportHandoffDto,
  UpdateSupportAiConfigDto,
} from '@/api/dto/support/support.dto'

const BASE_PROMPT = `You are the platform support assistant. Answer only from the supplied product documentation. Never claim to change accounts, billing, permissions, or infrastructure. If the documentation does not answer the question, say so and recommend handing the request to human support.`

export class SupportAiService {
  private static instance: SupportAiService

  private constructor(
    private readonly configService = ConfigService.getInstance(),
    private readonly aiProvider = AIProviderService.getInstance(),
    private readonly ticketService = TicketService.getInstance(),
    private readonly redisService = RedisService.getInstance(),
  ) {}

  static getInstance() {
    if (!this.instance) this.instance = new SupportAiService()
    return this.instance
  }

  private async values() {
    return this.configService.getMultiple(Object.values(CONFIG_KEYS.SUPPORT_AI))
  }

  private configFrom(values: Record<string, string>): SupportAiConfigDto {
    return {
      enabled: values[CONFIG_KEYS.SUPPORT_AI.ENABLED] === 'true',
      upstreamUrl: values[CONFIG_KEYS.SUPPORT_AI.UPSTREAM_URL] ?? '',
      apiKeyConfigured: Boolean(values[CONFIG_KEYS.SUPPORT_AI.API_KEY]),
      model: values[CONFIG_KEYS.SUPPORT_AI.MODEL] ?? '',
      requestFormat: (values[CONFIG_KEYS.SUPPORT_AI.REQUEST_FORMAT] || 'openai-chat-completions') as RelayRequestFormat,
      systemPrompt: values[CONFIG_KEYS.SUPPORT_AI.SYSTEM_PROMPT] ?? '',
      maxRequests: Math.max(1, Number(values[CONFIG_KEYS.SUPPORT_AI.MAX_REQUESTS] || 20)),
      windowSeconds: Math.max(10, Number(values[CONFIG_KEYS.SUPPORT_AI.WINDOW_SECONDS] || 600)),
    }
  }

  async getConfig() {
    return this.configFrom(await this.values())
  }

  async updateConfig(body: UpdateSupportAiConfigDto, actorUserId: string, request?: Request) {
    const key = body.apiKey?.trim()
    const updates: Array<[string, string]> = [
      [CONFIG_KEYS.SUPPORT_AI.ENABLED, String(body.enabled)],
      [CONFIG_KEYS.SUPPORT_AI.UPSTREAM_URL, body.upstreamUrl.trim()],
      [CONFIG_KEYS.SUPPORT_AI.MODEL, body.model.trim()],
      [CONFIG_KEYS.SUPPORT_AI.REQUEST_FORMAT, body.requestFormat],
      [CONFIG_KEYS.SUPPORT_AI.SYSTEM_PROMPT, body.systemPrompt?.trim() ?? ''],
      [CONFIG_KEYS.SUPPORT_AI.MAX_REQUESTS, String(body.maxRequests)],
      [CONFIG_KEYS.SUPPORT_AI.WINDOW_SECONDS, String(body.windowSeconds)],
    ]
    if (key) updates.push([CONFIG_KEYS.SUPPORT_AI.API_KEY, this.encrypt(key)])
    if (body.clearApiKey) updates.push([CONFIG_KEYS.SUPPORT_AI.API_KEY, ''])
    for (const [configKey, value] of updates)
      await this.configService.set(configKey, value, actorUserId, request)
    return this.getConfig()
  }

  private encryptionKey() {
    const secret = process.env.SUPPORT_AI_CONFIG_MASTER_SECRET || ''
    if (secret.length < 64) throw new BadRequestError('AI support encryption key is not configured')
    return createHash('sha256').update(secret).digest()
  }

  private encrypt(value: string) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv)
    const text = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64')
    return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${text}`
  }

  private decrypt(value: string) {
    const [iv, tag, ciphertext] = value.split('.')
    if (!iv || !tag || !ciphertext) throw new BadRequestError('AI support API key is invalid')
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8')
  }

  private citations(query: string, locale: 'zh-CN' | 'en'): SupportCitation[] {
    const words = query.toLocaleLowerCase().split(/\s+/).filter((word) => word.length > 1)
    const ranked = supportKnowledge
      .map((chunk) => ({
        chunk,
        score: words.reduce((score, word) => score + Number(chunk.content.toLocaleLowerCase().includes(word)), 0),
      }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || Number(right.chunk.locale === locale) - Number(left.chunk.locale === locale))
      .slice(0, 3)
    return ranked.map(({ chunk }) => ({ slug: chunk.slug, title: chunk.title, url: chunk.url }))
  }

  private async assertRateLimit(userId: string, config: SupportAiConfigDto) {
    const bucket = Math.floor(Date.now() / (config.windowSeconds * 1000))
    const key = `support-ai:${userId}:${bucket}`
    const current = Number((await this.redisService.get(key)) || 0)
    if (current >= config.maxRequests) throw new TooManyRequestsError('Support request limit reached', config.windowSeconds)
    await this.redisService.set(key, current + 1, config.windowSeconds)
  }

  async *stream(userId: string, body: SendSupportMessageDto, signal?: AbortSignal): AsyncGenerator<SupportStreamEvent> {
    const config = await this.getConfig()
    if (!config.enabled || !config.upstreamUrl || !config.model || !config.apiKeyConfigured)
      throw new BadRequestError('AI support is unavailable')
    const content = body.content.trim()
    if (!content || content.length > 4000) throw new BadRequestError('Support message is invalid')
    await this.assertRateLimit(userId, config)
    const locale = body.locale === 'en' ? 'en' : 'zh-CN'
    const citations = this.citations(content, locale)
    const context = citations.length
      ? supportKnowledge.filter((chunk) => citations.some((citation) => citation.slug === chunk.slug)).slice(0, 3).map((chunk) => `[${chunk.title}]\n${chunk.content.slice(0, 1600)}`).join('\n\n')
      : 'No matching documentation was found.'
    yield { type: 'citations', citations }
    const history = (body.history ?? []).slice(-12).map((message) => ({ role: message.role, content: message.content.slice(0, 4000) }))
    const messages = [
      { role: 'system', content: `${BASE_PROMPT}\n${config.systemPrompt}\n\nDocumentation:\n${context}` },
      ...history,
      { role: 'user', content },
    ]
    const apiKey = this.decrypt((await this.values())[CONFIG_KEYS.SUPPORT_AI.API_KEY] || '')
    for await (const chunk of this.aiProvider.streamChat(messages, config.model, apiKey, config.upstreamUrl, config.requestFormat, signal))
      if (!chunk.done && chunk.content) yield { type: 'delta', content: chunk.content }
    yield { type: 'complete', done: true }
  }

  async handoff(userId: string, body: SupportHandoffDto, request?: Request) {
    const title = body.title.trim().slice(0, 160)
    const description = body.description.trim().slice(0, 12000)
    if (!title || !description) throw new BadRequestError('Support handoff is invalid')
    const ticket = await this.ticketService.createTicket(userId, { type: 'other', title, description, sourcePage: body.sourcePage }, request)
    return { ticketId: ticket.id }
  }
}
