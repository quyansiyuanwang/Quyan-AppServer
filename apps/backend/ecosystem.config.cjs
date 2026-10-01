const productionEnvFilePath = process.env.ENV_FILE_PATH || "/home/appserver/Quyan-Backend/.env";

module.exports = {
  apps: [
    {
      name: "backend",
      cwd: __dirname,
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
