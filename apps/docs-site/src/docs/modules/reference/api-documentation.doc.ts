import contentEn from "@/content/en/api-documentation.md?raw";
import contentZh from "@/content/zh-CN/api-documentation.md?raw";
import { defineDocsPage } from "@/docs/defineDocsPage";

export default defineDocsPage({
  slug: "api-documentation",
  category: {
    en: "Reference",
    "zh-CN": "参考",
  },
  title: {
    en: "API documentation",
    "zh-CN": "API 文档",
  },
  summary: {
    en: "Review endpoint addresses, response-field notes, and pricing views.",
    "zh-CN": "说明接口地址、响应字段说明和价格视图。",
  },
  tags: ["api", "reference", "endpoint"],
  content: {
    en: contentEn,
    "zh-CN": contentZh,
  },
});
