# Study Arcade (`staticSite`)

`staticSite` 是仓库中的独立静态前端应用，聚焦英语学习与轻量小游戏场景。

## 技术栈

- Vue 3
- TypeScript
- Vite
- Pinia
- Vue Router
- Vue I18n
- Vitest
- ESLint + Prettier

## 功能概览

- 学习首页与模块导航
- 单词记忆与练习
- 考试模式
- 学习进度持久化
- 小游戏模块

## 环境要求

- `Node.js` `^20.19.0 || >=22.12.0`
- `pnpm@10.33.0`

## 常用命令

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm run build:prod
pnpm run preview
pnpm run type:generate
pnpm run type-check
pnpm run lint-format-check
pnpm run test
pnpm run test:coverage
```

## 词库与内容脚本

### 文本导入

```bash
pnpm run wordbank:import -- --input <source.txt> --category <cet4|cet6|...> --type <memory|practice|decomposition>
```

### 网页抓词

```bash
pnpm run wordbank:scrape -- --output imports/cet4-memory.txt --start-url https://cet46.wendu.com/2021/1223/56978.shtml
```

## 目录结构

```text
staticSite/
  src/
    data/           # 词库、题库与静态内容
    locales/        # 国际化
    router/         # 路由
    stores/         # 本地状态与学习进度
    views/          # 页面
    utils/          # 工具函数
  scripts/          # 数据导入与生成脚本
  tests/            # 单元测试
  imports/          # 原始导入数据
```

## 开发提示

- 路由类型依赖 `pnpm run type:generate`
- 本地状态主要通过 Pinia 与浏览器存储维护
- 提交前建议运行 `pnpm run check:all`

## 许可证

- 本项目使用 `Apache-2.0`，见 `staticSite/LICENSE`
