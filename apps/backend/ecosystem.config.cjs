const fs = require("node:fs");
const path = require("node:path");

const deploymentRoot = process.env.BACKEND_DEPLOY_ROOT || __dirname;
const currentReleasePath = path.join(deploymentRoot, "current");
const hasCurrentRelease = fs.existsSync(currentReleasePath);
const activeReleasePath = process.env.RELEASE_DIR || (hasCurrentRelease ? currentReleasePath : deploymentRoot);
const applicationScript = process.env.RELEASE_DIR
  ? path.join(activeReleasePath, "dist/index.cjs")
  : hasCurrentRelease
    ? "./current/dist/index.cjs"
    : "./dist/index.cjs";
const productionEnvFilePath = process.env.ENV_FILE_PATH || path.join(deploymentRoot, ".env");

module.exports = {
  apps: [
    {
      name: "backend",
      cwd: activeReleasePath,
      script: path.resolve(deploymentRoot, applicationScript),
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
