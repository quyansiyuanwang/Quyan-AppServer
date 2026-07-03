# 防重放攻击机制

## 概述

基于Nonce、Timestamp和签名的防重放攻击机制，防止请求被重复提交。

## 请求头

- `X-Nonce`: 随机字符串（32位十六进制）
- `X-Timestamp`: Unix时间戳（秒）
- `X-Sign`: SHA256签名

## 签名算法

```
sign = SHA256(nonce + timestamp + path + body)
```

## 服务端验证

1. 检查时间戳在5分钟窗口内
2. 检查Nonce未被使用（Redis存储10分钟）
3. 验证签名正确

## 客户端使用

### Node.js

```typescript
import { ReplayProtectionClient } from "@/util/replay-protection-client";

const body = { username: "admin", password: "123456" };
const headers = ReplayProtectionClient.generateHeaders(body, "/auth/login");

// 发送请求时包含这些headers
```

### 前端示例

```typescript
import CryptoJS from "crypto-js";

function generateHeaders(body: any, path: string) {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyStr = body ? JSON.stringify(body) : "";
  const data = nonce + timestamp + path + bodyStr;
  const sign = CryptoJS.SHA256(data).toString();

  return {
    "X-Nonce": nonce,
    "X-Timestamp": timestamp,
    "X-Sign": sign,
  };
}
```

## 应用范围

当前应用于：

- `POST /auth/login` - 登录接口

可根据需要添加到其他敏感接口。
