import type { GlossaryModule } from "@/docs/glossary/types";

const coreGlossaryModule: GlossaryModule = {
  entries: [
    {
      id: "variable",
      aliases: ["variable", "变量"],
      title: {
        en: "Variable",
        "zh-CN": "变量",
      },
      description: {
        en: "A variable is a named box used by a program to temporarily store a value. For example, a variable can store a username, a number, or a yes/no result so the program can use it later.",
        "zh-CN":
          "变量可以理解为程序里的一个“带名字的小盒子”，用来临时存放数据。比如它可以装用户名、数字，或者“是/否”这样的结果，方便程序后面继续使用。",
      },
    },
    {
      id: "parameter",
      aliases: ["parameter", "param", "参数"],
      title: {
        en: "Parameter",
        "zh-CN": "参数",
      },
      description: {
        en: "A parameter is an input value passed into a function, page, or API. You can think of it as the information you must provide so the system knows what you want it to do.",
        "zh-CN":
          "参数就是你传给函数、页面或接口的输入内容。可以把它理解成“你给系统的说明信息”，系统拿到这些信息后，才知道你想让它做什么。",
      },
    },
    {
      id: "field",
      aliases: ["field", "字段"],
      title: {
        en: "Field",
        "zh-CN": "字段",
      },
      description: {
        en: "A field is one individual piece of data inside a form, object, table row, or response. For example, username, email, and createdAt can each be separate fields.",
        "zh-CN":
          "字段就是一条数据里的某一个具体项目。比如在用户信息里，用户名、邮箱、创建时间都可以看成独立字段。",
      },
    },
    {
      id: "function",
      aliases: ["function", "函数"],
      title: {
        en: "Function",
        "zh-CN": "函数",
      },
      description: {
        en: "A function is a reusable block of logic. You give it input, it performs some work, and then it may return a result. It is similar to pressing a machine button that performs a fixed task.",
        "zh-CN":
          "函数可以理解为一段可重复使用的“处理步骤”。你给它输入，它按预先写好的规则做事，最后可能返回结果。它有点像机器上的一个功能按钮，按下去就执行固定动作。",
      },
    },
    {
      id: "request-response",
      aliases: ["request", "response", "请求", "响应"],
      title: {
        en: "Request / response",
        "zh-CN": "请求 / 响应",
      },
      description: {
        en: "A request is what your browser, app, or script sends out to ask for something. A response is what the server sends back. In simple terms: request means 'I want this', response means 'here is the result'.",
        "zh-CN":
          "请求是浏览器、程序或脚本发出去的“我想要这个”的动作；响应是服务器回回来的结果。最简单地说：请求是“提要求”，响应是“给结果”。",
      },
    },
    {
      id: "frontend-backend",
      aliases: ["frontend", "backend", "前端", "后端"],
      title: {
        en: "Frontend / backend",
        "zh-CN": "前端 / 后端",
      },
      description: {
        en: "Frontend is the part users directly see and click, such as pages, buttons, and forms. Backend is the hidden part on the server that stores data, checks permissions, and processes business logic.",
        "zh-CN":
          "前端是用户直接看到并操作的部分，比如页面、按钮、表单；后端是服务器上看不见的部分，负责存数据、校验权限、处理业务逻辑。",
      },
    },
    {
      id: "client-server",
      aliases: ["client", "server", "客户端", "服务器"],
      title: {
        en: "Client / server",
        "zh-CN": "客户端 / 服务器",
      },
      description: {
        en: "A client is the side that initiates an action, such as your browser, app, or script. A server is the side that receives the request, processes it, and returns data or a result.",
        "zh-CN":
          "客户端是主动发起操作的一方，比如你的浏览器、App 或脚本；服务器是接收请求、处理事情并返回结果的一方。",
      },
    },
    {
      id: "database",
      aliases: ["database", "db", "数据库"],
      title: {
        en: "Database",
        "zh-CN": "数据库",
      },
      description: {
        en: "A database is a system used to store and organize data for later lookup and update. You can think of it as a very large, structured storage cabinet that programs can search quickly.",
        "zh-CN":
          "数据库是专门用来保存和整理数据的系统，方便以后查询、修改和统计。可以把它理解成一个非常大、而且整理得很规整的电子资料柜。",
      },
    },
    {
      id: "browser",
      aliases: ["browser", "浏览器"],
      title: {
        en: "Browser",
        "zh-CN": "浏览器",
      },
      description: {
        en: "A browser is software used to open websites, such as Chrome, Edge, or Firefox. In many docs, actions like login, copy link, and open page are all done in the browser.",
        "zh-CN":
          "浏览器就是打开网页的软件，比如 Chrome、Edge、Firefox。文档里提到的登录、打开页面、复制链接等很多操作，通常都是在浏览器里完成的。",
      },
    },
    {
      id: "url",
      aliases: ["url", "网址", "链接地址"],
      title: {
        en: "URL",
        "zh-CN": "URL（链接地址）",
      },
      description: {
        en: "A URL is a web address used to open a page or send a request, such as a docs page link or API request address.",
        "zh-CN":
          "URL 是网页或接口请求使用的链接地址，例如文档页面链接或 API 请求地址。",
      },
    },
    {
      id: "domain",
      aliases: ["domain name", "域名", "网站域名"],
      title: {
        en: "Domain",
        "zh-CN": "域名",
      },
      description: {
        en: "A domain is the human-readable site address, such as docs.example.com, used instead of directly remembering a server IP address.",
        "zh-CN":
          "域名是人类更容易识别的网站地址，例如 docs.example.com，用来代替直接记忆服务器 IP 地址。",
      },
    },
    {
      id: "base-url",
      aliases: ["base url", "base-url", "基础 url", "基础url", "基础地址"],
      title: {
        en: "Base URL",
        "zh-CN": "基础 URL",
      },
      description: {
        en: "A base URL is the root address of an API. Specific endpoints are usually appended to it to form complete request addresses.",
        "zh-CN":
          "基础 URL 是接口系统的根地址。具体端点通常会拼接在它后面，组成完整请求地址。",
      },
    },
    {
      id: "metadata",
      aliases: ["metadata", "元数据"],
      title: {
        en: "Metadata",
        "zh-CN": "元数据",
      },
      description: {
        en: "Metadata means 'data about data'. It describes the main content rather than being the main content itself. For example, creation time, source, status, or category can all be metadata.",
        "zh-CN":
          "元数据就是“描述数据的数据”。它不是你主要关心的正文内容，而是对正文的补充说明，比如创建时间、来源、状态、分类等。",
      },
    },
    {
      id: "slug",
      aliases: ["slug", "短标识", "短代码"],
      title: {
        en: "Slug",
        "zh-CN": "Slug（短标识）",
      },
      description: {
        en: "A slug is a short, URL-friendly identifier used in links or paths so a page or resource can be referenced in a readable way.",
        "zh-CN":
          "Slug 是用于链接或路径中的短标识，通常适合放进 URL，方便页面或资源以可读方式被引用。",
      },
    },
  ],
};

export default coreGlossaryModule;
