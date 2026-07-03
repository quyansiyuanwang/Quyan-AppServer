const productionEnvFilePath = "/home/service/Quyan-Backend/.env";

module.exports = {
  apps: [
    {
      name: "backend",
      cwd: __dirname,
      script: "./dist/index.cjs",
      interpreter: "bun",

      /* --------- Plans --------- */
      // Plan.1
      instances: 1,
      exec_mode: "cluster",
      wait_ready: true,
      listen_timeout: 8000,
      // Plan.2
      // instances: 1,
      // exec_mode: "fork",
      /* ------------------------- */
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
