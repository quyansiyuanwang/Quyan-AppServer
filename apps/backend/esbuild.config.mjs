import esbuild from "esbuild";
import { copy } from "esbuild-plugin-copy";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);

// 是否为生产环境构建
const isProduction = process.env.NODE_ENV === "production";

// 使用 Node 模块解析找到 swagger-ui-dist（兼容 pnpm hoisting）
const swaggerUiDistDir = path.dirname(require.resolve("swagger-ui-dist"));

await esbuild.build({
  entryPoints: ["./src/main.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs", // 输出 CommonJS 格式
  outfile: "./dist/index.cjs", // 使用 .cjs 扩展名
  sourcemap: isProduction ? false : true, // 生产环境不生成 sourcemap
  minify: isProduction, // 生产环境启用压缩
  treeShaking: true, // 启用 tree-shaking
  keepNames: false, // 不保留函数名，减小体积
  legalComments: "none", // 移除注释
  logLevel: "error", // 只输出错误信息
  external: [
    // Prisma 相关
    "@prisma/client",
    ".prisma/client",
    // 原生模块
    "sharp",
    "bcrypt",
    // node-cron resolves its worker daemon relative to __filename. Bundling its
    // ESM entry into this CJS output makes import.meta.url undefined at runtime.
    "node-cron",
    // 可选依赖
    "proxy-agent",
    "socks",
    // Node 内置模块会自动标记为 external
  ],
  plugins: [
    copy({
      resolveFrom: "cwd",
      assets: [
        // package.json 文件
        { from: ["./package.json"], to: ["./dist/package.json"] },

        // schema 文件
        { from: ["./prisma/schema.prisma"], to: ["./dist/prisma"] },
        // Prisma 相关
        { from: ["./node_modules/.prisma/client/**/*"], to: ["./dist/node_modules/.prisma/client"], ignore: ["**/*.tmp"] },
        { from: ["./node_modules/@prisma/client/**/*"], to: ["./dist/node_modules/@prisma/client"] },

        // bcrypt 原生模块
        { from: ["./node_modules/bcrypt/**/*"], to: ["./dist/node_modules/bcrypt"] },

        // docs 目录
        { from: ["./docs/**/**"], to: ["./dist/docs"] },
        { from: ["./src/build/swagger.json"], to: ["./dist/build"] },
        { from: [path.join(swaggerUiDistDir, "**/*")], to: ["./dist/public/vendor/swagger-ui"] },
        { from: ["./public/**/*"], to: ["./dist/public"] },
      ],
      verbose: false, // 禁用复制文件的详细输出
    }),
  ],
  metafile: isProduction, // 生产环境生成元数据用于分析
});

// 只在非生产环境输出构建完成信息
if (!isProduction) {
  console.log("✓ Build complete!");
}
