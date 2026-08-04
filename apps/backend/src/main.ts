import { createApp, setupService } from "./app";
import { disconnectDatabase } from "./config/database";
import { EnvSpace } from "./config/env";
import { disposeRequestLogService } from "./middleware/logging";
import { RemoteTerminalGatewayBootstrap } from "./modules/remote-terminal/gateway/bootstrap";
import { RemoteTerminalGatewayService } from "./modules/remote-terminal/gateway/gateway.service";
import { DeveloperMonitorSchedulerService } from "./services/developer/developer-monitor-scheduler.service";
import { RedisService } from "./services/infrastructure/redis.service";
import { RelayChannelProbeService } from "./services/relay/relay-channel-probe.service";
import { getLogger, LogCategory } from "./util/logger";

const app = createApp();
setupService();
const port = EnvSpace.port;
const isDev = EnvSpace.isDevelopment;
const logger = getLogger("Main", LogCategory.UTIL);
const remoteTerminalGatewayBootstrap = new RemoteTerminalGatewayBootstrap(RemoteTerminalGatewayService.getInstance());

if (isDev) logger.warn("Running in development mode");

const server = app.listen(port, () => {
  logger.info(`Database: ${EnvSpace.hiddenDatabase}`);
  logger.info(`🚀 Server is running on port ${port}`);
  logger.info(`📖 API 文档: http://localhost:${port}/docs`);
  logger.info(`📄 OpenAPI JSON: http://localhost:${port}/docs/openapi.json`);

  // Notify PM2 that the app is ready (for cluster mode with wait_ready: true)
  if (process.send) {
    process.send("ready");
    logger.info("Sent 'ready' signal to PM2");
  }
});

server.on("upgrade", (request, socket, head) => {
  const handled = remoteTerminalGatewayBootstrap.handleUpgrade(request, socket, head);
  if (!handled) socket.destroy();
});

// Configure server-level timeouts to prevent hanging connections
server.keepAliveTimeout = 65 * 1000; // 65 seconds (slightly higher than typical load balancer timeout)
server.headersTimeout = 66 * 1000; // 66 seconds (must be higher than keepAliveTimeout)
server.requestTimeout = 10 * 60 * 1000; // 10 minutes for long-running requests (streaming)

// Graceful shutdown handler
let shutdownStarted = false;

const closeHttpServer = (): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && (error as { code?: string }).code !== "ERR_SERVER_NOT_RUNNING") reject(error);
      else resolve();
    });
  });

const gracefulShutdown = async (signal: string) => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  logger.info(`${signal} received, starting graceful shutdown`);

  // Force shutdown after 12 minutes (10min request + 2min buffer)
  const forceShutdownTimer = setTimeout(
    () => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    },
    12 * 60 * 1000,
  );
  forceShutdownTimer.unref?.();

  try {
    DeveloperMonitorSchedulerService.getInstance().stop();
    RelayChannelProbeService.getInstance().stop();
    await remoteTerminalGatewayBootstrap.close();
    await closeHttpServer();
    await disposeRequestLogService();
    await RedisService.getInstance().close();
    await disconnectDatabase();
    logger.info("Graceful shutdown completed");
    process.exitCode = 0;
  } catch (error) {
    logger.error("Graceful shutdown failed", { error });
    process.exitCode = 1;
  } finally {
    clearTimeout(forceShutdownTimer);
  }
};

process.once("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.once("SIGINT", () => void gracefulShutdown("SIGINT"));
