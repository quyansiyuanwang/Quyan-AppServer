import "dotenv/config";
import { RedisService } from "@/services/infrastructure/redis.service";
import { RelayProbePlanInitializerService } from "@/services/relay/relay-probe-plan-initializer.service";

async function run() {
  const args = process.argv.slice(2);
  const usernameIndex = args.indexOf("--username");
  const username = usernameIndex >= 0 ? args[usernameIndex + 1] : undefined;
  if (
    !username ||
    username.startsWith("--") ||
    args.some((arg, index) => !["--username", "--apply", "--dry-run"].includes(arg) && index !== usernameIndex + 1) ||
    (args.includes("--apply") && args.includes("--dry-run"))
  ) {
    console.error("Usage: node dist/operations/initialize-probe-plan.cjs --username <account> [--dry-run | --apply]");
    process.exitCode = 1;
    return;
  }
  const report = await RelayProbePlanInitializerService.getInstance().run(username, args.includes("--apply"));
  console.log(JSON.stringify({ operation: "initialize-probe-plan", ...report }));
}
run()
  .catch(() => {
    console.error("Probe plan initialization failed; check account eligibility, email, authorization and migrations.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([
      RelayProbePlanInitializerService.getInstance().close(),
      RedisService.getInstance().close(),
    ]);
  });
