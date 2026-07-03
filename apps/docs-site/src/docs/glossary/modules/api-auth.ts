import type { GlossaryModule } from "@/docs/glossary/types";

const apiAuthGlossaryModule: GlossaryModule = {
  entries: [
    {
      id: "oauth",
      aliases: ["oauth"],
      title: {
        en: "OAuth",
        "zh-CN": "OAuth",
      },
      description: {
        en: "OAuth is a standard way to let one application obtain limited access to another account or service without directly giving away the user's password. For beginners, you can think of it as an 'authorized delegation' mechanism.",
        "zh-CN":
          "OAuth 是一种标准授权方式，允许一个应用在“不直接拿到用户密码”的前提下，获得对另一个账号或服务的部分访问权限。对新手来说，可以把它理解成“授权代办机制”。",
      },
    },
    {
      id: "api",
      aliases: ["api", "接口"],
      title: {
        en: "API",
        "zh-CN": "API（接口）",
      },
      description: {
        en: "API stands for Application Programming Interface. If a normal web page is for people to click, an API is for programs to talk to programs. In this product, it usually means a request address plus a rule set that another program can use to read data, submit data, or trigger an action.",
        "zh-CN":
          "API 是“应用程序编程接口”。如果普通网页是给人点击的，那么 API 更像是“给程序使用的网页入口”。在本产品里，它通常指别的程序访问本平台时使用的接口地址和调用规则，可用于读数据、传数据或触发动作。",
      },
    },
    {
      id: "openapi",
      aliases: ["openapi"],
      title: {
        en: "OpenAPI",
        "zh-CN": "OpenAPI",
      },
      description: {
        en: "OpenAPI is a standard format for describing what an API can do, what parameters it accepts, and what results it returns. Tools can read this description and automatically generate docs, test pages, and client code.",
        "zh-CN":
          "OpenAPI 是一种“用统一格式描述接口”的标准。它会写清楚接口能做什么、接收什么参数、返回什么结果。工具读懂这份说明后，就能自动生成接口文档、测试页面和客户端代码。",
      },
    },
    {
      id: "swagger",
      aliases: ["swagger"],
      title: {
        en: "Swagger",
        "zh-CN": "Swagger",
      },
      description: {
        en: "Swagger is a common tool for viewing and testing APIs in a web page. In this site it usually means the API documentation page where you can see endpoint details, fill in parameters, and try requests directly.",
        "zh-CN":
          "Swagger 是一种常见的接口文档和调试工具。在本站里，它通常就是那个可以查看接口详情、填写参数并直接测试请求的 API 文档页面。",
      },
    },
    {
      id: "endpoint",
      aliases: ["endpoint", "端点"],
      title: {
        en: "Endpoint",
        "zh-CN": "端点",
      },
      description: {
        en: "An endpoint is one specific API entry point. You can think of it as one exact service window: one endpoint may be for reading a list, another for creating a record, and another for deleting something.",
        "zh-CN":
          "端点就是 API 里的某一个具体功能入口。可以把它理解成一个明确的“服务窗口”：有的窗口负责查数据，有的负责新建，有的负责删除。",
      },
    },
    {
      id: "scope",
      aliases: ["scope", "scopes", "权限范围", "作用域"],
      title: {
        en: "Scope",
        "zh-CN": "Scope（权限范围）",
      },
      description: {
        en: "In OAuth and authorization docs, a scope means a named permission range. It defines exactly what an app is allowed to do after authorization, such as reading profile data or managing tokens.",
        "zh-CN":
          "在 OAuth 和授权文档里，scope 通常指“权限范围”。它用来明确说明：某个应用在授权后到底能做哪些事，比如读取资料、管理令牌，或者调用某类接口。",
      },
    },
    {
      id: "redirect-uri",
      aliases: [
        "redirect uri",
        "redirect-uri",
        "redirect url",
        "回调地址",
        "重定向地址",
      ],
      title: {
        en: "Redirect URI",
        "zh-CN": "回调地址 / Redirect URI",
      },
      description: {
        en: "A redirect URI is the address the OAuth system sends the user back to after authorization is finished. You can think of it as the 'return address' for the login or authorization process.",
        "zh-CN":
          "回调地址是 OAuth 授权完成后，系统把用户带回去的那个地址。可以把它理解成“授权流程结束后的返回地址”。",
      },
    },
    {
      id: "client-id-secret",
      aliases: [
        "client id",
        "client-id",
        "client secret",
        "client-secret",
        "客户端 id",
        "客户端密钥",
      ],
      title: {
        en: "Client ID / client secret",
        "zh-CN": "客户端 ID / 客户端密钥",
      },
      description: {
        en: "A client ID is the public identifier of an OAuth application, similar to an app number. A client secret is the private password of that application and must not be exposed on public pages or untrusted devices.",
        "zh-CN":
          "客户端 ID 是 OAuth 应用的公开编号，类似应用的“身份证号”；客户端密钥则像这个应用自己的“密码”，不能随便暴露在公开页面、前端代码或不可信设备上。",
      },
    },
    {
      id: "token",
      aliases: ["token", "令牌"],
      title: {
        en: "Token",
        "zh-CN": "Token（令牌）",
      },
      description: {
        en: "A token is a credential string used to identify or authorize a request. For beginners, you can think of it as a temporary digital pass or ticket. Whoever carries the correct token may be allowed to enter a certain function or call a certain API.",
        "zh-CN":
          "Token 是用于标识身份或进行授权的一段凭证字符串。对新手来说，可以把它理解成一张“临时电子通行证”或“电子门票”，拿着合适的 Token 才能访问对应功能或接口。",
      },
    },
    {
      id: "access-token",
      aliases: ["access token", "access-token", "访问令牌"],
      title: {
        en: "Access token",
        "zh-CN": "访问令牌",
      },
      description: {
        en: "An access token is a credential used directly when calling protected APIs. It is usually short-lived and proves that the current request has login or authorization state.",
        "zh-CN":
          "访问令牌是调用受保护 API 时直接使用的凭证。它通常有效期较短，用于证明当前请求具备登录或授权状态。",
      },
    },
    {
      id: "refresh-token",
      aliases: ["refresh token", "refresh-token", "刷新令牌"],
      title: {
        en: "Refresh token",
        "zh-CN": "刷新令牌",
      },
      description: {
        en: "A refresh token is used to obtain a new access token after the old one expires, so the user does not need to log in again immediately.",
        "zh-CN":
          "刷新令牌用于在访问令牌过期后换取新的访问令牌，从而避免用户立刻重新登录。",
      },
    },
    {
      id: "jwt",
      aliases: ["jwt"],
      title: {
        en: "JWT",
        "zh-CN": "JWT",
      },
      description: {
        en: "JWT stands for JSON Web Token. It is a common token format that can carry login identity, expiry time, and other small pieces of verification information. Many systems use it after login to prove who you are.",
        "zh-CN":
          "JWT 是 JSON Web Token 的缩写，是一种很常见的令牌格式。它里面通常会保存登录身份、过期时间等少量校验信息，很多系统登录后都会用它来证明“你是谁”。",
      },
    },
    {
      id: "passkey",
      aliases: ["passkey", "通行密钥"],
      title: {
        en: "Passkey",
        "zh-CN": "Passkey（通行密钥）",
      },
      description: {
        en: "A passkey is a modern passwordless login method, usually based on the device's secure key storage plus fingerprint, face, or system unlock.",
        "zh-CN":
          "Passkey 是一种现代无密码登录方式，通常依赖设备安全密钥、指纹、人脸或系统解锁能力。",
      },
    },
    {
      id: "two-factor",
      aliases: ["2fa", "two-factor", "双重验证", "二次验证", "二步验证"],
      title: {
        en: "2FA / two-factor verification",
        "zh-CN": "2FA / 双重验证",
      },
      description: {
        en: "2FA means a second verification step after password entry, such as email code, authenticator code, or device confirmation.",
        "zh-CN":
          "2FA 指在密码之外再做一次身份确认，例如邮箱验证码、验证器动态码或设备确认。",
      },
    },
    {
      id: "recovery-code",
      aliases: ["recovery code", "恢复码"],
      title: {
        en: "Recovery code",
        "zh-CN": "恢复码",
      },
      description: {
        en: "A recovery code is a backup verification credential used when your normal second-step verification method is unavailable.",
        "zh-CN": "恢复码是在常规二次验证方式不可用时使用的备用验证凭证。",
      },
    },
    {
      id: "step-up-auth",
      aliases: [
        "step-up",
        "step-up authentication",
        "step-up verification",
        "步进验证",
        "step up",
      ],
      title: {
        en: "Step-up verification",
        "zh-CN": "Step-up 验证",
      },
      description: {
        en: "Step-up verification is an extra security check triggered for sensitive or high-risk actions, even when the user is already logged in.",
        "zh-CN":
          "Step-up 验证是针对敏感或高风险操作追加的一层安全校验，即使用户已经登录，也可能被要求再次确认身份。",
      },
    },
    {
      id: "trusted-window",
      aliases: [
        "trusted window",
        "trusted-device",
        "trusted device",
        "受信窗口",
        "受信设备",
      ],
      title: {
        en: "Trusted window / trusted device",
        "zh-CN": "受信窗口 / 受信设备",
      },
      description: {
        en: "A trusted window or trusted device period means the system temporarily remembers that a device already passed verification, reducing repeated checks for a limited time.",
        "zh-CN":
          "受信窗口或受信设备期，表示系统在一段有限时间内记住某台设备已经通过验证，从而减少重复校验。",
      },
    },
    {
      id: "totp",
      aliases: ["totp", "authenticator app", "验证器应用", "动态码"],
      title: {
        en: "Authenticator app / TOTP",
        "zh-CN": "验证器应用 / TOTP",
      },
      description: {
        en: "TOTP is a time-based one-time code generated by an authenticator app. It changes frequently and is commonly used for 2FA.",
        "zh-CN":
          "TOTP 是验证器应用生成的时间型一次性动态码，会频繁变化，常用于 2FA 双重验证。",
      },
    },
    {
      id: "cookie",
      aliases: ["cookie", "cookies"],
      title: {
        en: "Cookie",
        "zh-CN": "Cookie",
      },
      description: {
        en: "A cookie is small browser-stored data that websites use to keep login state, preferences, or security context between requests.",
        "zh-CN":
          "Cookie 是浏览器保存的一小段数据，网站通常用它在多次请求之间维持登录状态、偏好设置或安全上下文。",
      },
    },
    {
      id: "session",
      aliases: ["session", "会话"],
      title: {
        en: "Session",
        "zh-CN": "会话",
      },
      description: {
        en: "A session is the active state linking your current browser or client to the platform after login or while performing a continuous interaction.",
        "zh-CN":
          "会话是登录后或持续交互过程中，将你当前浏览器或客户端与平台关联起来的一段活动状态。",
      },
    },
    {
      id: "request-id",
      aliases: ["request id", "request-id", "请求 id", "请求ID", "请求id"],
      title: {
        en: "Request ID",
        "zh-CN": "请求 ID",
      },
      description: {
        en: "A request ID is a unique identifier assigned to a request so administrators and support staff can trace the same operation across logs and systems.",
        "zh-CN":
          "请求 ID 是分配给单次请求的唯一标识，便于管理员和支持人员在不同日志与系统之间追踪同一次操作。",
      },
    },
    {
      id: "http-status",
      aliases: [
        "http status",
        "status code",
        "http code",
        "状态码",
        "http 状态码",
        "http状态码",
      ],
      title: {
        en: "HTTP status code",
        "zh-CN": "HTTP 状态码",
      },
      description: {
        en: "An HTTP status code is a numeric result code such as 200, 404, or 500 that tells whether a request succeeded, failed, or needs further action.",
        "zh-CN":
          "HTTP 状态码是类似 200、404、500 这样的数字结果，用来表示请求成功、失败，或是否还需要进一步操作。",
      },
    },
    {
      id: "payload",
      aliases: [
        "payload",
        "request payload",
        "response payload",
        "载荷",
        "数据体",
      ],
      title: {
        en: "Payload",
        "zh-CN": "载荷 / 数据体",
      },
      description: {
        en: "Payload means the main useful data carried inside a request or response, excluding surrounding technical wrapper information. In plain words, it is the 'actual content' you really care about.",
        "zh-CN":
          "载荷或数据体，指请求发送或响应返回时真正有用的主要数据，不包含外围那些技术性包装信息。简单说，就是你真正关心的“内容本体”。",
      },
    },
  ],
};

export default apiAuthGlossaryModule;
