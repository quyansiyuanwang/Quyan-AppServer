# 构建产物分析

此目录只维护通用产物分析工具，不维护域名、账号、路由、页面选择器、权限或接口响应的第二份清单。

## 数据来源

- 默认读取本应用的 Vite 配置，取得 `build.outDir` 和 `build.manifest`；`--mode` 使用对应构建模式。
- 自动发现 manifest 中所有 HTML 入口与异步入口，以 manifest key 标识加载边界，不按文件名猜测业务页面。
- 每个边界统计其静态依赖与 CSS，公共资源去重，压缩体积逐文件求和。异步子依赖独立报告，不计入父边界。
- **这不是完整首屏或导航瀑布报告**：多个异步边界的运行时组合、业务数据、浏览器调度、LCP 等仍需真实浏览器测量；`assetCount` 也不等于实际网络请求数。

## 使用

在前端目录已有构建产物时运行，不触发构建或 OpenAPI 生成：

```sh
pnpm --filter @quyan/frontend exec node scripts/performance/bundle-report.mjs --mode production
```

对任意已有产物可显式提供 `--manifest <文件>` 和 `--out-dir <资源根目录>`；此模式不加载项目 Vite 配置，不需要部署环境变量。`--output <文件>` 指定报告位置，默认写入产物目录的 `performance-bundle.json`。

## 基线不是隐含默认值

正常分析不创建或修改基线。验收后的报告才可通过 `--write-baseline <文件>` 显式保存。

比较时同时传入 `--baseline <文件>` 与 `--max-growth-percent <非负百分比>`，不内置增长容忍度。基线指标损坏、超预算、模块边界新增或删除均需显式处理，不能悄悄跳过。比较与更新基线互斥，报告不能覆盖正在比较的基线。

历史探索脚本、模拟浏览器数据和未经确认的预算已移至 Git 忽略的 `tmp/performance/`，不作为 CI 工具或性能改善的证据。后续正式浏览器验证应复用站点/路由规范源，并将可重复的测试数据归入具名测试 fixtures。
