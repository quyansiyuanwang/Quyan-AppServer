import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const args = process.argv.slice(2);
const action = args[0]; // -start 或 -end
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const timingFile = path.join(__dirname, ".timing");

if (action === "-start" || action === "--start") {
  // 记录开始时间
  const startTime = Date.now();
  fs.writeFileSync(timingFile, `${startTime}`, "utf8");
  console.log(`⏱️  开始计时: ${new Date(startTime).toLocaleTimeString()}`);
} else if (action === "-end" || action === "--end") {
  // 计算并显示耗时
  if (!fs.existsSync(timingFile)) {
    console.error("❌ 错误: 未找到计时起点, 请先运行 'node scripts/time.js -start'");
    process.exit(1);
  }

  const endTime = Date.now();
  const startTime = Number(fs.readFileSync(timingFile, "utf8").trim());
  fs.unlinkSync(timingFile);

  const duration = endTime - startTime;
  const minutes = Math.floor(duration / 1000 / 60);
  const seconds = ((duration / 1000) % 60).toFixed(2);

  const timeStr = minutes >= 1 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;

  console.log(`✅ 完成时间: ${new Date(endTime).toLocaleTimeString()}`);
  console.log(`⏱️  总耗时: ${timeStr}`);
} else {
  console.log("用法:");
  console.log("  node scripts/time.js -start   # 开始计时");
  console.log("  node scripts/time.js -end     # 结束计时并显示结果");
  console.log("\n在 package.json 中使用:");
  console.log('  "build": "node scripts/time.js -start && pnpm run build-only && node scripts/time.js -end"');
  process.exit(1);
}
