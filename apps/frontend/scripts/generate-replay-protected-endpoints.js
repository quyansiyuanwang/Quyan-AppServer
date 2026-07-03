import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadOpenApiSpec } from './lib/openapi-resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const toHeyApiOperationId = (value) =>
  String(value || '').replace(/([A-Z]+)([A-Z][a-z])/g, (_match, capitals, lastPart) => {
    return capitals.charAt(0) + capitals.slice(1).toLowerCase() + lastPart;
  });

const openapi = loadOpenApiSpec();

// 提取所有标记了X-Replay-Protected的端点
const replayProtectedEndpoints = [];

for (const [_pathKey, methods] of Object.entries(openapi.paths)) {
  for (const [_method, operation] of Object.entries(methods)) {
    if (operation['X-Replay-Protected'] === true) {
      replayProtectedEndpoints.push(toHeyApiOperationId(operation.operationId));
    }
  }
}

async function generateHash(content) {
  const crypto = await import('crypto');
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
}

// 生成TypeScript文件
const content = `/**
 * 需要防重放保护的端点配置
 * 此文件由脚本自动生成，请勿手动修改
 * 生成哈希： ${await generateHash(JSON.stringify(replayProtectedEndpoints))}
 */

export const REPLAY_PROTECTED_ENDPOINTS = ${JSON.stringify(replayProtectedEndpoints, null, 2)} as const

export type ReplayProtectedEndpoint = typeof REPLAY_PROTECTED_ENDPOINTS[number]
`;

const outputPath = path.join(__dirname, '../src/client/replay-protected-endpoints.ts');
fs.writeFileSync(outputPath, content);

console.log(`✓ Generated ${replayProtectedEndpoints.length} replay-protected endpoints`);
