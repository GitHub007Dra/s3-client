# S3 Client 多平台多架构构建计划

## 需求理解
为 S3 Client Electron 应用构建 **6 个安装包**：

| 平台 | AMD64/x64 | ARM64 |
|------|-----------|-------|
| macOS | ✅ | ✅ |
| Windows | ✅ | ✅ |
| Linux | ✅ | ✅ |

## 构建产物说明

### macOS
- `S3 Client-0.0.0-mac-x64.dmg` - Intel Mac
- `S3 Client-0.0.0-mac-arm64.dmg` - Apple Silicon (M1/M2/M3)

### Windows
- `S3 Client-0.0.0-win-x64.exe` - 64位 Intel/AMD
- `S3 Client-0.0.0-win-arm64.exe` - ARM64 (Surface Pro X 等)

### Linux
- `S3 Client-0.0.0-linux-x64.AppImage` - 64位 x86
- `S3 Client-0.0.0-linux-arm64.AppImage` - ARM64 (Raspberry Pi 等)

## 文件修改清单

### 1. 更新 electron-builder.json
添加多架构支持：
- mac: target 添加 x64 和 arm64
- win: target 添加 x64 和 arm64
- linux: target 添加 x64 和 arm64

### 2. 创建 build-all.js 脚本
构建流程：
1. 清理 dist 目录
2. vite build (构建渲染进程)
3. esbuild (构建主进程)
4. electron-builder (打包 6 个平台的安装包)

### 3. 更新 package.json
添加新的 npm scripts：
- `build:all` - 构建所有平台
- `build:mac` - 仅构建 macOS
- `build:win` - 仅构建 Windows
- `build:linux` - 仅构建 Linux

## 注意事项

### 跨平台构建限制
- **macOS**: 只能在 macOS 上构建 macOS 应用（签名需要）
- **Windows**: 可以在任何平台构建，但 Windows 上构建的 NSIS 安装包更完整
- **Linux**: 可以在任何平台构建

### 推荐构建环境
- **macOS 主机**: 可以构建 macOS、Windows、Linux 三个平台
- **CI/CD (GitHub Actions)**: 分别在各自平台上构建

## 使用方法

```bash
# 构建所有平台（当前主机支持的平台）
npm run build:all

# 仅构建特定平台
npm run build:mac
npm run build:win
npm run build:linux
```
