import type { GlossaryModule } from '@/docs/glossary/types'

const systemMonitoringGlossaryModule: GlossaryModule = {
  entries: [
    {
      id: 'smtp',
      aliases: ['smtp'],
      title: {
        en: 'SMTP',
        'zh-CN': 'SMTP',
      },
      description: {
        en: 'SMTP stands for Simple Mail Transfer Protocol. It is the standard method a server uses to send outgoing emails.',
        'zh-CN': 'SMTP 是“简单邮件传输协议”，服务器向外发送邮件时通常使用它。',
      },
    },
    {
      id: 'json',
      aliases: ['json'],
      title: {
        en: 'JSON',
        'zh-CN': 'JSON',
      },
      description: {
        en: 'JSON is a lightweight text format for structured data. It looks like organized key-value text and is widely used when APIs send or receive data. You can think of it as a machine-friendly way to write a data form.',
        'zh-CN':
          'JSON 是一种轻量级结构化文本格式，看起来像一组有条理的“键：值”数据。接口在传输数据时经常用它，你可以把它理解成一种机器更容易看懂的数据表单写法。',
      },
    },
    {
      id: 'session-id',
      aliases: [
        'sessionId',
        'session id',
        'authSessionId',
        'auth session id',
        'session ID',
        '会话 ID',
        '会话ID',
      ],
      title: {
        en: 'Session ID',
        'zh-CN': '会话 ID',
      },
      description: {
        en: 'A session ID is a unique identifier generated for each login event. Every time a user signs in, a new session ID is created. It is used to track that specific login instance for audit and monitoring purposes.',
        'zh-CN':
          '会话 ID 是每次登录时生成的唯一标识符。每次用户登录都会产生一个新的会话 ID，用于在审计和监控中追踪该次登录实例。',
      },
    },
    {
      id: 'cache',
      aliases: ['cache', 'caching', '缓存', '缓存读取', '缓存创建'],
      title: {
        en: 'Cache',
        'zh-CN': '缓存',
      },
      description: {
        en: 'A cache is temporarily stored data used to speed up later access or reduce repeated work. Different cache behaviors may also affect billing rules.',
        'zh-CN':
          '缓存是为了加快后续访问或减少重复计算而临时保存的数据。不同缓存行为有时也会影响计费规则。',
      },
    },
  ],
}

export default systemMonitoringGlossaryModule
