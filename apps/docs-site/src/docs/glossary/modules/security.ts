import type { GlossaryModule } from "@/docs/glossary/types";

const securityGlossaryModule: GlossaryModule = {
  entries: [
    {
      id: "webhook",
      aliases: ["webhook", "回调"],
      title: {
        en: "Webhook",
        "zh-CN": "Webhook",
      },
      description: {
        en: "A webhook is an automatic HTTP callback. When a specific event happens, the system actively sends a message to the URL you configured. You can think of it as 'the system calling you back automatically'.",
        "zh-CN":
          "Webhook 是一种自动 HTTP 回调。当某个事件发生时，系统会主动把消息发到你配置好的 URL。可以把它理解成“系统自动回头通知你”。",
      },
    },
    {
      id: "rbac",
      aliases: ["rbac", "role-based access control", "权限控制", "角色权限"],
      title: {
        en: "RBAC",
        "zh-CN": "RBAC（基于角色的权限控制）",
      },
      description: {
        en: "RBAC stands for Role-Based Access Control. Instead of deciding every permission one by one for every person, the system groups permissions into roles or groups first, then assigns those roles to users.",
        "zh-CN":
          "RBAC 是“基于角色的权限控制”。意思不是给每个人逐项勾选每一个权限，而是先把权限打包成角色或群组，再把这些角色分配给用户。",
      },
    },
    {
      id: "audit-log",
      aliases: ["audit log", "审计", "审计日志"],
      title: {
        en: "Audit log",
        "zh-CN": "审计日志",
      },
      description: {
        en: "An audit log is a record used to trace who did what, when it happened, and what changed for accountability and investigation.",
        "zh-CN":
          "审计日志是用于追踪“谁在什么时间做了什么、造成了什么变化”的记录，便于追责与排查。",
      },
    },
    {
      id: "whitelist-blacklist",
      aliases: ["whitelist", "blacklist", "白名单", "黑名单"],
      title: {
        en: "Whitelist / blacklist",
        "zh-CN": "白名单 / 黑名单",
      },
      description: {
        en: "A whitelist means explicitly allowed targets, while a blacklist means explicitly blocked targets.",
        "zh-CN": "白名单表示明确允许的对象，黑名单表示明确拒绝的对象。",
      },
    },
    {
      id: "ip",
      aliases: ["ip", "ip address", "ip地址"],
      title: {
        en: "IP / IP address",
        "zh-CN": "IP / IP 地址",
      },
      description: {
        en: "An IP address is the network identity used by a device on the internet or an internal network. It helps systems know where a request comes from and where a response should go.",
        "zh-CN":
          "IP 地址是设备在互联网或内网中的网络身份标识。系统通过它判断请求来自哪里，以及响应要发往哪里。",
      },
    },
    {
      id: "ip-ban",
      aliases: ["ip ban", "ip blacklist", "封禁", "封禁状态", "封禁时长"],
      title: {
        en: "IP ban",
        "zh-CN": "IP 封禁",
      },
      description: {
        en: "An IP ban means traffic from a specific network address is temporarily or permanently blocked because the system considers it risky, abusive, or invalid.",
        "zh-CN":
          "IP 封禁表示系统因风险、滥用或异常原因，临时或永久阻止来自某个网络地址的流量。",
      },
    },
    {
      id: "error-decay",
      aliases: ["error decay", "错误衰减", "衰减估计"],
      title: {
        en: "Error decay",
        "zh-CN": "错误衰减",
      },
      description: {
        en: "Error decay means previously accumulated risk or error weight gradually decreases over time if the bad behavior stops, allowing restrictions to ease naturally.",
        "zh-CN":
          "错误衰减是指当异常行为停止后，之前累计的风险分或错误权重会随着时间逐步下降，从而让限制自然缓解。",
      },
    },
    {
      id: "error-weight",
      aliases: ["error weight", "错误权重", "风险权重"],
      title: {
        en: "Error weight",
        "zh-CN": "错误权重",
      },
      description: {
        en: "Error weight is a score assigned to certain bad behaviors or failures so the system can evaluate risk and decide when to warn, limit, or ban.",
        "zh-CN":
          "错误权重是分配给某些异常行为或失败情况的分值，系统会据此评估风险，并决定何时告警、限制或封禁。",
      },
    },
    {
      id: "anomaly",
      aliases: ["anomaly", "异常值", "异常模式", "异常点"],
      title: {
        en: "Anomaly",
        "zh-CN": "异常",
      },
      description: {
        en: "An anomaly is a pattern or value that differs noticeably from normal expectations and may indicate abuse, failure, or data problems.",
        "zh-CN":
          "异常是指明显偏离正常预期的模式或数值，可能意味着滥用、故障或数据问题。",
      },
    },
    {
      id: "incident",
      aliases: ["incident", "故障事件", "事件窗口"],
      title: {
        en: "Incident",
        "zh-CN": "故障事件",
      },
      description: {
        en: "An incident is an operational problem or abnormal event that affects users, service quality, or system stability and needs investigation or follow-up.",
        "zh-CN":
          "故障事件是指影响用户、服务质量或系统稳定性的运行问题或异常情况，通常需要排查与后续处理。",
      },
    },
    {
      id: "outage",
      aliases: ["outage", "服务中断", "停机"],
      title: {
        en: "Outage",
        "zh-CN": "服务中断",
      },
      description: {
        en: "An outage means a service becomes completely unavailable for a period of time, so requests cannot be processed normally at all.",
        "zh-CN":
          "服务中断表示某项服务在一段时间内完全不可用，请求无法被正常处理。",
      },
    },
    {
      id: "degradation",
      aliases: ["degradation", "degraded", "降级"],
      title: {
        en: "Degradation",
        "zh-CN": "降级",
      },
      description: {
        en: "Degradation means a service is still partially available but its quality has dropped, for example with slower speed, higher errors, or reduced capability.",
        "zh-CN":
          "降级表示服务虽然仍部分可用，但质量已经下降，例如速度更慢、错误更多，或可用能力减少。",
      },
    },
    {
      id: "event-subscription",
      aliases: [
        "event subscription",
        "notification event",
        "事件订阅",
        "通知事件",
      ],
      title: {
        en: "Event subscription",
        "zh-CN": "事件订阅",
      },
      description: {
        en: "An event subscription defines which system events should trigger a notification, webhook delivery, or another automated response.",
        "zh-CN":
          "事件订阅用于定义哪些系统事件会触发通知、Webhook 投递或其他自动响应。",
      },
    },
    {
      id: "access-key",
      aliases: ["access key", "api key", "apikey", "访问密钥"],
      title: {
        en: "Access key / API key",
        "zh-CN": "访问密钥 / API Key",
      },
      description: {
        en: "An access key or API key is a long-term credential used by scripts, tools, or external services to call the platform without interactive login.",
        "zh-CN":
          "访问密钥或 API Key 是供脚本、工具或外部服务调用平台时使用的长期凭证，不需要人工交互登录。",
      },
    },
  ],
};

export default securityGlossaryModule;
