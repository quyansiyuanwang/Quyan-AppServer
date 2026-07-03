import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, "../../..");
const configPath = path.resolve(rootDir, "ecosystem.config.cjs");

describe("PM2 ecosystem config", () => {
  it("runs dist with bun in cluster mode and production env file path", async () => {
    const configModule = await import(pathToFileURL(configPath).href);
    const config = configModule.default ?? configModule;

    expect(config).toHaveProperty("apps");
    expect(Array.isArray(config.apps)).toBe(true);
    expect(config.apps).toHaveLength(1);

    const app = config.apps[0];
    expect(app.name).toBe("backend");
    expect(app.cwd).toBe(rootDir);
    expect(app.script).toBe("./dist/index.cjs");
    expect(app.interpreter).toBe("bun");
    expect(app.instances).toBe(1);
    expect(app.exec_mode).toBe("cluster");
    expect(app.wait_ready).toBe(true);
    expect(app.listen_timeout).toBe(8000);

    expect(app.env).toEqual({ NODE_ENV: "development" });
    expect(app.env_production).toEqual({
      NODE_ENV: "production",
      ENV_FILE_PATH: "/home/service/Quyan-Backend/.env",
    });
  });
});
