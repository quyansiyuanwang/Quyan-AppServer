import type { GlossaryModule } from "@/docs/glossary/types";

const relayOpsGlossaryModule: GlossaryModule = {
  entries: [
    {
      id: "relay-token",
      aliases: ["relay token", "转发 token", "转发token"],
      title: {
        en: "Relay token",
        "zh-CN": "转发 Token",
      },
      description: {
        en: "A relay token is a token used specifically for traffic forwarding. It normally carries routing, quota, or channel-related control meaning.",
        "zh-CN":
          "转发 Token 是专门用于流量转发的令牌，通常还带有路由、额度或渠道控制含义。",
      },
    },
    {
      id: "proxy-relay",
      aliases: ["proxy", "relay", "转发", "代理"],
      title: {
        en: "Proxy / relay",
        "zh-CN": "代理 / 转发",
      },
      description: {
        en: "Proxy or relay means this platform receives a request first, then forwards it to another service and returns the result back.",
        "zh-CN":
          "代理或转发，表示请求先到达本平台，再由本平台转发给其他服务，并把结果返回给调用方。",
      },
    },
    {
      id: "channel",
      aliases: ["channel", "渠道"],
      title: {
        en: "Channel",
        "zh-CN": "渠道",
      },
      description: {
        en: "A channel is a routing unit or provider path used by the platform to send traffic to a specific upstream service or model source.",
        "zh-CN":
          "渠道是平台把流量发送到某个上游服务或模型来源时使用的路由单元或提供方通道。",
      },
    },
    {
      id: "failover",
      aliases: ["failover", "故障转移"],
      title: {
        en: "Failover",
        "zh-CN": "故障转移",
      },
      description: {
        en: "Failover means switching traffic to another available target when the current target fails, times out, or becomes unhealthy.",
        "zh-CN":
          "故障转移是指当前目标异常、超时或不健康时，把流量切换到其他可用目标。",
      },
    },
    {
      id: "upstream",
      aliases: ["upstream", "上游"],
      title: {
        en: "Upstream",
        "zh-CN": "上游",
      },
      description: {
        en: "Upstream means the service provider or target service that this platform is calling or forwarding requests to.",
        "zh-CN": "上游指本平台正在调用或转发请求到达的目标服务或服务提供方。",
      },
    },
    {
      id: "latency",
      aliases: ["latency", "延迟"],
      title: {
        en: "Latency",
        "zh-CN": "延迟",
      },
      description: {
        en: "Latency is the time delay between sending a request and receiving a response. Lower latency usually means faster interaction.",
        "zh-CN":
          "延迟是从发出请求到收到响应之间的时间。延迟越低，通常表示交互越快。",
      },
    },
    {
      id: "heartbeat",
      aliases: ["heartbeat", "health check", "心跳", "健康检查"],
      title: {
        en: "Heartbeat / health check",
        "zh-CN": "心跳 / 健康检查",
      },
      description: {
        en: "A heartbeat or health check is a small periodic test request used to confirm whether a service is still reachable and operating normally.",
        "zh-CN":
          "心跳或健康检查，是系统定期发出的轻量测试请求，用来确认某个服务是否仍可访问并正常工作。",
      },
    },
    {
      id: "uptime",
      aliases: ["uptime", "正常运行时间", "在线率", "可用性"],
      title: {
        en: "Uptime / availability",
        "zh-CN": "在线率 / 可用性",
      },
      description: {
        en: "Uptime or availability means the proportion of time a service stays usable and responsive within a measured period.",
        "zh-CN":
          "在线率或可用性，表示某个服务在统计周期内保持可使用、可响应的时间占比。",
      },
    },
    {
      id: "monitoring",
      aliases: [
        "monitoring",
        "health monitor",
        "service monitor",
        "监控",
        "监测",
      ],
      title: {
        en: "Monitoring",
        "zh-CN": "监控",
      },
      description: {
        en: "Monitoring means continuously observing service health, performance, errors, or security signals so issues can be detected and handled early.",
        "zh-CN":
          "监控是指持续观察服务健康、性能、错误或安全信号，以便尽早发现并处理问题。",
      },
    },
    {
      id: "queue",
      aliases: ["queue", "队列", "请求队列"],
      title: {
        en: "Queue",
        "zh-CN": "队列",
      },
      description: {
        en: "A queue is an ordered waiting line for tasks or requests. It is used when work cannot be processed immediately and must be handled in sequence.",
        "zh-CN":
          "队列是任务或请求按顺序等待处理的列表。当系统不能立刻处理所有工作时，通常会先进入队列。",
      },
    },
    {
      id: "timeout",
      aliases: ["timeout", "超时"],
      title: {
        en: "Timeout",
        "zh-CN": "超时",
      },
      description: {
        en: "A timeout means the system stopped waiting because a request or operation took too long and did not complete within the expected time.",
        "zh-CN":
          "超时表示某个请求或操作耗时过长，系统在达到预期等待上限后停止继续等待。",
      },
    },
    {
      id: "retry",
      aliases: ["retry", "重试"],
      title: {
        en: "Retry",
        "zh-CN": "重试",
      },
      description: {
        en: "Retry means attempting the same request or operation again after a failure, timeout, or temporary error.",
        "zh-CN":
          "重试是指在失败、超时或临时错误之后，再次尝试执行同一个请求或操作。",
      },
    },
    {
      id: "provider",
      aliases: [
        "service provider",
        "model provider",
        "vendor",
        "供应商",
        "服务提供方",
      ],
      title: {
        en: "Provider / vendor",
        "zh-CN": "供应商 / 提供方",
      },
      description: {
        en: "A provider or vendor is the upstream service source that actually offers a model, API capability, or external resource used by this platform.",
        "zh-CN":
          "供应商或提供方，指真正提供模型、接口能力或外部资源的上游服务来源。",
      },
    },
  ],
};

export default relayOpsGlossaryModule;
