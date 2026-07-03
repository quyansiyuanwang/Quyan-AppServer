# JWT ID 黑名单机制

## 概述

实现了基于Redis的JWT ID（JTI）黑名单机制，防止token被滥用和重放攻击。

## 工作原理

1. **Token生成**：每个JWT自动包含唯一的`jti`（JWT ID）字段
2. **Token验证**：验证时检查JTI是否在Redis黑名单中
3. **Token撤销**：登出时将JTI加入黑名单，TTL设置为token剩余有效期

## 使用方法

### 登出撤销Token

```typescript
POST /auth/logout
{
  "access_token": "eyJhbGc...",
  "refresh_token": "eyJhbGc..." // 可选
}
```

### 手动撤销Token

```typescript
import { JWTAccessIns } from "@/util/auth";

await JWTAccessIns.revokeToken(token);
```

## Redis键格式

- 黑名单键：`jti_blacklist:{jti}`
- TTL：token剩余有效期（自动过期）

## 注意事项

- 需要Redis可用，否则黑名单功能降级（仅依赖token过期时间）
- 已过期的token不会被加入黑名单
- 黑名单条目会在token过期时自动清理
