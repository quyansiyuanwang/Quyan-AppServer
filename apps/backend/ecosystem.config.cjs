const fs = require("node:fs");
const path = require("node:path");

const deploymentRoot = process.env.BACKEND_DEPLOY_ROOT || __dirname;
const currentReleasePath = path.join(deploymentRoot, "current");
const activeReleasePath =
  process.env.RELEASE_DIR || (fs.existsSync(currentReleasePath) ? currentReleasePath : deploymentRoot);
const productionEnvFilePath =
  process.env.ENV_FILE_PATH ||
  (process.env.BACKEND_DEPLOY_ROOT ? path.join(deploymentRoot, ".env") : "/home/appserver/Quyan-Backend/.env");
module.exports = {
  apps: [
    {
      name: "backend",
      cwd: activeReleasePath,
      script: "./dist/index.cjs",
      interpreter: "bun",
      instances: 1,
      exec_mode: "cluster",
      wait_ready: true,
      listen_timeout: 60000,
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
        ENV_FILE_PATH: productionEnvFilePath,
      },
    },
  ],
};
