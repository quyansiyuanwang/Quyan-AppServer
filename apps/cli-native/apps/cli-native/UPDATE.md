# Quyan CLI 自动更新功能

## 功能概述

Quyan CLI 现在支持自动检测和下载更新，包括：

1. **自动检测更新**：启动 TUI 模式时，每 24 小时自动检查一次更新
2. **手动检查更新**：使用 `quyan update --check` 命令
3. **一键更新**：使用 `quyan update` 命令下载并安装最新版本

## 使用方法

### 检查更新

```bash
# 检查是否有新版本可用
quyan update --check

# JSON 输出格式
quyan update --check --json
```

### 安装更新

```bash
# 下载并安装最新版本
quyan update

# JSON 输出格式
quyan update --json
```

### TUI 模式自动检查

当你启动 TUI 模式（不带任何子命令）时：

```bash
quyan
```

CLI 会在后台自动检查更新（每 24 小时一次），如果有新版本可用，会在"Recent events"面板中显示通知。

## 实现细节

### 架构

- **模块位置**：`src/updater.rs`
- **缓存文件**：`~/.config/quyan/update_check.json`（Unix）或 `%APPDATA%\quyan\update_check.json`（Windows）
- **检查间隔**：24 小时
- **超时设置**：检查 10 秒，下载 300 秒

### 更新流程

1. **版本检查**
   - 从 GitHub Releases API 获取最新版本信息
   - 使用语义化版本（semver）比较当前版本和最新版本
   - 缓存检查结果以减少 API 请求

2. **平台识别**
   - 自动识别运行平台（Windows/Linux/macOS）和架构（x86_64/aarch64）
   - 从 GitHub Release 资源中选择对应的二进制文件

3. **安全更新**
   - 下载前备份当前可执行文件（`.backup` 扩展名）
   - 使用临时文件下载新版本
   - Windows：通过批处理脚本延迟替换（处理文件锁）
   - Unix：直接替换可执行文件

### 支持的平台

| 平台 | 架构 | 资源文件名 |
|------|------|-----------|
| Windows | x86_64 | `quyan-x86_64-pc-windows-msvc.exe` |
| Linux | x86_64 | `quyan-x86_64-unknown-linux-gnu` |
| macOS | x86_64 | `quyan-x86_64-apple-darwin` |
| macOS | aarch64 | `quyan-aarch64-apple-darwin` |

## 依赖项

新增的依赖项：

- `semver = "1.0"` - 语义化版本解析和比较
- `tempfile = "3.15"` - 临时文件管理
- `tokio` - 新增 `fs` feature 用于异步文件操作

## 配置

### 禁用自动检查

如果需要完全禁用自动更新检查，可以：

1. 删除缓存文件强制下次检查
2. 修改 `UPDATE_CHECK_INTERVAL_HOURS` 常量（需要重新编译）

### 更改 GitHub 仓库

如果需要从不同的 GitHub 仓库获取更新，修改 `GITHUB_API_RELEASES` 常量：

```rust
const GITHUB_API_RELEASES: &str = "https://api.github.com/repos/YOUR_ORG/YOUR_REPO/releases/latest";
```

## 错误处理

- 网络请求失败：静默失败，记录到日志
- 下载失败：显示错误信息，保留当前版本
- 安装失败：恢复备份文件（手动操作）

## 安全考虑

1. **HTTPS 强制**：所有下载都通过 HTTPS 进行
2. **GitHub API**：使用官方 GitHub API，不依赖第三方服务
3. **备份机制**：更新前自动备份当前版本
4. **User-Agent**：发送识别性 User-Agent 头

## 示例输出

### 有更新可用

```bash
$ quyan update --check
A new version of Quyan CLI is available: 0.2.0 → 0.3.0
Run 'quyan update' to install.

Release notes:
- Added auto-update functionality
- Improved error handling
- Bug fixes
```

### 已是最新版本

```bash
$ quyan update --check
{
  "updateAvailable": false,
  "message": "You are using the latest version"
}
```

### 执行更新

```bash
$ quyan update
Updating from 0.2.0 to 0.3.0...

Update installed successfully!
Version: 0.2.0 → 0.3.0

Release notes:
- Added auto-update functionality
- Improved error handling
```

## 开发说明

### 测试更新功能

1. 修改版本号测试版本比较：
   ```bash
   # 在 Cargo.toml 中临时降低版本号
   version = "0.1.0"
   ```

2. 强制检查更新（绕过缓存）：
   ```bash
   quyan update --check
   ```

3. 查看详细日志：
   ```bash
   quyan update --debug
   ```

### 发布新版本流程

1. 更新 `Cargo.toml` 中的版本号
2. 创建 Git tag：`git tag v0.3.0`
3. 推送 tag：`git push origin v0.3.0`
4. GitHub Actions 自动构建并上传二进制文件到 Release
5. CLI 自动检测到新版本

## 未来改进

- [ ] 添加增量更新支持（delta updates）
- [ ] 支持更新通道（stable/beta/nightly）
- [ ] 添加更新签名验证
- [ ] 支持代理配置
- [ ] 添加回滚功能
- [ ] 更新进度显示
