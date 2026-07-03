import type { GlossaryModule } from "@/docs/glossary/types";

const billingGlossaryModule: GlossaryModule = {
  entries: [
    {
      id: "quota",
      aliases: ["quota", "额度", "配额"],
      title: {
        en: "Quota",
        "zh-CN": "额度 / 配额",
      },
      description: {
        en: "Quota means the amount you are allowed to use within a period or rule range. It can be understood as a usage limit or allowance, such as request count, token count, balance amount, or daily cap.",
        "zh-CN":
          "额度或配额，表示你在某个时间范围或规则范围内“最多可以用多少”。可以把它理解成使用上限或可用份额，比如请求次数、Token 数、余额金额或每日上限。",
      },
    },
    {
      id: "rate-limit",
      aliases: ["rate limit", "限流", "throttling"],
      title: {
        en: "Rate limit / throttling",
        "zh-CN": "限流",
      },
      description: {
        en: "Rate limiting means the system restricts request speed or request count in order to protect resources and keep service stable.",
        "zh-CN":
          "限流是指系统限制请求速度或请求次数，以保护资源并维持服务稳定。",
      },
    },
    {
      id: "monthly-pass",
      aliases: ["monthly pass", "月卡"],
      title: {
        en: "Monthly pass",
        "zh-CN": "月卡",
      },
      description: {
        en: "A monthly pass is a time-based package that usually grants quota, balance benefit, or discounted usage during its validity period.",
        "zh-CN":
          "月卡是一种按时间生效的套餐，通常会在有效期内提供额度、余额权益或优惠价格。",
      },
    },
    {
      id: "redemption-code",
      aliases: ["redemption code", "兑换码"],
      title: {
        en: "Redemption code",
        "zh-CN": "兑换码",
      },
      description: {
        en: "A redemption code is a code that can be exchanged for balance, quota, membership benefit, or another predefined reward.",
        "zh-CN":
          "兑换码是可用于换取余额、额度、会员权益或其他预设奖励的一串代码。",
      },
    },
    {
      id: "multiplier",
      aliases: ["multiplier", "倍率", "乘数"],
      title: {
        en: "Multiplier",
        "zh-CN": "倍率",
      },
      description: {
        en: "A multiplier is a numeric factor applied to a base price, weight, or score in order to calculate the final result.",
        "zh-CN":
          "倍率是应用在基础价格、权重或分值上的数值因子，用来计算最终结果。",
      },
    },
    {
      id: "threshold",
      aliases: ["threshold", "阈值"],
      title: {
        en: "Threshold",
        "zh-CN": "阈值",
      },
      description: {
        en: "A threshold is a trigger boundary. When a metric rises above or falls below it, the system may alert, block, or change behavior.",
        "zh-CN":
          "阈值是某个触发边界。当指标高于或低于该界限时，系统可能发出告警、执行限制或改变行为。",
      },
    },
    {
      id: "cooldown",
      aliases: ["cooldown", "冷却时间"],
      title: {
        en: "Cooldown",
        "zh-CN": "冷却时间",
      },
      description: {
        en: "Cooldown means the minimum wait period before the same action can run again, often used to avoid excessive notifications or repeated operations.",
        "zh-CN":
          "冷却时间是同一动作再次执行前需要等待的最短间隔，常用于避免通知过多或重复操作。",
      },
    },
    {
      id: "transaction",
      aliases: ["transaction", "交易记录", "交易"],
      title: {
        en: "Transaction",
        "zh-CN": "交易记录",
      },
      description: {
        en: "A transaction is a recorded balance-related operation, such as recharge, deduction, redemption, or another financial or usage-affecting change.",
        "zh-CN":
          "交易记录是一次与余额相关的已记录操作，例如充值、扣费、兑换，或其他影响费用与权益的变化。",
      },
    },
    {
      id: "quota-window",
      aliases: ["quota window", "validity window", "额度窗口", "有效期窗口"],
      title: {
        en: "Quota window",
        "zh-CN": "额度窗口",
      },
      description: {
        en: "A quota window is the time range in which a usage limit is measured and enforced, such as a daily, hourly, or custom validity period.",
        "zh-CN":
          "额度窗口是统计并执行使用限制的时间范围，例如按天、按小时或自定义有效期进行计算。",
      },
    },
    {
      id: "rpm-tpm",
      aliases: [
        "rpm",
        "tpm",
        "requests per minute",
        "tokens per minute",
        "每分钟请求数",
        "每分钟 token 数",
      ],
      title: {
        en: "RPM / TPM",
        "zh-CN": "RPM / TPM",
      },
      description: {
        en: "RPM means requests per minute, and TPM means tokens per minute. They are common throughput metrics used to observe usage intensity and capacity.",
        "zh-CN":
          "RPM 指每分钟请求数，TPM 指每分钟 Token 数。它们是观察使用强度和容量的常见吞吐指标。",
      },
    },
    {
      id: "model",
      aliases: ["model", "模型"],
      title: {
        en: "Model",
        "zh-CN": "模型",
      },
      description: {
        en: "A model usually means an AI model or service capability option that determines how requests are processed and billed.",
        "zh-CN":
          "模型通常指 AI 模型或某种服务能力选项，它会影响请求如何处理以及如何计费。",
      },
    },
  ],
};

export default billingGlossaryModule;
