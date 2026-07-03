import type { GlossaryModule } from "@/docs/glossary/types";

const ojGlossaryModule: GlossaryModule = {
  entries: [
    {
      id: "oj",
      aliases: ["oj", "在线判题", "判题"],
      title: {
        en: "OJ",
        "zh-CN": "OJ（在线判题）",
      },
      description: {
        en: "OJ usually stands for Online Judge. In this product, it refers to the code submission and evaluation related feature set and its supporting API, pricing, and usage modules.",
        "zh-CN":
          "OJ 通常是 Online Judge（在线判题）的缩写。在本产品里，它指与代码提交、判题评估相关的一组功能，以及配套的 API、价格和用量模块。",
      },
    },
    {
      id: "submitter",
      aliases: ["submitter", "oj submitter", "提交器", "oj 提交器"],
      title: {
        en: "Submitter",
        "zh-CN": "提交器",
      },
      description: {
        en: "A submitter is the component, tool, or workflow that sends code or tasks into the OJ-related system for processing and evaluation.",
        "zh-CN":
          "提交器是把代码或任务发送到 OJ 相关系统中进行处理和评估的组件、工具或工作流。",
      },
    },
  ],
};

export default ojGlossaryModule;
