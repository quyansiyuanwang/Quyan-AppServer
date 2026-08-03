import mysql from "mysql2/promise";
import { loadEnvFile } from "node:process";

loadEnvFile(".env.test");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const url = new URL(databaseUrl);
const baseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
if (!/^[A-Za-z0-9_]+$/u.test(baseName) || !baseName.toLowerCase().includes("test"))
  throw new Error("DATABASE_URL must target a dedicated test database");

const connection = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
});

try {
  const [rows] = await connection.query("SHOW DATABASES LIKE ?", [`${baseName}__vitest_%`]);
  for (const row of rows) {
    const name = row.Database;
    if (typeof name === "string" && /^[A-Za-z0-9_]+$/u.test(name)) await connection.query(`DROP DATABASE \`${name}\``);
  }
} finally {
  await connection.end();
}
