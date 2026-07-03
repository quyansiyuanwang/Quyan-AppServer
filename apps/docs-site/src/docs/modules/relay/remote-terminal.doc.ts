import contentEn from "@/content/en/remote-terminal.md?raw";
import contentZh from "@/content/zh-CN/remote-terminal.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "remote-terminal",
  category: {
    en: "Relay",
    "zh-CN": "转发",
  },
  title: {
    en: "Remote terminal",
    "zh-CN": "远程终端",
  },
  summary: {
    en: "Connect to registered remote devices and run interactive terminal sessions.",
    "zh-CN": "连接已注册的远程设备并发起交互式终端会话。",
  },
  tags: ["remote", "terminal", "device", "session"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
